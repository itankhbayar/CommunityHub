/**
 * The permission matrix from CLAUDE.md, transcribed as data.
 *
 * This file is the single source of truth for "which role may do what kind of
 * thing". Controllers declare a PermissionKey via @RequirePermission and never
 * branch on roles; the PermissionGuard evaluates this table. Because the table
 * is data, the test suite iterates every cell and asserts it against the spec —
 * a drifted cell fails the build rather than shipping.
 *
 * Deliberately NOT here: rules that depend on the *target* of an action
 * (last-owner protection, moderator-vs-owner, self-role-change). Those live in
 * MembershipPolicyService, because a role-keyed table cannot express them.
 */

export const ACTOR_ROLES = [
  'PLATFORM_ADMIN',
  'OWNER',
  'MODERATOR',
  'MEMBER',
  'NON_MEMBER',
] as const;

/** The caller's effective standing within one community's scope. */
export type ActorRole = (typeof ACTOR_ROLES)[number];

export type PermissionKey =
  | 'community:view'
  | 'community:update'
  | 'community:delete'
  | 'post:create'
  | 'post:edit:own'
  | 'post:edit:any'
  | 'post:delete:own'
  | 'post:delete:any'
  | 'post:like'
  | 'event:manage'
  | 'event:rsvp'
  | 'member:invite'
  | 'member:remove'
  | 'member:role:change';

const ALL: readonly ActorRole[] = ACTOR_ROLES;
const MEMBERS_UP: readonly ActorRole[] = [
  'PLATFORM_ADMIN',
  'OWNER',
  'MODERATOR',
  'MEMBER',
];
const MODERATORS_UP: readonly ActorRole[] = [
  'PLATFORM_ADMIN',
  'OWNER',
  'MODERATOR',
];
const OWNERS_UP: readonly ActorRole[] = ['PLATFORM_ADMIN', 'OWNER'];

/**
 * One row per action in the CLAUDE.md table, one entry per allowed role.
 *
 * "View public community and content" is the `community:view` row: everyone,
 * including non-members. Private visibility is not a matrix concern — the
 * guard's visibility gate turns a private community into a 404 for
 * non-members before this table is ever consulted, so existence never leaks.
 */
export const PERMISSION_MATRIX: Record<PermissionKey, readonly ActorRole[]> = {
  'community:view': ALL,
  'community:update': OWNERS_UP,
  'community:delete': OWNERS_UP,
  'post:create': MEMBERS_UP,
  'post:edit:own': MEMBERS_UP,
  'post:edit:any': MODERATORS_UP,
  'post:delete:own': MEMBERS_UP,
  'post:delete:any': MODERATORS_UP,
  // not a row in the CLAUDE.md table — likes exist for the optimistic-UI
  // requirement (decision D1). Members-only, same footing as RSVP.
  'post:like': MEMBERS_UP,
  'event:manage': MODERATORS_UP,
  'event:rsvp': MEMBERS_UP,
  'member:invite': MODERATORS_UP,
  'member:remove': MODERATORS_UP,
  'member:role:change': OWNERS_UP,
};

export function isAllowed(role: ActorRole, permission: PermissionKey): boolean {
  return PERMISSION_MATRIX[permission].includes(role);
}
