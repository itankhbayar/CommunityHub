'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { Field, FormError, primaryButtonClass } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const toast = useToast();

  const token = searchParams.get('token') ?? '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const passwordError =
    password.length < 8 || password.length > 128
      ? 'Password must be at least 8 characters.'
      : null;
  const confirmError =
    confirm !== password ? 'These passwords do not match.' : null;
  const hasErrors = Boolean(passwordError || confirmError);

  // a link without a token is a mangled paste, not a server problem — say so
  // here rather than sending a request that is certain to fail
  if (!token) {
    return (
      <div className="mx-auto w-full max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">
          This link is incomplete
        </h1>
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          It&apos;s missing its token, which usually means the address got cut
          off when it was copied. Open the link from your email directly, or
          request a new one.
        </p>
        <p className="mt-8 text-sm">
          <Link
            href="/forgot-password"
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Request a new link
          </Link>
        </p>
      </div>
    );
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (hasErrors || pending) return;

    setPending(true);
    setFormError(null);
    try {
      await api('/auth/reset-password', {
        method: 'POST',
        body: { token, newPassword: password },
      });
      // no session is issued by design, so this goes to login rather than in
      toast.success('Password reset. Sign in with your new password.');
      router.replace('/login');
    } catch (error) {
      setFormError(
        error instanceof ApiError
          ? [error.message, ...error.details].join(' ')
          : "Couldn't reset your password. Please try again.",
      );
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Set a new password</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Signing you out everywhere else, so any session opened with the old
        password stops working.
      </p>

      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="mt-6 flex flex-col gap-4"
      >
        <FormError>
          {formError}
          {formError?.includes('expired') && (
            <>
              {' '}
              <Link href="/forgot-password" className="font-medium underline">
                Request a new link
              </Link>
              .
            </>
          )}
        </FormError>

        <Field
          label="New password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={touched ? passwordError : null}
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
          {pending ? 'Resetting…' : 'Reset password'}
        </button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  // useSearchParams needs a Suspense boundary at the page level
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
