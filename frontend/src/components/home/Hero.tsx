import { HomeCta } from './HomeCta';

/**
 * The landing hero. Deliberately static: it is the first paint for every
 * visitor, and the API this app talks to can be cold for ~30s, so nothing
 * above the fold is allowed to depend on a fetch. Live data lives further
 * down the page, where a skeleton is not the first thing anyone sees.
 */
export function Hero() {
  return (
    <section className="relative isolate overflow-hidden border-b border-zinc-200 dark:border-zinc-800">
      {/* decorative only — a soft indigo wash under a masked grid */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-indigo-50 via-white to-white dark:from-indigo-950/40 dark:via-zinc-950 dark:to-zinc-950"
      />
      <div
        aria-hidden="true"
        className="hero-grid pointer-events-none absolute inset-0 -z-10"
      />

      <div className="mx-auto flex max-w-3xl flex-col items-center gap-6 px-4 py-20 text-center sm:py-28">
        <p className="inline-flex items-center gap-2 rounded-full border border-indigo-200 bg-white/70 px-3 py-1 text-xs font-medium text-indigo-700 backdrop-blur dark:border-indigo-900 dark:bg-indigo-950/40 dark:text-indigo-300">
          <span
            aria-hidden="true"
            className="size-1.5 rounded-full bg-indigo-500"
          />
          Communities, updates, and real-world meetups
        </p>

        <h1 className="text-4xl font-bold tracking-tight text-balance sm:text-5xl lg:text-6xl">
          Find your people.{' '}
          <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-transparent dark:from-indigo-400 dark:to-violet-400">
            Make things happen.
          </span>
        </h1>

        <p className="max-w-xl text-lg text-pretty text-zinc-600 dark:text-zinc-400">
          CommunityHub is where interest-based communities share updates and
          organize real-world meetups — hikes, book clubs, cleanups, and
          whatever yours does best.
        </p>

        <HomeCta />

        <ul className="mt-2 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
          {[
            'Free to join',
            'Public and private communities',
            'Role-based moderation',
          ].map((item) => (
            <li key={item} className="flex items-center gap-1.5">
              <CheckIcon />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-3.5 text-indigo-500 dark:text-indigo-400"
    >
      <path d="m4 10.5 4 4 8-9" />
    </svg>
  );
}
