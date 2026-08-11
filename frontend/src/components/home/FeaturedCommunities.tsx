'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { api } from '@/lib/api';
import { secondaryButtonClass } from '@/components/ui/form';
import { Community, Paginated } from '@/lib/types';

const PREVIEW_COUNT = 3;

/**
 * A real slice of the platform on the landing page, rather than invented
 * screenshots. `GET /communities` is public and scopes visibility server-side,
 * so a signed-in visitor sees the private communities they belong to and
 * everyone else sees only public ones — no leak, no separate endpoint.
 *
 * This sits below the hero on purpose: it is the one part of the page that can
 * be slow, and nothing above it waits on the network.
 */
export function FeaturedCommunities() {
  const { data, isPending, isError, refetch, isFetching } = useQuery({
    queryKey: ['communities', 'featured'],
    queryFn: () =>
      api<Paginated<Community>>(`/communities?limit=${PREVIEW_COUNT}&page=1`),
    // one retry, not the app-wide two: this section is supporting material, and
    // reaching a fallback quickly beats holding skeletons through a long backoff
    retry: 1,
  });

  return (
    <section className="border-y border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/30">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Communities to explore
            </h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
              {data && data.meta.total > PREVIEW_COUNT
                ? `${data.meta.total} communities are open right now.`
                : 'Have a look around before you sign up.'}
            </p>
          </div>
          <Link
            href="/communities"
            className="rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
          >
            See all <span aria-hidden="true">→</span>
          </Link>
        </div>

        {isPending ? (
          <div
            className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            aria-hidden="true"
          >
            {Array.from({ length: PREVIEW_COUNT }).map((_, i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
              />
            ))}
          </div>
        ) : isError ? (
          // Understated on purpose. A visitor who has never used this app does
          // not need an alarming red box because a preview strip failed — the
          // rest of the page still works, and /communities is one click away.
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Couldn&apos;t load communities just now.
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              disabled={isFetching}
              className={secondaryButtonClass}
            >
              {isFetching ? 'Retrying…' : 'Try again'}
            </button>
          </div>
        ) : data.items.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
            <p className="text-2xl" aria-hidden="true">
              🌱
            </p>
            <p className="text-sm font-medium">No communities yet</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Yours could be the first one here.
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data.items.map((community) => (
              <li key={community.id}>
                <Link
                  href={`/communities/${community.slug}`}
                  className="flex h-full flex-col gap-2 rounded-xl border border-zinc-200 bg-white p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-800 dark:bg-zinc-900/60 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h3 className="font-semibold">{community.name}</h3>
                    {community.visibility === 'PRIVATE' && (
                      <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        Private
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 flex-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {community.description ?? 'No description yet.'}
                  </p>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {community.memberCount}{' '}
                    {community.memberCount === 1 ? 'member' : 'members'}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
