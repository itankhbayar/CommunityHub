import { ConflictException, Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CommunityContext } from '../authz/community-context';
import { MembershipPolicyService } from '../authz/policies/membership.policy';
import { Prisma } from '../generated/prisma/client.js';
import { CommunityRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCommunityDto } from './dto/create-community.dto';
import { ListCommunitiesQuery } from './dto/list-communities.query';
import { UpdateCommunityDto } from './dto/update-community.dto';

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
      this.prisma.community.findMany({
        where,
        select: SUMMARY_SELECT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
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
