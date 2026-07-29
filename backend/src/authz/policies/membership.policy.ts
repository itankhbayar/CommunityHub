import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

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
}
