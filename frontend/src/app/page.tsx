import Link from 'next/link';

export default function Home() {
  return (
    <div className="mx-auto flex max-w-2xl flex-col items-center gap-6 px-4 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight">
        Find your people.
        <br />
        <span className="text-indigo-600 dark:text-indigo-400">
          Make things happen.
        </span>
      </h1>
      <p className="max-w-md text-zinc-600 dark:text-zinc-400">
        CommunityHub is where interest-based communities share updates and
        organize real-world meetups — hikes, book clubs, cleanups, and whatever
        yours does best.
      </p>
      <div className="flex gap-3">
        <Link
          href="/communities"
          className="rounded-md bg-indigo-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500"
        >
          Browse communities
        </Link>
        <Link
          href="/register"
          className="rounded-md border border-zinc-300 px-5 py-2.5 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Create an account
        </Link>
      </div>
    </div>
  );
}
