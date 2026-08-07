'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { FormEvent, Suspense, useState } from 'react';
import { Field, FormError, primaryButtonClass } from '@/components/ui/form';
import { useToast } from '@/components/toast/ToastProvider';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refresh } = useSession();
  const toast = useToast();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});

  // only ever redirect within this site — a full URL in ?next= is ignored
  const nextParam = searchParams.get('next');
  const nextPath = nextParam?.startsWith('/') && !nextParam.startsWith('//') ? nextParam : '/communities';

  function validate(): boolean {
    const errors: typeof fieldErrors = {};
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = 'Enter a valid email address.';
    if (password.length === 0) errors.password = 'Enter your password.';
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (pending || !validate()) return;

    setPending(true);
    setFormError(null);
    try {
      await api('/auth/login', { method: 'POST', body: { email: email.trim(), password } });
      await refresh();
      toast.success('Welcome back!');
      router.push(nextPath);
    } catch (error) {
      setFormError(
        error instanceof ApiError ? error.message : 'Could not sign in. Please try again.',
      );
      setPending(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="mb-6 text-2xl font-bold tracking-tight">Sign in</h1>
      <form onSubmit={(e) => void onSubmit(e)} noValidate className="flex flex-col gap-4">
        <FormError>{formError}</FormError>
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
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={fieldErrors.password}
        />
        <div className="-mt-1 text-right">
          <Link
            href="/forgot-password"
            className="rounded text-sm text-zinc-600 underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-zinc-400"
          >
            Forgot password?
          </Link>
        </div>
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
        New here?{' '}
        <Link
          href="/register"
          className="font-medium text-indigo-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  // useSearchParams requires a Suspense boundary at the page level
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
