'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { EventForm } from '@/components/event/EventForm';
import { RsvpButton } from '@/components/event/RsvpButton';
import { eventsQueryKey } from '@/components/event/event-cache';
import { Modal } from '@/components/ui/Modal';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form';
import { api } from '@/lib/api';
import { formatEventDate } from '@/lib/format';
import { canModerate, isMember } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { CommunityEvent, Paginated } from '@/lib/types';
import { useCommunity } from '../community-context';

export default function EventsPage() {
  const community = useCommunity();
  const { user } = useSession();
  const moderates = canModerate(user, community);
  const member = isMember(user, community);

  const [creating, setCreating] = useState(false);

  const { data, isPending, isError, refetch } = useQuery({
    queryKey: eventsQueryKey(community.id),
    queryFn: () =>
      api<Paginated<CommunityEvent>>(`/communities/${community.id}/events?limit=50`),
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading events">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl border border-zinc-200 bg-zinc-100 dark:border-zinc-800 dark:bg-zinc-900"
          />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 py-12 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Couldn&apos;t load events.
        </p>
        <button type="button" onClick={() => void refetch()} className={secondaryButtonClass}>
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {moderates && (
        <div className="flex justify-end">
          <button type="button" onClick={() => setCreating(true)} className={primaryButtonClass}>
            New event
          </button>
        </div>
      )}

      <Modal open={creating} onClose={() => setCreating(false)} title="New event">
        <EventForm
          communityId={community.id}
          onDone={() => setCreating(false)}
          onCancel={() => setCreating(false)}
        />
      </Modal>

      {data.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
          <p className="text-2xl" aria-hidden="true">
            📅
          </p>
          <p className="text-sm font-medium">No events scheduled</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {moderates
              ? 'Create the first one!'
              : 'Check back soon — organizers are on it.'}
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-4">
          {data.items.map((event) => (
            <li key={event.id}>
              <article className="flex flex-col gap-3 rounded-xl border border-zinc-200 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-zinc-800">
                <div className="min-w-0">
                  <Link
                    href={`/events/${event.id}`}
                    className="rounded font-semibold hover:text-indigo-600 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:hover:text-indigo-400"
                  >
                    {event.title}
                  </Link>
                  <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                    {formatEventDate(event.startsAt)}
                    {event.location && ` · ${event.location}`}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-500">
                    <Capacity event={event} />
                  </p>
                </div>
                <div className="shrink-0">
                  <RsvpButton event={event} canRsvp={member} />
                </div>
              </article>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Capacity({ event }: { event: CommunityEvent }) {
  if (event.capacity === null) {
    return (
      <>
        {event.goingCount} going · unlimited spots
      </>
    );
  }
  const full = event.goingCount >= event.capacity;
  return (
    <>
      {event.goingCount}/{event.capacity} going
      {full && (
        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
          Full
        </span>
      )}
    </>
  );
}
