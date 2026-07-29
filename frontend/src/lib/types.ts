/** API contract types — mirrors the backend's view models, by hand. */

export type GlobalRole = 'USER' | 'PLATFORM_ADMIN';
export type CommunityRole = 'OWNER' | 'MODERATOR' | 'MEMBER';
export type Visibility = 'PUBLIC' | 'PRIVATE';
export type RsvpStatus = 'GOING' | 'NOT_GOING';

export interface SessionUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
  createdAt: string;
  memberships: {
    role: CommunityRole;
    joinedAt: string;
    community: {
      id: string;
      slug: string;
      name: string;
      visibility: Visibility;
    };
  }[];
}

export interface Community {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: Visibility;
  createdAt: string;
  memberCount: number;
  callerRole: CommunityRole | null;
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  items: T[];
  meta: PageMeta;
}

export interface Post {
  id: string;
  body: string;
  likeCount: number;
  likedByMe: boolean;
  isMine: boolean;
  createdAt: string;
  updatedAt: string;
  author: { id: string; displayName: string };
}

export interface Feed {
  items: Post[];
  nextCursor: string | null;
}

export interface CommunityEvent {
  id: string;
  title: string;
  description: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  capacity: number | null;
  goingCount: number;
  myStatus: RsvpStatus | null;
  createdBy: { id: string; displayName: string };
  createdAt: string;
  community: { id: string; slug: string; name: string };
}

export interface RsvpResult {
  status: RsvpStatus;
  goingCount: number;
}

export interface Member {
  userId: string;
  displayName: string;
  role: CommunityRole;
  joinedAt: string;
}

export interface Attendee {
  userId: string;
  displayName: string;
  rsvpedAt: string;
}

/** The backend's single error envelope shape. */
export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
  details?: string[];
}
