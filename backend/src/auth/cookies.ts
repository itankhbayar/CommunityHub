import { CookieOptions, Response } from 'express';

export const ACCESS_COOKIE = 'ch_access';
export const REFRESH_COOKIE = 'ch_refresh';

/** Only /auth/refresh and /auth/logout ever need the refresh token. */
const REFRESH_COOKIE_PATH = '/auth';

function secure(): boolean {
  return process.env.COOKIE_SECURE === 'true';
}

function baseOptions(): CookieOptions {
  return {
    httpOnly: true, // unreadable from JS, so XSS cannot exfiltrate the token
    secure: secure(),
  };
}

export function setAccessCookie(
  res: Response,
  token: string,
  maxAgeMs: number,
): void {
  res.cookie(ACCESS_COOKIE, token, {
    ...baseOptions(),
    // lax, not strict: a top-level GET arriving from an external link should
    // still be authenticated. Lax withholds the cookie from cross-site
    // POST/PATCH/DELETE, which is what CSRF would need.
    sameSite: 'lax',
    path: '/',
    maxAge: maxAgeMs,
  });
}

export function setRefreshCookie(
  res: Response,
  token: string,
  expiresAt: Date,
): void {
  res.cookie(REFRESH_COOKIE, token, {
    ...baseOptions(),
    // strict: nothing legitimate ever mints tokens from a cross-site context
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, {
    ...baseOptions(),
    sameSite: 'lax',
    path: '/',
  });
  res.clearCookie(REFRESH_COOKIE, {
    ...baseOptions(),
    sameSite: 'strict',
    path: REFRESH_COOKIE_PATH,
  });
}
