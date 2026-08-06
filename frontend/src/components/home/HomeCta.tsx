'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session';

const primaryClass =
  'rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500';

const secondaryClass =
  'rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:hover:bg-zinc-900';

/**
 * The hero's calls to action. A client component because the session lives in
 * React state, not in the server render — the page itself stays static.
 *
 * "Create an account" is the whole point of the hero for a visitor and pure
 * noise for someone already signed in, so it is gated on the session the same
 * way the nav is. The server enforces nothing here; this is presentation only.
 */
export function HomeCta() {
  const { user, isLoading } = useSession();

  return (
    <div className="flex flex-wrap justify-center gap-3">
      {/* session-independent, so it renders immediately rather than behind the
          skeleton — the hero is never actionless */}
      <Link href="/communities" className={primaryClass}>
        Browse communities
      </Link>

      {isLoading ? (
        // reserves the second slot at its resolved size, so the anonymous case
        // (by far the common one for a landing page) settles without a jump
        <div
          aria-hidden="true"
          className="h-10 w-40 animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800"
        />
      ) : (
        // signed in: "Browse communities" is the only action left worth
        // offering from the hero, so the row collapses to one button rather
        // than padding it out with a link to somewhere they have already been
        !user && (
          <Link href="/register" className={secondaryClass}>
            Create an account
          </Link>
        )
      )}
    </div>
  );
}
