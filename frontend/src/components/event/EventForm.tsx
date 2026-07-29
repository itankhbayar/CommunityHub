'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import {
  Field,
  FormError,
  inputClass,
  primaryButtonClass,
  secondaryButtonClass,
} from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { toDatetimeLocal } from '@/lib/format';
import { CommunityEvent } from '@/lib/types';
import { eventQueryKey, eventsQueryKey } from './event-cache';

interface EventFormProps {
  communityId: string;
  existing?: CommunityEvent;
  onDone: () => void;
  onCancel: () => void;
}

export function EventForm({ communityId, existing, onDone, onCancel }: EventFormProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [title, setTitle] = useState(existing?.title ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [location, setLocation] = useState(existing?.location ?? '');
  const [startsAt, setStartsAt] = useState(
    existing ? toDatetimeLocal(existing.startsAt) : '',
  );
  const [endsAt, setEndsAt] = useState(
    existing?.endsAt ? toDatetimeLocal(existing.endsAt) : '',
  );
  const [capacity, setCapacity] = useState(
    existing?.capacity != null ? String(existing.capacity) : '',
  );
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const errors = {
    title:
      title.trim().length < 3 || title.trim().length > 120
        ? 'Title must be between 3 and 120 characters.'
        : null,
    startsAt: !startsAt ? 'Pick a start date and time.' : null,
    endsAt:
      endsAt && startsAt && new Date(endsAt) <= new Date(startsAt)
        ? 'End must be after start.'
        : null,
    capacity:
      capacity !== '' && (!/^\d+$/.test(capacity) || Number(capacity) < 1)
        ? 'Capacity must be a whole number of at least 1.'
        : null,
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const mutation = useMutation({
    mutationFn: (): Promise<CommunityEvent> => {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        startsAt: new Date(startsAt).toISOString(),
        ...(description.trim() ? { description: description.trim() } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(endsAt ? { endsAt: new Date(endsAt).toISOString() } : {}),
        ...(capacity !== '' ? { capacity: Number(capacity) } : {}),
      };
      return existing
        ? api<CommunityEvent>(`/events/${existing.id}`, { method: 'PATCH', body: payload })
        : api<CommunityEvent>(`/communities/${communityId}/events`, {
            method: 'POST',
            body: payload,
          });
    },
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: eventsQueryKey(communityId) });
      if (existing) {
        queryClient.setQueryData(eventQueryKey(existing.id), {
          ...saved,
          // PATCH responses do not know the caller's RSVP; keep what we had
          myStatus: existing.myStatus,
        });
      }
      toast.success(existing ? 'Event updated.' : 'Event created.');
      onDone();
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError
          ? [error.message, ...error.details].join(' ')
          : "Couldn't save the event.",
      );
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (hasErrors || mutation.isPending) return;
    setFormError(null);
    mutation.mutate();
  }

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <FormError>{formError}</FormError>
      <Field
        label="Title"
        name="event-title"
        required
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        error={touched ? errors.title : null}
      />
      <div className="flex flex-col gap-1.5">
        <label htmlFor="event-description" className="text-sm font-medium">
          Description <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          id="event-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          className={`${inputClass} resize-y`}
        />
      </div>
      <Field
        label="Location (optional)"
        name="event-location"
        value={location}
        onChange={(e) => setLocation(e.target.value)}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label="Starts"
          name="event-starts"
          type="datetime-local"
          required
          value={startsAt}
          onChange={(e) => setStartsAt(e.target.value)}
          error={touched ? errors.startsAt : null}
        />
        <Field
          label="Ends (optional)"
          name="event-ends"
          type="datetime-local"
          value={endsAt}
          onChange={(e) => setEndsAt(e.target.value)}
          error={touched ? errors.endsAt : null}
        />
      </div>
      <Field
        label="Capacity (optional)"
        name="event-capacity"
        inputMode="numeric"
        placeholder="Leave empty for unlimited"
        value={capacity}
        onChange={(e) => setCapacity(e.target.value)}
        error={touched ? errors.capacity : null}
        hint="How many people can attend. Leave empty for no limit."
      />
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending || (touched && hasErrors)}
          className={primaryButtonClass}
        >
          {mutation.isPending ? 'Saving…' : existing ? 'Save changes' : 'Create event'}
        </button>
      </div>
    </form>
  );
}
