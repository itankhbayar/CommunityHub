import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthenticatedUser } from '../auth/auth.types';
import { CommunityContext } from '../authz/community-context';
import { MembershipPolicyService } from '../authz/policies/membership.policy';
import { Prisma } from '../generated/prisma/client';
import { CommunityRole } from '../generated/prisma/enums';
import { PrismaService } from '../prisma/prisma.service';
import { ChangeRoleDto } from './dto/change-role.dto';
import { InviteMemberDto } from './dto/invite-member.dto';
import { ListMembersQuery } from './dto/list-members.query';

export interface MemberView {
  userId: string;
  displayName: string;
  role: CommunityRole;
  joinedAt: Date;
}

// Deliberately no email in member views: public communities expose their
// member list publicly, and addresses are not for broadcasting. Inviting
// works by typing an address, not by reading one off the list.
const MEMBER_SELECT = {
  userId: true,
  role: true,
  joinedAt: true,
  user: { select: { displayName: true } },
} satisfies Prisma.MembershipSelect;

const ROLE_ORDER: Record<CommunityRole, number> = {
  OWNER: 0,
  MODERATOR: 1,
  MEMBER: 2,
};

@Injectable()
export class MembersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: MembershipPolicyService,
  ) {}

  async list(ctx: CommunityContext, query: ListMembersQuery) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 50;

    const where = { communityId: ctx.community.id };

    const [total, rows] = await Promise.all([
      this.prisma.membership.count({ where }),
      this.prisma.membership.findMany({
        where,
        select: MEMBER_SELECT,
        // owners first, then mods, then members; joinedAt settles ties
        orderBy: [{ role: 'asc' }, { joinedAt: 'asc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    const items: MemberView[] = rows
      .map((row) => ({
        userId: row.userId,
        displayName: row.user.displayName,
        role: row.role,
        joinedAt: row.joinedAt,
      }))
      // Prisma orders enums by definition order (OWNER < MODERATOR < MEMBER),
      // which happens to match; the explicit sort keeps that guarantee local
      // instead of implicit in the schema.
      .sort(
        (a, b) =>
          ROLE_ORDER[a.role] - ROLE_ORDER[b.role] ||
          a.joinedAt.getTime() - b.joinedAt.getTime(),
      );

    return {
      items,
      meta: {
        page,
        limit,
        total,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  /** Direct add by email; the account must exist. Always joins as MEMBER. */
  async invite(
    ctx: CommunityContext,
    dto: InviteMemberDto,
  ): Promise<MemberView> {
    const invitee = await this.prisma.user.findUnique({
      where: { email: dto.email },
      select: { id: true, displayName: true },
    });

    // Mods need actionable feedback here; this is not the login form, and
    // disclosing account existence to a community moderator is the accepted
    // tradeoff of invite-by-email (documented in the README).
    if (!invitee) {
      throw new NotFoundException('No account uses that email address.');
    }

    try {
      const membership = await this.prisma.membership.create({
        data: {
          userId: invitee.id,
          communityId: ctx.community.id,
          role: 'MEMBER',
        },
        select: MEMBER_SELECT,
      });
      return {
        userId: membership.userId,
        displayName: membership.user.displayName,
        role: membership.role,
        joinedAt: membership.joinedAt,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('They are already a member.');
      }
      throw error;
    }
  }

  async remove(
    actor: AuthenticatedUser,
    ctx: CommunityContext,
    targetUserId: string,
  ): Promise<void> {
    this.policy.assertNotSelf(actor.id, targetUserId, 'remove');

    await this.prisma.$transaction(async (tx) => {
      await this.policy.lockCommunity(tx, ctx.community.id);

      const target = await tx.membership.findUnique({
        where: {
          userId_communityId: {
            userId: targetUserId,
            communityId: ctx.community.id,
          },
        },
        select: { id: true, role: true },
      });
      if (!target) {
        throw new NotFoundException('They are not a member of this community.');
      }

      this.policy.assertModeratorCannotTouchOwner(ctx.actorRole, target.role);
      await this.policy.assertNotLastOwner(tx, ctx.community.id, target.role);

      await tx.membership.delete({ where: { id: target.id } });
    });
  }

  async changeRole(
    actor: AuthenticatedUser,
    ctx: CommunityContext,
    targetUserId: string,
    dto: ChangeRoleDto,
  ): Promise<MemberView> {
    this.policy.assertNotSelf(actor.id, targetUserId, 'change the role of');

    return this.prisma.$transaction(async (tx) => {
      await this.policy.lockCommunity(tx, ctx.community.id);

      const target = await tx.membership.findUnique({
        where: {
          userId_communityId: {
            userId: targetUserId,
            communityId: ctx.community.id,
          },
        },
        select: { id: true, role: true },
      });
      if (!target) {
        throw new NotFoundException('They are not a member of this community.');
      }

      if (target.role === dto.role) {
        throw new ConflictException(`They are already ${dto.role}.`);
      }

      // a demotion away from OWNER must not orphan the community
      if (target.role === 'OWNER') {
        await this.policy.assertNotLastOwner(tx, ctx.community.id, target.role);
      }

      const updated = await tx.membership.update({
        where: { id: target.id },
        data: { role: dto.role },
        select: MEMBER_SELECT,
      });

      return {
        userId: updated.userId,
        displayName: updated.user.displayName,
        role: updated.role,
        joinedAt: updated.joinedAt,
      };
    });
  }
}
