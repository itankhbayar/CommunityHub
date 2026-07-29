import { Community, SessionUser } from './types';

/**
 * UI-side role checks for showing/hiding controls. The server enforces every
 * one of these independently — hiding a button is UX, never security.
 */

export function isPlatformAdmin(user: SessionUser | null | undefined): boolean {
  return user?.globalRole === 'PLATFORM_ADMIN';
}

/** create/edit/delete posts of others, manage events, invite/remove members */
export function canModerate(
  user: SessionUser | null | undefined,
  community: Community,
): boolean {
  return (
    isPlatformAdmin(user) ||
    community.callerRole === 'OWNER' ||
    community.callerRole === 'MODERATOR'
  );
}

/** change roles, update settings, delete community */
export function canManageCommunity(
  user: SessionUser | null | undefined,
  community: Community,
): boolean {
  return isPlatformAdmin(user) || community.callerRole === 'OWNER';
}

/** post, like, RSVP */
export function isMember(
  user: SessionUser | null | undefined,
  community: Community,
): boolean {
  return isPlatformAdmin(user) || community.callerRole !== null;
}
