import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 px-4 py-24 text-center">
      <p className="text-3xl" aria-hidden="true">
        🧭
      </p>
      <h1 className="text-lg font-semibold">Page not found</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        This page doesn&apos;t exist — or it lives in a private community you&apos;re
        not part of.
      </p>
      <Link
        href="/communities"
        className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
      >
        Browse communities
      </Link>
    </div>
  );
}
