'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { Field, FormError, primaryButtonClass } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useResendVerification } from '@/lib/useResendVerification';

export default function AccountPage() {
  const { user, isLoading } = useSession();
  const router = useRouter();

  // signed out — bounce to login, preserving the destination
  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login?next=/account');
    }
  }, [isLoading, user, router]);

  if (isLoading) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16" aria-busy="true">
        <div className="h-8 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-6 h-48 w-full animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      </div>
    );
  }

  if (!user) {
    // the effect above is already redirecting; this is the one frame before it
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Redirecting to sign in…
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Your account</h1>
      <dl className="mt-4 flex flex-col gap-1 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Signed in as</dt>
          <dd className="font-medium">{user.email}</dd>
          <dd>
            <EmailStatusBadge verifiedAt={user.emailVerifiedAt} />
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Display name</dt>
          <dd className="font-medium">{user.displayName}</dd>
        </div>
      </dl>

      {!user.emailVerifiedAt && <ConfirmEmailPrompt />}

      <hr className="my-8 border-zinc-200 dark:border-zinc-800" />

      <ChangePasswordForm />
    </div>
  );
}

function EmailStatusBadge({ verifiedAt }: { verifiedAt: string | null }) {
  if (verifiedAt) {
    return (
      <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
        Confirmed
      </span>
    );
  }

  return (
    <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">
      Not confirmed
    </span>
  );
}

/**
 * The banner can be dismissed for the tab; this cannot. Someone who came here
 * deliberately — often following the "request a new one" line on a failed
 * confirmation link — needs the resend to be findable, not hidden behind a
 * notice they already closed.
 */
function ConfirmEmailPrompt() {
  const { resend, pending } = useResendVerification();

  return (
    <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-500/30 dark:bg-amber-500/10">
      <p className="text-sm text-amber-900 dark:text-amber-200">
        Confirming your address is what makes &ldquo;reset by email&rdquo;
        possible. Without it, a forgotten password cannot be recovered.
      </p>
      <button
        type="button"
        onClick={() => void resend()}
        disabled={pending}
        className="mt-3 rounded-md bg-amber-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-700 disabled:opacity-60 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
      >
        {pending ? 'Sending…' : 'Send confirmation email'}
      </button>
    </div>
  );
}

function ChangePasswordForm() {
  const toast = useToast();
  const { refresh } = useSession();

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // mirrors ChangePasswordDto; the server re-checks all of it
  const nextError =
    next.length < 8 || next.length > 128
      ? 'Password must be at least 8 characters.'
      : next === current
        ? 'Your new password must be different from the current one.'
        : null;
  const confirmError =
    confirm !== next ? 'These passwords do not match.' : null;
  const hasErrors = Boolean(!current || nextError || confirmError);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (hasErrors || pending) return;

    setPending(true);
    setFormError(null);
    try {
      await api('/auth/password', {
        method: 'POST',
        body: { currentPassword: current, newPassword: next },
      });
      // the response reissued this session's cookies; every other session was
      // revoked server-side, so re-read who we are rather than assuming
      await refresh();
      setCurrent('');
      setNext('');
      setConfirm('');
      setTouched(false);
      toast.success('Password changed. Other devices have been signed out.');
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? [error.message, ...error.details].join(' ')
          : "Couldn't change your password. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Change password</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        You will stay signed in here. Every other device is signed out.
      </p>

      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="mt-4 flex flex-col gap-4"
      >
        <FormError>{formError}</FormError>

        <Field
          label="Current password"
          name="current-password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
          error={touched && !current ? 'Enter your current password.' : null}
        />

        <Field
          label="New password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={next}
          onChange={(e) => setNext(e.target.value)}
          error={touched ? nextError : null}
          hint="At least 8 characters."
        />

        <Field
          label="Confirm new password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={touched ? confirmError : null}
        />

        <button
          type="submit"
          disabled={pending || (touched && hasErrors)}
          className={primaryButtonClass}
        >
          {pending ? 'Changing…' : 'Change password'}
        </button>
      </form>

      <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
        Don&apos;t remember your current password?{' '}
        <Link
          href="/forgot-password"
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Reset it by email
        </Link>{' '}
        instead.
      </p>
    </section>
  );
}
