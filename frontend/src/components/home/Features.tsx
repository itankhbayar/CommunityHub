import type { ReactNode } from 'react';

/**
 * What the product actually does, in three cards. Copy is held to features
 * that exist today — a landing page that promises more than the app ships is
 * a bug report waiting to happen.
 */
export function Features() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16">
      <div className="mb-10 max-w-2xl">
        <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
          Everything a group needs to stay together
        </h2>
        <p className="mt-2 text-zinc-600 dark:text-zinc-400">
          Three moving parts, and nothing you have to configure before your
          first post goes up.
        </p>
      </div>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <FeatureCard
          icon={<CompassIcon />}
          title="Communities"
          body="Start one in a minute, public or invite-only. Roles are scoped per community, so you can run yours and simply belong to the next."
        />
        <FeatureCard
          icon={<MegaphoneIcon />}
          title="A feed that keeps up"
          body="Post updates, like the good ones, and scroll back through everything the group has shared without hitting a pagination wall."
        />
        <FeatureCard
          icon={<CalendarIcon />}
          title="Meetups with RSVP"
          body="Put a date and a place on it, set a capacity, and let people commit. Seats are counted honestly, even when everyone clicks at once."
        />
      </ul>
    </section>
  );
}

function FeatureCard({
  icon,
  title,
  body,
}: {
  icon: ReactNode;
  title: string;
  body: string;
}) {
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-zinc-200 bg-white p-5 transition-colors hover:border-indigo-300 dark:border-zinc-800 dark:bg-zinc-900/40 dark:hover:border-indigo-800">
      <span className="flex size-10 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600 dark:bg-indigo-950/60 dark:text-indigo-400">
        {icon}
      </span>
      <h3 className="font-semibold">{title}</h3>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">{body}</p>
    </li>
  );
}

/* Inline so the landing page pulls in no icon dependency for three glyphs. */

const iconProps = {
  'aria-hidden': true,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.75,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  className: 'size-5',
} as const;

function CompassIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="m15.5 8.5-2 5-5 2 2-5z" />
    </svg>
  );
}

function MegaphoneIcon() {
  return (
    <svg {...iconProps}>
      <path d="M3 11v2a1 1 0 0 0 1 1h3l6 4V6L7 10H4a1 1 0 0 0-1 1Z" />
      <path d="M17 9a3.5 3.5 0 0 1 0 6" />
      <path d="M7 14v4a1 1 0 0 0 1 1h1a1 1 0 0 0 1-1v-2" />
    </svg>
  );
}

function CalendarIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
      <path d="m9.5 15 1.75 1.75L15 13.5" />
    </svg>
  );
}
