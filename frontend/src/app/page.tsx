import { HomeCta } from '@/components/home/HomeCta';

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
      <HomeCta />
    </div>
  );
}
