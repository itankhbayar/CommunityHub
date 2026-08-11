const steps = [
  {
    title: 'Join a community',
    body: 'Browse what is public, or take an invite into a private one. You can belong to as many as you like.',
  },
  {
    title: 'Share what is happening',
    body: 'Post updates to the feed, react to the ones worth reacting to, and keep the thread of the group in one place.',
  },
  {
    title: 'Show up in person',
    body: 'Organizers post a meetup, you RSVP, and the seat is yours until you give it back.',
  },
];

/** The three-step path from visitor to someone standing at the trailhead. */
export function HowItWorks() {
  return (
    <section className="mx-auto max-w-5xl px-4 py-16">
      <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
        How it works
      </h2>

      <ol className="mt-8 grid grid-cols-1 gap-8 sm:grid-cols-3">
        {steps.map((step, index) => (
          <li key={step.title} className="flex flex-col gap-2">
            <span className="flex size-8 items-center justify-center rounded-full border border-indigo-200 text-sm font-semibold text-indigo-600 dark:border-indigo-900 dark:text-indigo-400">
              {index + 1}
            </span>
            <h3 className="font-semibold">{step.title}</h3>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              {step.body}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
