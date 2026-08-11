'use client';

import Link from 'next/link';
import { useSession } from '@/lib/session';

/**
 * The closing pitch. Renders nothing for a signed-in visitor — asking someone
 * to create the account they are already using is the kind of detail that
 * makes a landing page feel unattended. Presentation only; the server decides
 * what anyone can actually do.
 */
export function ClosingCta() {
  const { user, isLoading } = useSession();

  // no skeleton here: this is the last thing on the page, so appearing a beat
  // late costs nothing and reserving space for a band that may never render
  // would leave a gap above the fold-end for signed-in users
  if (isLoading || user) return null;

  return (
    <section className="mx-auto max-w-5xl px-4 pb-20">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white px-6 py-12 text-center dark:border-indigo-900/60 dark:from-indigo-950/40 dark:to-zinc-950">
        <h2 className="text-2xl font-bold tracking-tight text-balance sm:text-3xl">
          Your next group is already meeting.
        </h2>
        <p className="max-w-md text-zinc-600 dark:text-zinc-400">
          Make an account, join a community, and put yourself on the list for
          the next one.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <Link
            href="/register"
            className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
          >
            Create an account
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:bg-transparent dark:hover:bg-zinc-900"
          >
            Sign in
          </Link>
        </div>
      </div>
    </section>
  );
}
