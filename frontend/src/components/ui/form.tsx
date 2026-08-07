'use client';

import { Children, InputHTMLAttributes, ReactNode } from 'react';

/** Shared input styling so every form looks and focuses the same way. */
export const inputClass =
  'w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-2 focus:outline-offset-0 focus:outline-indigo-500/40 disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900';

export const primaryButtonClass =
  'inline-flex items-center justify-center rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50';

export const secondaryButtonClass =
  'inline-flex items-center justify-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900';

export const dangerButtonClass =
  'inline-flex items-center justify-center rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:cursor-not-allowed disabled:opacity-50';

interface FieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  /** inline validation message; renders below and is announced */
  error?: string | null;
  hint?: string;
}

export function Field({ label, error, hint, id, ...rest }: FieldProps) {
  const fieldId = id ?? rest.name ?? label;
  const errorId = `${fieldId}-error`;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={fieldId} className="text-sm font-medium">
        {label}
      </label>
      <input
        id={fieldId}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        className={`${inputClass} ${error ? 'border-red-500 dark:border-red-600' : ''}`}
        {...rest}
      />
      {hint && !error && (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{hint}</p>
      )}
      {error && (
        <p id={errorId} role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </div>
  );
}

export function FormError({ children }: { children: ReactNode }) {
  // `if (!children)` was not enough. A caller passing two conditional children
  // — a message plus a link shown only for certain messages — hands React an
  // array, and `[null, false]` is truthy, so an empty red alert box rendered
  // above the form with nothing in it. Children.toArray drops null, undefined
  // and booleans; the string check covers a server sending `message: ""`.
  // Worth doing here rather than only at the call site: an empty role="alert"
  // is also announced to screen readers as an alert with no content.
  const content = Children.toArray(children).filter(
    (child) => typeof child !== 'string' || child.trim() !== '',
  );

  if (content.length === 0) return null;

  return (
    <div
      role="alert"
      className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
    >
      {children}
    </div>
  );
}
