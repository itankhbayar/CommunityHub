'use client';

import { useQuery } from '@tanstack/react-query';
import { createContext, ReactNode, useContext } from 'react';
import { api, ApiError } from '@/lib/api';
import { Community } from '@/lib/types';

const CommunityContext = createContext<Community | null>(null);

/** The resolved community for everything under /communities/[slug]. */
export function useCommunity(): Community {
  const community = useContext(CommunityContext);
  if (!community) {
    throw new Error('useCommunity must be used under <CommunityLoader>');
  }
  return community;
}

export function communityQueryKey(slug: string) {
  return ['community', slug] as const;
}

/**
 * Fetches the community once for the whole section (header, tabs, and every
 * tab page share this cache entry) and owns the section's loading / error /
 * not-found states so tab pages can assume a resolved community.
 */
export function CommunityLoader({
  slug,
  children,
}: {
  slug: string;
  children: (community: Community) => ReactNode;
}) {
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: communityQueryKey(slug),
    queryFn: () => api<Community>(`/communities/${encodeURIComponent(slug)}`),
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8" aria-busy="true">
        <div className="h-8 w-64 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-3 h-4 w-96 max-w-full animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-8 h-10 w-full animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
      </div>
    );
  }

  if (isError) {
    // a 404 here means: no such community, or a private one the caller
    // cannot see — the backend intentionally does not distinguish
    if (error instanceof ApiError && error.status === 404) {
      return (
        <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
          <p className="text-3xl" aria-hidden="true">
            🔒
          </p>
          <h1 className="text-lg font-semibold">Community not found</h1>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            This community doesn&apos;t exist — or it&apos;s private and
            you&apos;re not a member.
          </p>
        </div>
      );
    }
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Couldn&apos;t load this community.
        </p>
        <button
          type="button"
          onClick={() => void refetch()}
          className="rounded-md border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <CommunityContext.Provider value={data}>
      {children(data)}
    </CommunityContext.Provider>
  );
}
