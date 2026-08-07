'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

type Status = 'working' | 'done' | 'failed';

function VerifyEmail() {
  const searchParams = useSearchParams();
  const { user, refresh } = useSession();

  const token = searchParams.get('token') ?? '';

  const [status, setStatus] = useState<Status>('working');
  const [error, setError] = useState<string | null>(null);

  // The token is single use, so submitting it twice burns it and reports
  // failure for what was actually a success. React's dev-mode double effect
  // does exactly that, and so does any re-render that retriggers the effect —
  // a ref survives both and makes one attempt the hard limit.
  const attempted = useRef(false);

  useEffect(() => {
    if (!token || attempted.current) return;
    attempted.current = true;

    void (async () => {
      try {
        await api('/auth/verify-email', { method: 'POST', body: { token } });
        setStatus('done');
        // clears the advisory banner for a signed-in visitor; harmless no-op
        // for someone who opened the link on a device with no session
        await refresh();
      } catch (caught) {
        setError(
          caught instanceof ApiError
            ? caught.message
            : "Couldn't confirm your email. Please try again.",
        );
        setStatus('failed');
      }
    })();
  }, [token, refresh]);

  if (!token) {
    return (
      <Shell title="This link is incomplete">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          It&apos;s missing its token, which usually means the address got cut
          off when it was copied. Open the link from your email directly.
        </p>
      </Shell>
    );
  }

  if (status === 'working') {
    return (
      <Shell title="Confirming your email…">
        <div
          aria-busy="true"
          className="h-4 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800"
        />
      </Shell>
    );
  }

  if (status === 'failed') {
    return (
      <Shell title="That link didn't work">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{error}</p>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {/* the most common cause by far is a second click on a link that
              already worked, so say so before offering a fix */}
          If you already confirmed this address, you&apos;re all set — the link
          only works once.
        </p>
        <p className="mt-8 text-sm">
          <Link
            href={user ? '/account' : '/login'}
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            {user ? 'Go to your account' : 'Sign in'}
          </Link>
        </p>
      </Shell>
    );
  }

  return (
    <Shell title="Email confirmed">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Thanks — this address is confirmed. If you ever forget your password, we
        can now send you a reset link.
      </p>
      <p className="mt-8 text-sm">
        <Link
          href={user ? '/communities' : '/login'}
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          {user ? 'Browse communities' : 'Sign in'}
        </Link>
      </p>
    </Shell>
  );
}

function Shell({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="mb-4 text-2xl font-bold tracking-tight">{title}</h1>
      {children}
    </div>
  );
}

export default function VerifyEmailPage() {
  // useSearchParams needs a Suspense boundary at the page level
  return (
    <Suspense>
      <VerifyEmail />
    </Suspense>
  );
}
