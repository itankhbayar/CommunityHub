'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useEffect, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { Field, FormError, primaryButtonClass } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

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
        <div className="flex gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Signed in as</dt>
          <dd className="font-medium">{user.email}</dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-zinc-500 dark:text-zinc-400">Display name</dt>
          <dd className="font-medium">{user.displayName}</dd>
        </div>
      </dl>

      <hr className="my-8 border-zinc-200 dark:border-zinc-800" />

      <ChangePasswordForm />
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
