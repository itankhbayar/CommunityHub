'use client';

import { useSyncExternalStore } from 'react';
import { useSession } from '@/lib/session';
import { useResendVerification } from '@/lib/useResendVerification';

/** Dismissal lasts the browser tab, not forever — this is a nudge, not a task. */
const DISMISSED_KEY = 'communityhub:verify-banner-dismissed';

/**
 * sessionStorage is state React does not own, so it is read through
 * useSyncExternalStore rather than copied into useState from an effect. That
 * keeps the server render and the hydration render agreeing by construction:
 * the server cannot know the value, says "dismissed", and React re-renders
 * once with the real one instead of flashing a banner the user already closed.
 *
 * The listener set exists because same-tab writes do not fire a `storage`
 * event — that only fires in *other* tabs — so dismiss() has to notify itself.
 */
const listeners = new Set<() => void>();

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  window.addEventListener('storage', onStoreChange);
  return () => {
    listeners.delete(onStoreChange);
    window.removeEventListener('storage', onStoreChange);
  };
}

const isDismissed = () => sessionStorage.getItem(DISMISSED_KEY) === '1';
const isDismissedOnServer = () => true;

function dismiss(): void {
  sessionStorage.setItem(DISMISSED_KEY, '1');
  listeners.forEach((notify) => notify());
}

/**
 * Advisory only. Nothing in the app is gated on a confirmed address, which is
 * a deliberate choice: the one thing verification actually buys is a working
 * password reset, and locking someone out of the product to protect them from
 * a future lockout is backwards. So this informs, offers a resend, and the app
 * carries on either way.
 */
export function VerifyEmailBanner() {
  const { user } = useSession();
  const { resend, pending } = useResendVerification();

  const dismissed = useSyncExternalStore(
    subscribe,
    isDismissed,
    isDismissedOnServer,
  );

  if (!user || user.emailVerifiedAt || dismissed) return null;

  return (
    <div
      // polite, not alert: this is background information and must not
      // interrupt a screen reader mid-sentence on every page load
      role="status"
      className="border-b border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10"
    >
      <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
        <p className="text-amber-900 dark:text-amber-200">
          <span className="font-medium">Confirm your email address.</span>{' '}
          {/* explicit: JSX drops the space that would otherwise sit between the
              span and this text when the line wraps */}
          Until you do, we can&apos;t send you a reset link if you forget your
          password.
        </p>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => void resend()}
            disabled={pending}
            className="rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:opacity-60 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
          >
            {pending ? 'Sending…' : 'Resend email'}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="rounded-md px-2 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 dark:text-amber-200 dark:hover:bg-amber-500/20"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
