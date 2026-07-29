import {
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client.js';
import { ActorRole } from '../permissions';

/**
 * Target-aware membership invariants — the rules the permission matrix cannot
 * express because they depend on the state or target of the mutation, not just
 * the actor's role:
 *
 *   1. a community always keeps at least one OWNER
 *   2. a MODERATOR cannot remove or demote an OWNER   (added with members module)
 *   3. nobody changes their own role                  (added with members module)
 *
 * The guard answers "may this actor do this kind of thing here"; this service
 * answers "is this specific mutation legal". Every method expects to run
 * INSIDE a transaction whose first act was locking the community row — that
 * lock serializes concurrent membership mutations per community, so two
 * owners leaving simultaneously cannot both observe "2 owners" and drop the
 * community to zero.
 */
@Injectable()
export class MembershipPolicyService {
  /** Locks the community row; call first inside the mutation's transaction. */
  async lockCommunity(
    tx: Prisma.TransactionClient,
    communityId: string,
  ): Promise<void> {
    await tx.$queryRaw`SELECT id FROM "Community" WHERE id = ${communityId}::uuid FOR UPDATE`;
  }

  /**
   * Rule 1: refuses the mutation when it would remove the community's last
   * OWNER. Only relevant when the affected membership currently holds OWNER.
   */
  async assertNotLastOwner(
    tx: Prisma.TransactionClient,
    communityId: string,
    affectedRole: string,
  ): Promise<void> {
    if (affectedRole !== 'OWNER') return;

    const owners = await tx.membership.count({
      where: { communityId, role: 'OWNER' },
    });

    if (owners <= 1) {
      throw new ConflictException(
        'A community must keep at least one owner. Transfer ownership first.',
      );
    }
  }

  /**
   * Rule 2: a MODERATOR may not remove (or otherwise act on) an OWNER.
   * The demotion half of rule 2 is already unreachable — the matrix denies
   * moderators 'member:role:change' entirely — so this covers removal.
   */
  assertModeratorCannotTouchOwner(
    actorRole: ActorRole,
    targetRole: string,
  ): void {
    if (actorRole === 'MODERATOR' && targetRole === 'OWNER') {
      throw new ForbiddenException('Moderators cannot remove an owner.');
    }
  }

  /**
   * Rule 3: nobody changes their own role — not owners, not platform admins.
   * Self-removal is likewise refused here; leaving is its own endpoint with
   * its own semantics, and one code path for "membership ends" is enough.
   */
  assertNotSelf(
    actorUserId: string,
    targetUserId: string,
    action: 'change the role of' | 'remove',
  ): void {
    if (actorUserId === targetUserId) {
      throw new ForbiddenException(
        action === 'remove'
          ? 'You cannot remove yourself — leave the community instead.'
          : 'You cannot change your own role.',
      );
    }
  }
}
