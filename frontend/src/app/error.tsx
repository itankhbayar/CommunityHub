'use client';

/**
 * Route-level error boundary: whatever throws below the layout renders as a
 * readable message with a retry — never a blank screen, never a stack trace.
 */
export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="text-3xl" aria-hidden="true">
        😵
      </p>
      <h1 className="text-lg font-semibold">Something went wrong</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {error.message || 'An unexpected error occurred.'}
      </p>
      <button
        type="button"
        onClick={reset}
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        Try again
      </button>
    </div>
  );
}
