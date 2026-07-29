'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { Field, FormError, primaryButtonClass } from '@/components/ui/form';
import { useToast } from '@/components/toast/ToastProvider';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

export default function RegisterPage() {
  const router = useRouter();
  const { refresh } = useSession();
  const toast = useToast();

  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{
    displayName?: string;
    email?: string;
    password?: string;
  }>({});

  function validate(): boolean {
    const errors: typeof fieldErrors = {};
    if (displayName.trim().length === 0) errors.displayName = 'Tell us what to call you.';
    if (displayName.trim().length > 60) errors.displayName = 'Keep it under 60 characters.';
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (password.length < 8) errors.password = 'Password must be at least 8 characters.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || !validate()) return;

    setPending(true);
    setFormError(null);
    try {
      await api('/auth/register', {
        method: 'POST',
        body: { displayName: displayName.trim(), email: email.trim(), password },
      });
      await refresh();
      toast.success(`Welcome to CommunityHub, ${displayName.trim()}!`);
      router.push('/communities');
    } catch (error) {
      if (error instanceof ApiError && error.details.length > 0) {
        setFormError(error.details.join(' '));
      } else {
        setFormError(
          error instanceof ApiError ? error.message : 'Could not create the account. Please try again.',
        );
      }
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Create your account</h1>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        <FormError>{formError}</FormError>
        <Field
          label="Display name"
          name="displayName"
          autoComplete="name"
          required
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          error={fieldErrors.displayName}
        />
        <Field
          label="Email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={fieldErrors.email}
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
          hint="At least 8 characters."
        />
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        Already have an account?{' '}
        <Link
          href="/login"
          className="font-medium text-indigo-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
        >
          Sign in
        </Link>
      </p>
    </div>
  );
}
