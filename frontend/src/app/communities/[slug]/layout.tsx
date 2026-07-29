'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import { ReactNode, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { useSession } from '@/lib/session';
import { Community } from '@/lib/types';
import { CommunityLoader, communityQueryKey } from './community-context';

export default function CommunityLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ slug: string }>();

  return (
    <CommunityLoader slug={params.slug}>
      {(community) => (
        <div className="mx-auto max-w-3xl px-4 py-8">
          <CommunityHeader community={community} />
          <Tabs slug={community.slug} />
          {children}
        </div>
      )}
    </CommunityLoader>
  );
}

function CommunityHeader({ community }: { community: Community }) {
  const { user, refresh } = useSession();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [confirmingLeave, setConfirmingLeave] = useState(false);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: communityQueryKey(community.slug) }),
      refresh(),
    ]);
  };

  const join = useMutation({
    mutationFn: () => api<void>(`/communities/${community.id}/join`, { method: 'POST' }),
    onSuccess: async () => {
      toast.success(`Welcome to ${community.name}!`);
      await invalidate();
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : 'Could not join.');
    },
  });

  const leave = useMutation({
    mutationFn: () => api<void>(`/communities/${community.id}/leave`, { method: 'POST' }),
    onSuccess: async () => {
      setConfirmingLeave(false);
      toast.success(`You left ${community.name}.`);
      await invalidate();
    },
    onError: (error) => {
      setConfirmingLeave(false);
      // e.g. "A community must keep at least one owner."
      toast.error(error instanceof ApiError ? error.message : 'Could not leave.');
    },
  });

  return (
    <header className="mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            {community.name}
            {community.visibility === 'PRIVATE' && (
              <span className="rounded bg-zinc-200 px-1.5 py-0.5 text-xs font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300">
                Private
              </span>
            )}
          </h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            {community.memberCount}{' '}
            {community.memberCount === 1 ? 'member' : 'members'}
            {community.callerRole && (
              <>
                {' · you are '}
                <span className="font-medium text-indigo-600 dark:text-indigo-400">
                  {community.callerRole.toLowerCase()}
                </span>
              </>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {user && community.callerRole === null ? (
            community.visibility === 'PUBLIC' ? (
              <button
                type="button"
                onClick={() => join.mutate()}
                disabled={join.isPending}
                className={primaryButtonClass}
              >
                {join.isPending ? 'Joining…' : 'Join community'}
              </button>
            ) : null // admins viewing private communities they aren't in
          ) : user && community.callerRole !== null ? (
            confirmingLeave ? (
              <span className="flex items-center gap-2" aria-live="polite">
                <span className="text-sm text-zinc-600 dark:text-zinc-400">
                  Leave {community.name}?
                </span>
                <button
                  type="button"
                  onClick={() => leave.mutate()}
                  disabled={leave.isPending}
                  className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 disabled:opacity-50"
                >
                  {leave.isPending ? 'Leaving…' : 'Confirm'}
                </button>
                <button
                  type="button"
                  onClick={() => setConfirmingLeave(false)}
                  className={secondaryButtonClass}
                >
                  Cancel
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={() => setConfirmingLeave(true)}
                className={secondaryButtonClass}
              >
                Leave
              </button>
            )
          ) : !user ? (
            <Link
              href={`/login?next=/communities/${community.slug}`}
              className={primaryButtonClass}
            >
              Sign in to join
            </Link>
          ) : null}
        </div>
      </div>

      {community.description && (
        <p className="mt-3 max-w-prose text-sm text-zinc-600 dark:text-zinc-400">
          {community.description}
        </p>
      )}
    </header>
  );
}

function Tabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/communities/${slug}`;

  const tabs = [
    { href: base, label: 'Feed' },
    { href: `${base}/events`, label: 'Events' },
    { href: `${base}/members`, label: 'Members' },
  ];

  return (
    <nav
      aria-label="Community sections"
      className="mb-6 flex gap-1 border-b border-zinc-200 dark:border-zinc-800"
    >
      {tabs.map((tab) => {
        const active =
          tab.href === base ? pathname === base : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? 'page' : undefined}
            className={`-mb-px border-b-2 px-3 py-2 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
              active
                ? 'border-indigo-600 text-indigo-600 dark:border-indigo-400 dark:text-indigo-400'
                : 'border-transparent text-zinc-600 hover:border-zinc-300 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
