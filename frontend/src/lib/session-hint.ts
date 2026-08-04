'use client';

import { useSyncExternalStore } from 'react';

/**
 * A last-known "was this browser signed in?" flag, used only to decide which
 * placeholder the nav shows while `GET /auth/me` is in flight.
 *
 * Why this exists: the session is resolved by a network round trip on every
 * page load, and on a cold-started free-tier API that round trip can take
 * ~30s. Without a hint the nav has to assume "maybe signed in" and show a
 * skeleton the whole time, so a signed-out visitor waits half a minute for a
 * Sign in button whose answer never depended on the server.
 *
 * Why localStorage rather than a cookie: web and API are on different
 * registrable domains in the split-host deploy, so a cookie set by the API is
 * sent back to the API but is invisible to `document.cookie` on the web
 * origin. localStorage is per-origin and written by the frontend, so it works
 * in both the split-host and same-origin (compose) setups.
 *
 * This is a rendering hint and nothing else. It carries no token, no identity
 * and no roles; it is trivially forgeable by the user, and forging it buys
 * exactly one skeleton. Authorization is the server's, always.
 */
const KEY = 'ch_session_hint';

const listeners = new Set<() => void>();

/**
 * Cached because useSyncExternalStore requires getSnapshot to be cheap and to
 * return a stable value between store changes.
 */
let snapshot: boolean | null = null;

function read(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    // Storage can throw outright (Safari private mode, blocked third-party
    // storage). Treat it as "no hint" — the nav just falls back to the
    // signed-out placeholder.
    return false;
  }
}

function getSnapshot(): boolean {
  snapshot ??= read();
  return snapshot;
}

/** localStorage does not exist during SSR; assume signed out. See useSessionHint. */
function getServerSnapshot(): boolean {
  return false;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);

  // Signing in or out in another tab writes the same key.
  const onStorage = (event: StorageEvent) => {
    if (event.key !== KEY) return;
    snapshot = read();
    onChange();
  };
  window.addEventListener('storage', onStorage);

  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onStorage);
  };
}

/** Called when /auth/me resolves — the only writer. */
export function setSessionHint(signedIn: boolean): void {
  try {
    if (signedIn) window.localStorage.setItem(KEY, '1');
    else window.localStorage.removeItem(KEY);
  } catch {
    // Unwritable storage degrades to the pre-hint behavior, which is correct,
    // just slower. Never worth breaking a render over.
  }

  if (snapshot === signedIn) return;
  snapshot = signedIn;
  for (const listener of listeners) listener();
}

/**
 * True when this browser was signed in the last time we heard from the server.
 *
 * Server-rendered as `false`, so the markup a signed-out visitor receives
 * already contains the real Sign in / Join links. A signed-in visitor gets
 * those links too and they are replaced at hydration — a frame or two, versus
 * the ~30s of skeleton this exists to remove.
 */
export function useSessionHint(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
