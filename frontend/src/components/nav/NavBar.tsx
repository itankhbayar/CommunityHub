'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useToast } from '@/components/toast/ToastProvider';

export function NavBar() {
  const { user, isLoading, refresh } = useSession();
  const toast = useToast();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await api<void>('/auth/logout', { method: 'POST' });
      await refresh();
      toast.success('Signed out. See you soon!');
      router.push('/');
    } catch {
      toast.error('Could not sign out. Please try again.');
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-200 bg-white/90 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/90">
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 max-w-5xl items-center gap-4 px-4"
      >
        <Link
          href="/"
          className="rounded text-base font-bold tracking-tight focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          Community<span className="text-indigo-600 dark:text-indigo-400">Hub</span>
        </Link>

        <Link
          href="/communities"
          className="rounded px-2 py-1 text-sm text-zinc-600 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-zinc-400 dark:hover:text-zinc-100"
        >
          Communities
        </Link>

        <div className="ml-auto flex items-center gap-3">
          {isLoading ? (
            // skeleton, not a blank gap: the header never jumps
            <div
              aria-hidden="true"
              className="h-8 w-24 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
            />
          ) : user ? (
            <>
              {/* the name doubles as the way into account settings — a
                  separate nav item for one page would crowd the bar */}
              <Link
                href="/account"
                className="hidden rounded px-1 text-sm text-zinc-600 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 sm:inline dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                {user.displayName}
                {user.globalRole === 'PLATFORM_ADMIN' && (
                  <span className="ml-1.5 rounded bg-indigo-100 px-1.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                    admin
                  </span>
                )}
              </Link>
              <button
                type="button"
                onClick={() => void signOut()}
                disabled={signingOut}
                className="rounded-md border border-zinc-300 px-3 py-1.5 text-sm hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
              >
                {signingOut ? 'Signing out…' : 'Sign out'}
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="rounded-md px-3 py-1.5 text-sm hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:hover:bg-zinc-900"
              >
                Sign in
              </Link>
              <Link
                href="/register"
                className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
              >
                Join
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
