'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { Post } from '@/lib/types';
import { feedQueryKey, patchPostInFeed } from './feed-cache';

const MAX_LENGTH = 5000;

interface PostFormProps {
  communityId: string;
  /** present = edit mode */
  existing?: Post;
  onDone: () => void;
  onCancel: () => void;
}

/**
 * Create/edit form used inside the modal. Inline validation, submit disabled
 * while invalid or pending — the pending flag doubles as double-submit
 * protection, so a second click (or Enter) cannot fire a second request.
 */
export function PostForm({ communityId, existing, onDone, onCancel }: PostFormProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const [body, setBody] = useState(existing?.body ?? '');
  const [touched, setTouched] = useState(false);

  const trimmed = body.trim();
  const validationError = !trimmed
    ? 'Write something first.'
    : trimmed.length > MAX_LENGTH
      ? `Keep it under ${MAX_LENGTH} characters.`
      : null;

  const mutation = useMutation({
    mutationFn: (): Promise<Post> =>
      existing
        ? api<Post>(`/posts/${existing.id}`, { method: 'PATCH', body: { body: trimmed } })
        : api<Post>(`/communities/${communityId}/posts`, {
            method: 'POST',
            body: { body: trimmed },
          }),
    onSuccess: async (saved) => {
      if (existing) {
        // edit: patch the cached row in place — no refetch needed
        patchPostInFeed(queryClient, communityId, existing.id, () => saved);
      } else {
        // create: refetch so the new post appears at the top with real data
        await queryClient.invalidateQueries({ queryKey: feedQueryKey(communityId) });
      }
      toast.success(existing ? 'Post updated.' : 'Posted!');
      onDone();
    },
    onError: (error) => {
      toast.error(
        error instanceof ApiError ? error.message : "Couldn't save the post. Please try again.",
      );
    },
  });

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (validationError || mutation.isPending) return;
    mutation.mutate();
  }

  const showError = touched && validationError;

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-3">
      <label htmlFor="post-body" className="sr-only">
        Post content
      </label>
      <textarea
        id="post-body"
        rows={5}
        value={body}
        autoFocus
        onChange={(e) => {
          setBody(e.target.value);
          setTouched(true);
        }}
        aria-invalid={showError ? true : undefined}
        aria-describedby={showError ? 'post-body-error' : 'post-body-count'}
        placeholder="What's happening in the community?"
        className="w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-2 focus:outline-offset-0 focus:outline-indigo-500/40 dark:border-zinc-700 dark:bg-zinc-900"
      />
      <div className="flex items-center justify-between text-xs">
        {showError ? (
          <p id="post-body-error" role="alert" className="text-red-600 dark:text-red-400">
            {validationError}
          </p>
        ) : (
          <span />
        )}
        <span
          id="post-body-count"
          className={`tabular-nums ${
            trimmed.length > MAX_LENGTH
              ? 'text-red-600 dark:text-red-400'
              : 'text-zinc-400 dark:text-zinc-500'
          }`}
        >
          {trimmed.length}/{MAX_LENGTH}
        </span>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onCancel} className={secondaryButtonClass}>
          Cancel
        </button>
        <button
          type="submit"
          disabled={mutation.isPending || Boolean(validationError)}
          className={primaryButtonClass}
        >
          {mutation.isPending ? 'Saving…' : existing ? 'Save changes' : 'Post'}
        </button>
      </div>
    </form>
  );
}
