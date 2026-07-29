import { BadRequestException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CommunityContext } from '../authz/community-context';
import { Prisma } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePostDto } from './dto/create-post.dto';
import { FeedQuery } from './dto/feed.query';
import { UpdatePostDto } from './dto/update-post.dto';

const POST_SELECT = {
  id: true,
  body: true,
  likeCount: true,
  createdAt: true,
  updatedAt: true,
  authorId: true,
  // author joined in the same query — this is what keeps the feed N+1-free
  author: { select: { id: true, displayName: true } },
} satisfies Prisma.PostSelect;

type PostRow = Prisma.PostGetPayload<{ select: typeof POST_SELECT }>;

export interface PostView {
  id: string;
  body: string;
  likeCount: number;
  likedByMe: boolean;
  createdAt: Date;
  updatedAt: Date;
  author: { id: string; displayName: string };
  /** lets the client decide whether to show edit/delete without a round trip */
  isMine: boolean;
}

@Injectable()
export class PostsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(
    user: AuthenticatedUser,
    ctx: CommunityContext,
    dto: CreatePostDto,
  ): Promise<PostView> {
    const post = await this.prisma.post.create({
      data: {
        communityId: ctx.community.id,
        authorId: user.id,
        body: dto.body,
      },
      select: POST_SELECT,
    });
    return toView(post, user.id, false);
  }

  /**
   * Keyset-paginated feed, newest first.
   *
   * Exactly two data queries regardless of page size: the page itself (author
   * included via join) and, for signed-in callers, one batched IN-query for
   * their likes on that page. Nothing here scales with row count.
   */
  async feed(
    user: AuthenticatedUser | undefined,
    ctx: CommunityContext,
    query: FeedQuery,
  ) {
    const limit = query.limit ?? 20;
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;

    const rows = await this.prisma.post.findMany({
      where: {
        communityId: ctx.community.id,
        ...(cursor
          ? {
              // strictly-before in (createdAt DESC, id DESC) order
              OR: [
                { createdAt: { lt: cursor.createdAt } },
                { createdAt: cursor.createdAt, id: { lt: cursor.id } },
              ],
            }
          : {}),
      },
      select: POST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      // one extra row tells us whether another page exists
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;

    const likedIds = user
      ? new Set(
          (
            await this.prisma.postLike.findMany({
              where: {
                userId: user.id,
                postId: { in: page.map((p) => p.id) },
              },
              select: { postId: true },
            })
          ).map((l) => l.postId),
        )
      : new Set<string>();

    const last = page.at(-1);

    return {
      items: page.map((row) => toView(row, user?.id, likedIds.has(row.id))),
      nextCursor: hasMore && last ? encodeCursor(last) : null,
    };
  }

  async update(ctx: CommunityContext, dto: UpdatePostDto): Promise<PostView> {
    // the guard resolved the post and already ran the own/any check
    const postId = ctx.resource!.id;

    const post = await this.prisma.post.update({
      where: { id: postId },
      data: { body: dto.body },
      select: POST_SELECT,
    });

    const likedByMe =
      ctx.membership !== null &&
      (await this.prisma.postLike.findUnique({
        where: {
          postId_userId: { postId, userId: ctx.membership.userId },
        },
        select: { postId: true },
      })) !== null;

    return toView(post, ctx.membership?.userId, likedByMe);
  }

  async delete(ctx: CommunityContext): Promise<void> {
    await this.prisma.post.delete({ where: { id: ctx.resource!.id } });
  }

  /**
   * Idempotent by design: optimistic UIs retry, and a retried "like" must not
   * count twice. The PostLike insert and the counter update live in one
   * transaction so likeCount can never drift from the rows it summarizes.
   */
  async like(user: AuthenticatedUser, ctx: CommunityContext): Promise<void> {
    const postId = ctx.resource!.id;

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.postLike.create({ data: { postId, userId: user.id } });
        await tx.post.update({
          where: { id: postId },
          data: { likeCount: { increment: 1 } },
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return; // already liked — the transaction rolled back, nothing counted
      }
      throw error;
    }
  }

  async unlike(user: AuthenticatedUser, ctx: CommunityContext): Promise<void> {
    const postId = ctx.resource!.id;

    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.postLike.deleteMany({
        where: { postId, userId: user.id },
      });
      if (count > 0) {
        await tx.post.update({
          where: { id: postId },
          data: { likeCount: { decrement: count } },
        });
      }
    });
  }
}

function toView(
  row: PostRow,
  viewerId: string | undefined,
  likedByMe: boolean,
): PostView {
  return {
    id: row.id,
    body: row.body,
    likeCount: row.likeCount,
    likedByMe,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    author: row.author,
    isMine: viewerId !== undefined && row.authorId === viewerId,
  };
}

function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString(
    'base64url',
  );
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const [iso, id] = decoded.split('|');
  const createdAt = new Date(iso ?? '');
  if (!iso || !id || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException('Invalid cursor.');
  }
  return { createdAt, id };
}
