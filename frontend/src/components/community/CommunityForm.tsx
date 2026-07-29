'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
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
import { useSession } from '@/lib/session';
import { Community, Visibility } from '@/lib/types';

interface CommunityFormProps {
  onDone: () => void;
  onCancel: () => void;
}

/** Create-community form (modal body). The creator becomes OWNER server-side. */
export function CommunityForm({ onDone, onCancel }: CommunityFormProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { refresh } = useSession();
  const toast = useToast();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const nameError =
    name.trim().length < 3 || name.trim().length > 80
      ? 'Name must be between 3 and 80 characters.'
      : null;
  const descriptionError =
    description.length > 500 ? 'Description can be at most 500 characters.' : null;
  const hasErrors = Boolean(nameError || descriptionError);

  const mutation = useMutation({
    mutationFn: () =>
      api<Community>('/communities', {
        method: 'POST',
        body: {
          name: name.trim(),
          ...(description.trim() ? { description: description.trim() } : {}),
          visibility,
        },
      }),
    onSuccess: async (community) => {
      // new membership (OWNER) affects the session and the list
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['communities'] }),
        refresh(),
      ]);
      toast.success(`${community.name} is live — you are its owner.`);
      onDone();
      router.push(`/communities/${community.slug}`);
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError
          ? [error.message, ...error.details].join(' ')
          : "Couldn't create the community. Please try again.",
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
        label="Name"
        name="community-name"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        error={touched ? nameError : null}
        hint="The URL is generated from this and cannot be changed later."
      />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="community-description" className="text-sm font-medium">
          Description <span className="font-normal text-zinc-400">(optional)</span>
        </label>
        <textarea
          id="community-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-invalid={touched && descriptionError ? true : undefined}
          className={`${inputClass} resize-y`}
          placeholder="What is this community about?"
        />
        {touched && descriptionError && (
          <p role="alert" className="text-xs text-red-600 dark:text-red-400">
            {descriptionError}
          </p>
        )}
      </div>

      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Visibility</legend>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="visibility"
            value="PUBLIC"
            checked={visibility === 'PUBLIC'}
            onChange={() => setVisibility('PUBLIC')}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Public</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              Anyone can find it, read posts, and join on their own.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-2 text-sm">
          <input
            type="radio"
            name="visibility"
            value="PRIVATE"
            checked={visibility === 'PRIVATE'}
            onChange={() => setVisibility('PRIVATE')}
            className="mt-0.5"
          />
          <span>
            <span className="font-medium">Private</span>
            <span className="block text-xs text-zinc-500 dark:text-zinc-400">
              Invisible to non-members; people join by invite only.
            </span>
          </span>
        </label>
      </fieldset>

      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending || (touched && hasErrors)}
          className={primaryButtonClass}
        >
          {mutation.isPending ? 'Creating…' : 'Create community'}
        </button>
      </div>
    </form>
  );
}
