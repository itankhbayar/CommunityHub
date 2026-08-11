'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { secondaryButtonClass } from '@/components/ui/form';
import { Community, CommunitySort, Paginated } from '@/lib/types';

const PREVIEW_COUNT = 3;

const SORTS: { value: CommunitySort; label: string; blurb: string }[] = [
  { value: 'popular', label: 'Popular', blurb: 'the most members' },
  { value: 'active', label: 'Active', blurb: 'the most going on lately' },
  { value: 'new', label: 'New', blurb: 'just been created' },
];

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
  const [sort, setSort] = useState<CommunitySort>('popular');

  const { data, isPending, isError, refetch, isFetching, isPlaceholderData } =
    useQuery({
      queryKey: ['communities', 'featured', sort],
      queryFn: () =>
        api<Paginated<Community>>(
          `/communities?limit=${PREVIEW_COUNT}&page=1&sort=${sort}`,
        ),
      // switching tabs keeps the previous cards on screen instead of dropping
      // back to skeletons — the set is usually the same three, reordered
      placeholderData: keepPreviousData,
      // one retry, not the app-wide two: this section is supporting material, and
      // reaching a fallback quickly beats holding skeletons through a long backoff
      retry: 1,
    });

  const count = data?.items.length ?? 0;

  return (
    <section className="border-y border-zinc-200 bg-zinc-50/60 dark:border-zinc-800 dark:bg-zinc-900/30">
      <div className="mx-auto max-w-5xl px-4 py-16">
        <div className="mb-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
            <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
              Communities to explore
            </h2>
            <Link
              href="/communities"
              className="rounded text-sm font-medium text-indigo-600 hover:text-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
            >
              See all <span aria-hidden="true">→</span>
            </Link>
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            {/* Buttons with aria-pressed rather than a tablist: a real tablist
                owes the user arrow-key navigation, and a toggle group that
                reorders one grid is understood well enough without it. */}
            <div
              role="group"
              aria-label="Sort communities"
              className="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900"
            >
              {SORTS.map((option) => {
                const selected = option.value === sort;
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setSort(option.value)}
                    className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
                      selected
                        ? 'bg-indigo-600 text-white'
                        : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
                    }`}
                  >
                    {option.label}
                  </button>
                );
              })}
            </div>

            <p className="text-sm text-zinc-600 dark:text-zinc-400">
              Communities with {SORTS.find((s) => s.value === sort)!.blurb}.
            </p>
          </div>
        </div>

        <div aria-busy={isFetching}>
          {isPending ? (
            <div className={`grid gap-4 ${gridClass(PREVIEW_COUNT)}`} aria-hidden="true">
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
          ) : count === 0 ? (
            // Every sort returns the same set, so an empty result means there
            // is genuinely nothing to show — not that this tab is empty.
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
            <ul
              className={`grid gap-4 ${gridClass(count)} ${
                isPlaceholderData ? 'opacity-60 transition-opacity' : ''
              }`}
            >
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
      </div>
    </section>
  );
}

/**
 * Three cards fill the row; one or two would otherwise sit stranded against the
 * left edge with a third of the section empty beside them. Narrowing and
 * centring the grid instead makes a small instance look deliberate.
 * Static class strings so Tailwind can see them.
 */
function gridClass(count: number): string {
  if (count === 1) return 'mx-auto max-w-sm grid-cols-1';
  if (count === 2) return 'mx-auto max-w-3xl grid-cols-1 sm:grid-cols-2';
  return 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';
}
