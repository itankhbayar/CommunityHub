'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { FormEvent, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  Field,
  FormError,
  dangerButtonClass,
  inputClass,
  primaryButtonClass,
} from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { canManageCommunity } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { Community, Visibility } from '@/lib/types';
import { communityQueryKey, useCommunity } from '../community-context';

export default function SettingsPage() {
  const community = useCommunity();
  const { user } = useSession();

  // UI gate only. The same two endpoints are guarded by
  // @RequirePermission('community:update' | 'community:delete'), so a hand-made
  // request from a moderator gets a 403 regardless of what this renders.
  if (!canManageCommunity(user, community)) {
    return (
      <div className="rounded-xl border border-zinc-200 px-4 py-10 text-center dark:border-zinc-800">
        <p className="text-sm font-medium">Only owners can change settings</p>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          Ask an owner of {community.name} if something here needs to change.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <SettingsForm community={community} />
      <DangerZone community={community} />
    </div>
  );
}

function SettingsForm({ community }: { community: Community }) {
  const queryClient = useQueryClient();
  const { refresh } = useSession();
  const toast = useToast();

  const [name, setName] = useState(community.name);
  const [description, setDescription] = useState(community.description ?? '');
  const [visibility, setVisibility] = useState<Visibility>(community.visibility);
  const [touched, setTouched] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  // mirrors CreateCommunityDto — the server re-validates all of it
  const nameError =
    name.trim().length < 3 || name.trim().length > 80
      ? 'Name must be between 3 and 80 characters.'
      : null;
  const descriptionError =
    description.length > 500 ? 'Description can be at most 500 characters.' : null;
  const hasErrors = Boolean(nameError || descriptionError);

  const trimmedName = name.trim();
  const trimmedDescription = description.trim();
  const currentDescription = community.description ?? '';

  const changed =
    trimmedName !== community.name ||
    trimmedDescription !== currentDescription ||
    visibility !== community.visibility;

  const mutation = useMutation({
    mutationFn: () =>
      api<Community>(`/communities/${community.id}`, {
        method: 'PATCH',
        // PATCH semantics: send only what actually moved, so a no-op field is
        // never overwritten by a concurrent edit from another owner
        body: {
          ...(trimmedName !== community.name ? { name: trimmedName } : {}),
          ...(trimmedDescription !== currentDescription
            ? // null rather than '' so a cleared description reads back as
              // absent, matching a community that never had one
              { description: trimmedDescription || null }
            : {}),
          ...(visibility !== community.visibility ? { visibility } : {}),
        },
      }),
    onSuccess: async (updated) => {
      // the session embeds each membership's community name and visibility,
      // so the nav would otherwise keep showing the old ones
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: communityQueryKey(community.slug),
        }),
        queryClient.invalidateQueries({ queryKey: ['communities'] }),
        refresh(),
      ]);
      toast.success(`${updated.name} updated.`);
      setTouched(false);
    },
    onError: (error) => {
      setFormError(
        error instanceof ApiError
          ? [error.message, ...error.details].join(' ')
          : "Couldn't save these changes. Please try again.",
      );
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (hasErrors || !changed || mutation.isPending) return;
    setFormError(null);
    mutation.mutate();
  }

  function reset() {
    setName(community.name);
    setDescription(community.description ?? '');
    setVisibility(community.visibility);
    setTouched(false);
    setFormError(null);
  }

  return (
    <section>
      <h2 className="text-lg font-semibold">Community settings</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        The URL (<code className="font-mono">/{community.slug}</code>) is fixed
        when a community is created and cannot change — existing links keep
        working.
      </p>

      <form onSubmit={onSubmit} noValidate className="mt-4 flex flex-col gap-4">
        <FormError>{formError}</FormError>

        <Field
          label="Name"
          name="community-name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          error={touched ? nameError : null}
        />

        <div className="flex flex-col gap-1.5">
          <label htmlFor="community-description" className="text-sm font-medium">
            Description{' '}
            <span className="font-normal text-zinc-400">(optional)</span>
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

        {community.visibility === 'PRIVATE' && visibility === 'PUBLIC' && (
          <p
            role="status"
            className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200"
          >
            Going public exposes every existing post in this community to
            anyone, including people who were never members.
          </p>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={reset}
            disabled={!changed || mutation.isPending}
            className="inline-flex items-center justify-center rounded-md border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Discard
          </button>
          <button
            type="submit"
            // no-op saves are pointless, and a failed validation should not be
            // resubmittable until it is actually fixed
            disabled={!changed || mutation.isPending || (touched && hasErrors)}
            className={primaryButtonClass}
          >
            {mutation.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </section>
  );
}

function DangerZone({ community }: { community: Community }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { refresh } = useSession();
  const toast = useToast();
  const [confirming, setConfirming] = useState(false);

  async function remove() {
    try {
      await api<void>(`/communities/${community.id}`, { method: 'DELETE' });
    } catch (error) {
      // rethrown so ConfirmDialog surfaces it inline and stays open
      throw error instanceof ApiError
        ? error
        : new Error("Couldn't delete this community.");
    }

    // leave before the cache notices: the layout's community query would
    // refetch a now-deleted slug and flash "Community not found" underneath
    queryClient.removeQueries({ queryKey: communityQueryKey(community.slug) });
    router.replace('/communities');

    toast.success(`${community.name} was deleted.`);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['communities'] }),
      refresh(),
    ]);
  }

  return (
    <section>
      <h2 className="text-lg font-semibold text-red-700 dark:text-red-400">
        Danger zone
      </h2>

      <div className="mt-3 flex flex-col gap-3 rounded-xl border border-red-300 p-4 sm:flex-row sm:items-center sm:justify-between dark:border-red-900">
        <div>
          <p className="text-sm font-medium">Delete this community</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Its posts, events, RSVPs, and{' '}
            {community.memberCount === 1
              ? '1 membership'
              : `all ${community.memberCount} memberships`}{' '}
            are deleted with it. This cannot be undone.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className={`${dangerButtonClass} shrink-0`}
        >
          Delete community
        </button>
      </div>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Delete ${community.name}?`}
        confirmLabel="Delete community"
        confirmPhrase={community.slug}
        onConfirm={remove}
      >
        <p>
          Every post, event, RSVP, and membership in this community is deleted
          permanently. Members are not notified, and nothing here can be
          restored afterwards.
        </p>
      </ConfirmDialog>
    </section>
  );
}
