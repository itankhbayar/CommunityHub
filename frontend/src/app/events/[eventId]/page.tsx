'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useState } from 'react';
import { EventForm } from '@/components/event/EventForm';
import { RsvpButton } from '@/components/event/RsvpButton';
import { eventQueryKey, eventsQueryKey } from '@/components/event/event-cache';
import { useToast } from '@/components/toast/ToastProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { secondaryButtonClass } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { formatEventDate } from '@/lib/format';
import { canModerate, isMember } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { Attendee, Community, CommunityEvent, Paginated } from '@/lib/types';

export default function EventDetailPage() {
  const params = useParams<{ eventId: string }>();
  const { data, isPending, isError, error, refetch } = useQuery({
    queryKey: eventQueryKey(params.eventId),
    queryFn: () => api<CommunityEvent>(`/events/${params.eventId}`),
  });

  if (isPending) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8" aria-busy="true">
        <div className="h-4 w-40 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-4 h-8 w-72 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
        <div className="mt-6 h-32 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900" />
      </div>
    );
  }

  if (isError) {
    const notFound = error instanceof ApiError && error.status === 404;
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 px-4 py-24 text-center">
        <p className="text-3xl" aria-hidden="true">
          {notFound ? '🔒' : '😵'}
        </p>
        <h1 className="text-lg font-semibold">
          {notFound ? 'Event not found' : "Couldn't load this event"}
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {notFound
            ? "It may not exist — or it belongs to a private community you're not a member of."
            : 'Check your connection and try again.'}
        </p>
        {!notFound && (
          <button type="button" onClick={() => void refetch()} className={secondaryButtonClass}>
            Retry
          </button>
        )}
      </div>
    );
  }

  return <EventDetail event={data} />;
}

function EventDetail({ event }: { event: CommunityEvent }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { user } = useSession();

  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // role context comes from the community, cached under the same key the
  // community section uses
  const { data: community } = useQuery({
    queryKey: ['community', event.community.slug],
    queryFn: () => api<Community>(`/communities/${event.community.slug}`),
  });

  const member = community ? isMember(user, community) : false;
  const moderates = community ? canModerate(user, community) : false;

  const { data: attendees } = useQuery({
    queryKey: ['attendees', event.id],
    queryFn: () => api<Paginated<Attendee>>(`/events/${event.id}/rsvps?limit=50`),
  });

  async function deleteEvent() {
    try {
      await api<void>(`/events/${event.id}`, { method: 'DELETE' });
    } catch (err) {
      throw err instanceof ApiError ? err : new Error("Couldn't delete the event.");
    }
    await queryClient.invalidateQueries({ queryKey: eventsQueryKey(event.community.id) });
    queryClient.removeQueries({ queryKey: eventQueryKey(event.id) });
    toast.success('Event deleted.');
    router.push(`/communities/${event.community.slug}/events`);
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <Link
        href={`/communities/${event.community.slug}/events`}
        className="rounded text-sm text-indigo-600 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:text-indigo-400"
      >
        ← {event.community.name}
      </Link>

      <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{event.title}</h1>
        {moderates && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className={secondaryButtonClass}
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className="rounded-md border border-red-300 px-4 py-2 text-sm font-medium text-red-700 hover:bg-red-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950"
            >
              Delete
            </button>
          </div>
        )}
      </div>

      <dl className="mt-4 flex flex-col gap-2 text-sm">
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-zinc-400 dark:text-zinc-500">When</dt>
          <dd>
            {formatEventDate(event.startsAt)}
            {event.endsAt && ` — ${formatEventDate(event.endsAt)}`}
          </dd>
        </div>
        {event.location && (
          <div className="flex gap-2">
            <dt className="w-16 shrink-0 text-zinc-400 dark:text-zinc-500">Where</dt>
            <dd>{event.location}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-zinc-400 dark:text-zinc-500">Spots</dt>
          <dd>
            {event.capacity === null ? (
              `${event.goingCount} going · unlimited`
            ) : (
              <>
                {event.goingCount}/{event.capacity} going
                {event.goingCount >= event.capacity && (
                  <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                    Full
                  </span>
                )}
              </>
            )}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="w-16 shrink-0 text-zinc-400 dark:text-zinc-500">Host</dt>
          <dd>{event.createdBy.displayName}</dd>
        </div>
      </dl>

      {event.description && (
        <p className="mt-4 max-w-prose text-sm leading-relaxed whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
          {event.description}
        </p>
      )}

      <div className="mt-6">
        <RsvpButton event={event} canRsvp={member} />
      </div>

      <section className="mt-8" aria-labelledby="attendees-heading">
        <h2 id="attendees-heading" className="text-sm font-semibold">
          Who&apos;s going
          {attendees && ` (${attendees.meta.total})`}
        </h2>
        {!attendees ? (
          <div className="mt-2 h-6 w-48 animate-pulse rounded bg-zinc-100 dark:bg-zinc-900" />
        ) : attendees.items.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
            Nobody yet — be the first!
          </p>
        ) : (
          <ul className="mt-2 flex flex-wrap gap-2">
            {attendees.items.map((attendee) => (
              <li
                key={attendee.userId}
                className="rounded-full bg-zinc-100 px-3 py-1 text-sm dark:bg-zinc-900"
              >
                {attendee.displayName}
              </li>
            ))}
          </ul>
        )}
      </section>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit event">
        <EventForm
          communityId={event.community.id}
          existing={event}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </Modal>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete event?"
        confirmLabel="Delete event"
        onConfirm={deleteEvent}
      >
        This cancels “{event.title}” and removes every RSVP. Attendees will not
        be notified automatically. There is no undo.
      </ConfirmDialog>
    </div>
  );
}
