'use client';

import Link from 'next/link';
import { FormEvent, useState } from 'react';
import { Field, FormError, primaryButtonClass } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [fieldError, setFieldError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending) return;

    if (!/^\S+@\S+\.\S+$/.test(email.trim())) {
      setFieldError('Enter a valid email address.');
      return;
    }
    setFieldError(null);
    setPending(true);
    setFormError(null);

    try {
      await api('/auth/forgot-password', {
        method: 'POST',
        body: { email: email.trim() },
      });
      setSent(true);
    } catch (error) {
      // only a network or server fault lands here — the endpoint answers 202
      // for unknown addresses too, on purpose
      setFormError(
        error instanceof ApiError
          ? error.message
          : "Couldn't send the email. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className="mx-auto w-full max-w-sm px-4 py-16">
        <h1 className="text-2xl font-bold tracking-tight">Check your email</h1>
        {/* Deliberately does not confirm the address exists — the API will not
            say, and neither should this screen. */}
        <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          If <span className="font-medium">{email.trim()}</span> belongs to an
          account, a reset link is on its way. It works once and expires in an
          hour.
        </p>
        <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          Nothing arrived? Check spam, or{' '}
          <button
            type="button"
            onClick={() => setSent(false)}
            className="font-medium text-indigo-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
          >
            try another address
          </button>
          .
        </p>
        <p className="mt-8 text-sm">
          <Link
            href="/login"
            className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
          >
            Back to sign in
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Reset your password</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Enter your email and we&apos;ll send a link to set a new password.
      </p>

      <form
        onSubmit={(e) => void onSubmit(e)}
        noValidate
        className="mt-6 flex flex-col gap-4"
      >
        <FormError>{formError}</FormError>
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldError}
        />
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? 'Sending…' : 'Send reset link'}
        </button>
      </form>

      <p className="mt-6 text-sm text-zinc-600 dark:text-zinc-400">
        Remembered it?{' '}
        <Link
          href="/login"
          className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
