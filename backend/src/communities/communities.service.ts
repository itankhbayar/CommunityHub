import { ConflictException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CommunityContext } from '../authz/community-context';
import { MembershipPolicyService } from '../authz/policies/membership.policy';
import { Prisma } from '../generated/prisma/client.js';
import { CommunityRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import {
  CommunitySort,
  ListCommunitiesQuery,
} from './dto/list-communities.query';
import { UpdateCommunityDto } from './dto/update-community.dto';

/** How far back the "active" sort looks for posts and events. */
const ACTIVITY_WINDOW_DAYS = 30;

const SUMMARY_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  visibility: true,
  createdAt: true,
  _count: { select: { memberships: true } },
} satisfies Prisma.CommunitySelect;

type CommunityRow = Prisma.CommunityGetPayload<{
  select: typeof SUMMARY_SELECT;
}>;

export interface CommunityView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  createdAt: Date;
  memberCount: number;
  /** the caller's role here, or null — drives role-aware UI */
  callerRole: CommunityRole | null;
}

@Injectable()
export class CommunitiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MembershipPolicyService,
  ) {}

  async create(
    user: AuthenticatedUser,
    dto: CreateCommunityDto,
  ): Promise<CommunityView> {
    const base = slugify(dto.name);

    // Slug collisions get a numeric suffix; the loop races are settled by the
    // unique index (P2002 -> try the next candidate).
    for (let attempt = 0; ; attempt += 1) {
      const slug = attempt === 0 ? base : `${base}-${attempt + 1}`;
      try {
        const community = await this.prisma.community.create({
          data: {
            slug,
            name: dto.name,
            description: dto.description ?? null,
            visibility: dto.visibility ?? 'PUBLIC',
            createdById: user.id,
            // creator becomes OWNER atomically with the community itself
            memberships: { create: { userId: user.id, role: 'OWNER' } },
          },
          select: SUMMARY_SELECT,
        });
        return toView(community, 'OWNER');
      } catch (error) {
        if (isUniqueViolation(error) && attempt < 25) continue;
        throw error;
      }
    }
  }

  /**
   * Listing is inherently cross-community, so it cannot ride the per-community
   * guard; visibility scoping lives in the WHERE clause instead: everyone sees
   * PUBLIC, callers additionally see private communities they belong to, and
   * platform admins see everything.
   */
  async list(user: AuthenticatedUser | undefined, query: ListCommunitiesQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;

    const visibilityScope: Prisma.CommunityWhereInput =
      user?.globalRole === 'PLATFORM_ADMIN'
        ? {}
        : user
          ? {
              OR: [
                { visibility: 'PUBLIC' },
                { memberships: { some: { userId: user.id } } },
              ],
            }
          : { visibility: 'PUBLIC' };

    const where: Prisma.CommunityWhereInput = {
      AND: [
        visibilityScope,
        query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {},
      ],
    };

    const [total, rows, memberships] = await Promise.all([
      this.prisma.community.count({ where }),
      this.findPage(where, query.sort ?? 'new', (page - 1) * limit, limit),
      user
        ? this.prisma.membership.findMany({
            where: { userId: user.id },
            select: { communityId: true, role: true },
          })
        : Promise.resolve([]),
    ]);

    const roleByCommunity = new Map(
      memberships.map((m) => [m.communityId, m.role]),
    );

    return {
      items: rows.map((row) =>
        toView(row, roleByCommunity.get(row.id) ?? null),
      ),
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /**
   * One page of communities in the requested order.
   *
   * `new` and `popular` are plain index scans. `active` cannot be: Prisma can
   * order by an unfiltered relation count, but "posts in the last 30 days" is
   * a *filtered* count, and there is no orderBy for that. See rankByActivity.
   */
  private findPage(
    where: Prisma.CommunityWhereInput,
    sort: CommunitySort,
    skip: number,
    take: number,
  ): Promise<CommunityRow[]> {
    if (sort === 'active') return this.findActivePage(where, skip, take);

    return this.prisma.community.findMany({
      where,
      select: SUMMARY_SELECT,
      // id breaks ties so paging can never repeat or skip a row
      orderBy:
        sort === 'popular'
          ? [
              { memberships: { _count: 'desc' } },
              { createdAt: 'desc' },
              { id: 'desc' },
            ]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
    });
  }

  /**
   * Communities that have seen the most posts and events lately, then everyone
   * else by recency. Quiet communities are ranked last rather than filtered
   * out, so this stays a sort: a brand new instance where nothing has happened
   * yet still answers with its communities instead of an empty tab.
   */
  private async findActivePage(
    where: Prisma.CommunityWhereInput,
    skip: number,
    take: number,
  ): Promise<CommunityRow[]> {
    const rankedIds = await this.rankByActivity(where);

    const rankedPage = rankedIds.slice(skip, skip + take);
    // once the ranked communities run out, the page is filled from the quiet
    // ones — offset by however far past the ranked list this page starts
    const quietTake = take - rankedPage.length;
    const quietSkip = Math.max(0, skip - rankedIds.length);

    const [rankedRows, quietRows] = await Promise.all([
      rankedPage.length > 0
        ? this.prisma.community.findMany({
            where: { AND: [where, { id: { in: rankedPage } }] },
            select: SUMMARY_SELECT,
          })
        : Promise.resolve([]),
      quietTake > 0
        ? this.prisma.community.findMany({
            where: { AND: [where, { id: { notIn: rankedIds } }] },
            select: SUMMARY_SELECT,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            skip: quietSkip,
            take: quietTake,
          })
        : Promise.resolve([]),
    ]);

    // `in` does not preserve order, so reimpose the ranking here
    const byId = new Map(rankedRows.map((row) => [row.id, row]));
    const ranked = rankedPage
      .map((id) => byId.get(id))
      .filter((row): row is CommunityRow => row !== undefined);

    return [...ranked, ...quietRows];
  }

  /**
   * Community ids by recent activity, busiest first.
   *
   * Both groupBys filter through `community: where` — the *same* object the
   * listing itself is scoped by — so visibility is decided in exactly one
   * place. Ranking a community the caller cannot see would leak its existence
   * through the ordering even though the row itself is never returned.
   */
  private async rankByActivity(
    where: Prisma.CommunityWhereInput,
  ): Promise<string[]> {
    const since = new Date(
      Date.now() - ACTIVITY_WINDOW_DAYS * 24 * 3600 * 1000,
    );
    const recent = { createdAt: { gte: since }, community: where };

    const [posts, events] = await Promise.all([
      this.prisma.post.groupBy({
        by: ['communityId'],
        where: recent,
        _count: { _all: true },
      }),
      this.prisma.event.groupBy({
        by: ['communityId'],
        where: recent,
        _count: { _all: true },
      }),
    ]);

    // a post and an event both count as one thing happening
    const score = new Map<string, number>();
    for (const row of [...posts, ...events]) {
      score.set(
        row.communityId,
        (score.get(row.communityId) ?? 0) + row._count._all,
      );
    }

    return (
      [...score.entries()]
        // uuid7 ids sort by creation time, so the tiebreak is "newer first" and,
        // more importantly, is stable across pages
        .sort(([aId, aScore], [bId, bScore]) =>
          bScore !== aScore ? bScore - aScore : bId.localeCompare(aId),
        )
        .map(([id]) => id)
    );
  }

  /** Detail: the guard already resolved + authorized; just hydrate the view. */
  async get(ctx: CommunityContext): Promise<CommunityView> {
    const community = await this.prisma.community.findUniqueOrThrow({
      where: { id: ctx.community.id },
      select: SUMMARY_SELECT,
    });
    return toView(community, ctx.membership?.role ?? null);
  }

  async update(
    ctx: CommunityContext,
    dto: UpdateCommunityDto,
  ): Promise<CommunityView> {
    const community = await this.prisma.community.update({
      where: { id: ctx.community.id },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.description !== undefined
          ? { description: dto.description }
          : {}),
        ...(dto.visibility !== undefined ? { visibility: dto.visibility } : {}),
      },
      select: SUMMARY_SELECT,
    });
    return toView(community, ctx.membership?.role ?? null);
  }

  async delete(ctx: CommunityContext): Promise<void> {
    // cascade removes memberships, posts, likes, events, rsvps (proven in the
    // schema e2e suite)
    await this.prisma.community.delete({ where: { id: ctx.community.id } });
  }

  /** Self-join: only reachable for PUBLIC communities the guard let through. */
  async join(user: AuthenticatedUser, ctx: CommunityContext): Promise<void> {
    if (ctx.membership) {
      throw new ConflictException('You are already a member.');
    }

    try {
      await this.prisma.membership.create({
        data: {
          userId: user.id,
          communityId: ctx.community.id,
          role: 'MEMBER',
        },
      });
    } catch (error) {
      // two concurrent joins: the unique constraint settles it
      if (isUniqueViolation(error)) {
        throw new ConflictException('You are already a member.');
      }
      throw error;
    }
  }

  async leave(ctx: CommunityContext): Promise<void> {
    const membership = ctx.membership;
    if (!membership) {
      throw new ConflictException('You are not a member of this community.');
    }

    await this.prisma.$transaction(async (tx) => {
      // lock first: serializes membership mutations for this community, so two
      // owners leaving at once cannot both pass the owner-count check
      await this.policy.lockCommunity(tx, ctx.community.id);

      // re-read under the lock — ctx was resolved before we held it
      const current = await tx.membership.findUnique({
        where: { id: membership.id },
        select: { role: true },
      });
      if (!current) {
        throw new ConflictException('You are not a member of this community.');
      }

      await this.policy.assertNotLastOwner(tx, ctx.community.id, current.role);
      await tx.membership.delete({ where: { id: membership.id } });
    });
  }
}

function toView(
  row: CommunityRow,
  callerRole: CommunityRole | null,
): CommunityView {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    visibility: row.visibility,
    createdAt: row.createdAt,
    memberCount: row._count.memberships,
    callerRole,
  };
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // strip diacritics
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');
  return slug || 'community';
}

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}
