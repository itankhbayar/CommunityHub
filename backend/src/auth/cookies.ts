import { CookieOptions, Response } from 'express';

export const ACCESS_COOKIE = 'ch_access';
export const REFRESH_COOKIE = 'ch_refresh';

/** Only /auth/refresh and /auth/logout ever need the refresh token. */
const REFRESH_COOKIE_PATH = '/auth';

/**
 * True when web and API are served from different registrable domains — the
 * split-host deploy (Vercel frontend, API elsewhere) rather than the compose
 * setup where both are localhost.
 *
 * This is not a tuning knob. A Lax or Strict cookie set by a cross-site
 * response is dropped by the browser outright: login returns 200 and the user
 * is still logged out. SameSite=None is the only value that survives, and it
 * forfeits the CSRF protection SameSite was giving us — hence opt-in, and
 * hence the tradeoff is documented in the README rather than buried here.
 */
function crossSite(): boolean {
  return (process.env.COOKIE_SAMESITE ?? '').toLowerCase() === 'none';
}

function secure(): boolean {
  // Browsers reject SameSite=None without Secure, so cross-site implies it
  // regardless of COOKIE_SECURE — an inconsistent pair would fail silently.
  return process.env.COOKIE_SECURE === 'true' || crossSite();
}

function baseOptions(): CookieOptions {
  return {
    httpOnly: true, // unreadable from JS, so XSS cannot exfiltrate the token
    secure: secure(),
  };
}

/** Same-origin deploys keep the stricter defaults; only cross-site relaxes. */
function accessSameSite(): 'lax' | 'none' {
  return crossSite() ? 'none' : 'lax';
}

function refreshSameSite(): 'strict' | 'none' {
  return crossSite() ? 'none' : 'strict';
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
    sameSite: accessSameSite(),
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
    sameSite: refreshSameSite(),
    path: REFRESH_COOKIE_PATH,
    expires: expiresAt,
  });
}

export function clearAuthCookies(res: Response): void {
  // clearCookie only matches when these attributes mirror the set call
  res.clearCookie(ACCESS_COOKIE, {
    ...baseOptions(),
    sameSite: accessSameSite(),
    path: '/',
  });
  res.clearCookie(REFRESH_COOKIE, {
    ...baseOptions(),
    sameSite: refreshSameSite(),
    path: REFRESH_COOKIE_PATH,
  });
}
