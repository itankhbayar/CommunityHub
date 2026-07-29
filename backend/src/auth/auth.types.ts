import { GlobalRole } from '../generated/prisma/enums';

/**
 * Access token payload.
 *
 * Deliberately carries identity only — no roles, no memberships. Community
 * roles are read from the database on every guarded request so that a
 * downgrade takes effect immediately rather than at token expiry.
 */
export interface AccessTokenPayload {
  sub: string;
}

/** What the guards attach to `request.user`. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  globalRole: GlobalRole;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
