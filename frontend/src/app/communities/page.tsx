'use client';

import { keepPreviousData, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { secondaryButtonClass, inputClass } from '@/components/ui/form';
import { useDebouncedCallback } from '@/hooks/use-debounced-callback';
import { api } from '@/lib/api';
import { Community, Paginated } from '@/lib/types';

const PAGE_SIZE = 12;

/**
 * Search and page live in the URL (?q=&page=), so results are shareable,
 * survive refresh, and the back button walks through previous queries.
 * Typing debounces 300ms, then pushes one history entry per settled query.
 */
function CommunitiesIndex() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const urlQuery = searchParams.get('q') ?? '';
  const urlPage = Math.max(1, Number(searchParams.get('page') ?? '1') || 1);

  // input state is local so typing is instant; the URL is the source of truth
  const [input, setInput] = useState(urlQuery);

  // back/forward navigation must update the box too
  useEffect(() => {
    setInput(urlQuery);
  }, [urlQuery]);

  const syncToUrl = useDebouncedCallback((value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('q', value);
    else params.delete('q');
    params.delete('page'); // a new query restarts at page 1
    router.push(`${pathname}${params.size ? `?${params}` : ''}`);
  }, 300);

  const setPage = (page: number) => {
    const params = new URLSearchParams(searchParams.toString());
    if (page > 1) params.set('page', String(page));
    else params.delete('page');
    router.push(`${pathname}${params.size ? `?${params}` : ''}`);
  };

  const { data, isPending, isError, refetch, isPlaceholderData } = useQuery({
    queryKey: ['communities', urlQuery, urlPage],
    queryFn: () =>
      api<Paginated<Community>>(
        `/communities?limit=${PAGE_SIZE}&page=${urlPage}${
          urlQuery ? `&search=${encodeURIComponent(urlQuery)}` : ''
        }`,
      ),
    placeholderData: keepPreviousData,
  });

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Communities</h1>
        <div className="w-full sm:w-72">
          <label htmlFor="community-search" className="sr-only">
            Search communities
          </label>
          <input
            id="community-search"
            type="search"
            placeholder="Search communities…"
            className={inputClass}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              syncToUrl(e.target.value.trim());
            }}
          />
        </div>
      </div>

      {isPending ? (
        <div
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
          aria-hidden="true"
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="h-36 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
            />
          ))}
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 py-16 text-center dark:border-zinc-800">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Couldn&apos;t load communities. Check your connection and try again.
          </p>
          <button type="button" onClick={() => void refetch()} className={secondaryButtonClass}>
            Retry
          </button>
        </div>
      ) : data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 py-16 text-center dark:border-zinc-700">
          <p className="text-2xl" aria-hidden="true">
            🔍
          </p>
          <p className="text-sm font-medium">
            {urlQuery ? `No communities match “${urlQuery}”` : 'No communities yet'}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {urlQuery ? 'Try a different search.' : 'Be the first to start one!'}
          </p>
        </div>
      ) : (
        <>
          <ul
            className={`grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 ${
              isPlaceholderData ? 'opacity-60 transition-opacity' : ''
            }`}
          >
            {data.items.map((community) => (
              <li key={community.id}>
                <Link
                  href={`/communities/${community.slug}`}
                  className="flex h-full flex-col gap-2 rounded-xl border border-zinc-200 p-4 transition-colors hover:border-indigo-400 hover:bg-indigo-50/40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-800 dark:hover:border-indigo-600 dark:hover:bg-indigo-950/30"
                >
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-semibold">{community.name}</h2>
                    {community.visibility === 'PRIVATE' && (
                      <span className="shrink-0 rounded bg-zinc-200 px-1.5 py-0.5 text-xs text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                        Private
                      </span>
                    )}
                  </div>
                  <p className="line-clamp-2 flex-1 text-sm text-zinc-600 dark:text-zinc-400">
                    {community.description ?? 'No description yet.'}
                  </p>
                  <div className="flex items-center gap-2 text-xs text-zinc-500 dark:text-zinc-400">
                    <span>
                      {community.memberCount}{' '}
                      {community.memberCount === 1 ? 'member' : 'members'}
                    </span>
                    {community.callerRole && (
                      <span className="rounded bg-indigo-100 px-1.5 py-0.5 font-medium text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                        {community.callerRole.toLowerCase()}
                      </span>
                    )}
                  </div>
                </Link>
              </li>
            ))}
          </ul>

          {data.meta.totalPages > 1 && (
            <nav
              aria-label="Pagination"
              className="mt-6 flex items-center justify-center gap-4"
            >
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={urlPage <= 1}
                onClick={() => setPage(urlPage - 1)}
              >
                Previous
              </button>
              <span className="text-sm text-zinc-600 dark:text-zinc-400">
                Page {data.meta.page} of {data.meta.totalPages}
              </span>
              <button
                type="button"
                className={secondaryButtonClass}
                disabled={urlPage >= data.meta.totalPages}
                onClick={() => setPage(urlPage + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      )}
    </div>
  );
}

export default function CommunitiesPage() {
  return (
    <Suspense>
      <CommunitiesIndex />
    </Suspense>
  );
}
