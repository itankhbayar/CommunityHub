'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/toast/ToastProvider';
import { api, ApiError } from '@/lib/api';
import { CommunityEvent, RsvpResult, RsvpStatus } from '@/lib/types';
import { patchEvent, restoreEvent } from './event-cache';

interface RsvpButtonProps {
  event: CommunityEvent;
  /** members only; others see state but cannot act */
  canRsvp: boolean;
}

/**
 * Optimistic RSVP with visible rollback. Clicking "I'm going" flips the
 * button and bumps the count immediately; if the server answers 409 (event
 * filled meanwhile — the capacity check is race-safe server-side), the cache
 * snapshot is restored so the button visibly snaps back, with a toast
 * explaining why. Success reconciles with the server's authoritative count.
 */
export function RsvpButton({ event, canRsvp }: RsvpButtonProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: (status: RsvpStatus) =>
      api<RsvpResult>(`/events/${event.id}/rsvp`, {
        method: 'PUT',
        body: { status },
      }),
    onMutate: async (status) => {
      await queryClient.cancelQueries({ queryKey: ['events', event.community.id] });
      await queryClient.cancelQueries({ queryKey: ['event', event.id] });

      const snapshot = patchEvent(queryClient, event.community.id, event.id, (e) => ({
        ...e,
        myStatus: status,
        goingCount:
          e.goingCount +
          (status === 'GOING' && e.myStatus !== 'GOING'
            ? 1
            : status === 'NOT_GOING' && e.myStatus === 'GOING'
              ? -1
              : 0),
      }));
      return { snapshot };
    },
    onSuccess: (result, status) => {
      // server truth for the count (someone else may have moved it too)
      patchEvent(queryClient, event.community.id, event.id, (e) => ({
        ...e,
        myStatus: status,
        goingCount: result.goingCount,
      }));
      toast.success(
        status === 'GOING' ? "You're going! 🎉" : 'RSVP cancelled.',
      );
    },
    onError: (error, _status, context) => {
      if (context) {
        restoreEvent(queryClient, event.community.id, event.id, context.snapshot);
      }
      if (error instanceof ApiError && error.status === 409) {
        toast.error('This event is full.');
      } else {
        toast.error(
          error instanceof ApiError ? error.message : "Couldn't update your RSVP.",
        );
      }
    },
  });

  const going = event.myStatus === 'GOING';
  const full =
    event.capacity !== null && event.goingCount >= event.capacity && !going;

  if (!canRsvp) {
    return (
      <span className="text-xs text-zinc-400 dark:text-zinc-500">
        Join the community to RSVP
      </span>
    );
  }

  return going ? (
    <button
      type="button"
      onClick={() => mutation.mutate('NOT_GOING')}
      disabled={mutation.isPending}
      className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:border-red-300 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200 dark:hover:border-red-800 dark:hover:bg-red-950 dark:hover:text-red-300"
      title="Cancel your RSVP"
    >
      <span aria-hidden="true">✓</span> Going — cancel?
    </button>
  ) : (
    <button
      type="button"
      onClick={() => mutation.mutate('GOING')}
      disabled={mutation.isPending}
      className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:opacity-50"
    >
      {/* stays clickable when full: the server is the referee (a seat may
          have freed since this render), and a refusal rolls back visibly */}
      {full ? "I'm going (looks full)" : "I'm going"}
    </button>
  );
}
