import { CommunityRole, GlobalRole } from '../generated/prisma/enums';
import { ActorRole } from './permissions';

/**
 * Collapses (global role, membership-in-this-community) into the actor's
 * effective standing for one community.
 *
 * The membership argument is always freshly loaded from the database by the
 * guard — never derived from a token claim — which is what makes a role change
 * apply on the very next request (business rule 4).
 */
export function effectiveRole(
  globalRole: GlobalRole | undefined,
  membershipRole: CommunityRole | null | undefined,
): ActorRole {
  if (globalRole === 'PLATFORM_ADMIN') return 'PLATFORM_ADMIN';

  switch (membershipRole) {
    case 'OWNER':
      return 'OWNER';
    case 'MODERATOR':
      return 'MODERATOR';
    case 'MEMBER':
      return 'MEMBER';
    default:
      return 'NON_MEMBER';
  }
}
