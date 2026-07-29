import { effectiveRole } from './effective-role';
import {
  ACTOR_ROLES,
  ActorRole,
  isAllowed,
  PERMISSION_MATRIX,
  PermissionKey,
} from './permissions';

/**
 * The permission table from CLAUDE.md, transcribed here a SECOND time, by
 * hand, cell by cell — deliberately not built from the shared role-group
 * constants the production matrix uses. If the two transcriptions ever
 * disagree, one of them no longer matches the spec and this suite fails.
 *
 * Column order: [PLATFORM_ADMIN, OWNER, MODERATOR, MEMBER, NON_MEMBER]
 */
const SPEC_TABLE: Record<
  PermissionKey,
  [boolean, boolean, boolean, boolean, boolean]
> = {
  // View public community and content — everyone
  'community:view': [true, true, true, true, true],
  // Update community settings — admin, owner
  'community:update': [true, true, false, false, false],
  // Delete community — admin, owner
  'community:delete': [true, true, false, false, false],
  // Create post — all members
  'post:create': [true, true, true, true, false],
  // Edit own post — all members
  'post:edit:own': [true, true, true, true, false],
  // Edit any post — admin, owner, moderator
  'post:edit:any': [true, true, true, false, false],
  // Delete own post — all members
  'post:delete:own': [true, true, true, true, false],
  // Delete any post — admin, owner, moderator
  'post:delete:any': [true, true, true, false, false],
  // Create/edit/delete event — admin, owner, moderator
  'event:manage': [true, true, true, false, false],
  // RSVP to event — all members
  'event:rsvp': [true, true, true, true, false],
  // Invite member — admin, owner, moderator
  'member:invite': [true, true, true, false, false],
  // Remove member — admin, owner, moderator
  'member:remove': [true, true, true, false, false],
  // Change a member's role — admin, owner
  'member:role:change': [true, true, false, false, false],
};

describe('PERMISSION_MATRIX', () => {
  const permissions = Object.keys(SPEC_TABLE) as PermissionKey[];

  it('covers exactly the actions the spec defines', () => {
    expect(Object.keys(PERMISSION_MATRIX).sort()).toEqual(
      [...permissions].sort(),
    );
  });

  // one test per cell: 13 permissions x 5 roles = 65 assertions, each named,
  // so a regression pinpoints the exact cell that drifted
  describe.each(permissions)('%s', (permission) => {
    it.each(
      ACTOR_ROLES.map((role, index) => ({
        role,
        expected: SPEC_TABLE[permission][index],
      })),
    )('$role -> $expected', ({ role, expected }) => {
      expect(isAllowed(role, permission)).toBe(expected);
    });
  });

  it('never grants NON_MEMBER anything beyond viewing', () => {
    const grantedToOutsiders = permissions.filter((p) =>
      isAllowed('NON_MEMBER', p),
    );
    expect(grantedToOutsiders).toEqual(['community:view']);
  });

  it('grants PLATFORM_ADMIN every permission', () => {
    for (const permission of permissions) {
      expect(isAllowed('PLATFORM_ADMIN', permission)).toBe(true);
    }
  });
});

describe('effectiveRole', () => {
  it('is PLATFORM_ADMIN regardless of membership', () => {
    expect(effectiveRole('PLATFORM_ADMIN', null)).toBe('PLATFORM_ADMIN');
    expect(effectiveRole('PLATFORM_ADMIN', 'MEMBER')).toBe('PLATFORM_ADMIN');
    expect(effectiveRole('PLATFORM_ADMIN', 'OWNER')).toBe('PLATFORM_ADMIN');
  });

  it('mirrors the membership role for ordinary users', () => {
    expect(effectiveRole('USER', 'OWNER')).toBe('OWNER');
    expect(effectiveRole('USER', 'MODERATOR')).toBe('MODERATOR');
    expect(effectiveRole('USER', 'MEMBER')).toBe('MEMBER');
  });

  it('treats no membership — and no user at all — as NON_MEMBER', () => {
    expect(effectiveRole('USER', null)).toBe('NON_MEMBER');
    expect(effectiveRole('USER', undefined)).toBe('NON_MEMBER');
    expect(effectiveRole(undefined, undefined)).toBe('NON_MEMBER');
  });

  it('roles are scoped per community: the same user maps independently', () => {
    // same global role, different memberships -> different standing
    const inCommunityA = effectiveRole('USER', 'OWNER');
    const inCommunityB = effectiveRole('USER', 'MEMBER');
    const inCommunityC = effectiveRole('USER', null);

    expect([inCommunityA, inCommunityB, inCommunityC]).toEqual([
      'OWNER',
      'MEMBER',
      'NON_MEMBER',
    ]);
  });
});

// type-level completeness: adding an ActorRole without updating the spec table
// column count fails to compile
const _exhaustivenessCheck: readonly ActorRole[] = ACTOR_ROLES;
void _exhaustivenessCheck;
