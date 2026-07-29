import { Membership } from '../generated/prisma/client';
import { CommunityRole, Visibility } from '../generated/prisma/enums';
import { ActorRole } from './permissions';

/** The slice of Community the guard needs; services re-select what they need. */
export interface CommunitySummary {
  id: string;
  slug: string;
  name: string;
  visibility: Visibility;
}

/**
 * Everything the guard resolved on the way to its decision, attached to the
 * request so handlers reuse it instead of re-querying: the community, the
 * caller's fresh membership, and — when the route was addressed via
 * :postId/:eventId — that resource row itself.
 */
export interface CommunityContext {
  community: CommunitySummary;
  /** loaded from the database this request; null for non-members and guests */
  membership: Pick<Membership, 'id' | 'role' | 'userId'> | null;
  actorRole: ActorRole;
  resource?: ResolvedResource;
}

export interface ResolvedResource {
  kind: 'post' | 'event';
  id: string;
  /** authorId for posts, createdById for events */
  [key: string]: unknown;
}

export function membershipRoleOf(ctx: CommunityContext): CommunityRole | null {
  return ctx.membership?.role ?? null;
}
