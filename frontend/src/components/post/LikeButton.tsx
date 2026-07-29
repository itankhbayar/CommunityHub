'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useToast } from '@/components/toast/ToastProvider';
import { api } from '@/lib/api';
import { Post } from '@/lib/types';
import { feedQueryKey, patchPostInFeed, restoreFeed } from './feed-cache';

interface LikeButtonProps {
  post: Post;
  communityId: string;
  /** non-members see the count but cannot act */
  canLike: boolean;
}

/**
 * Optimistic: the heart flips and the count moves the instant you click; if
 * the server refuses, the cache snapshot is restored — a visible rollback —
 * and a toast explains. The API is an idempotent PUT/DELETE pair, so a
 * double-click cannot double-count even if both requests land.
 */
export function LikeButton({ post, communityId, canLike }: LikeButtonProps) {
  const queryClient = useQueryClient();
  const toast = useToast();

  const mutation = useMutation({
    mutationFn: (nextLiked: boolean) =>
      api<void>(`/posts/${post.id}/like`, {
        method: nextLiked ? 'PUT' : 'DELETE',
      }),
    onMutate: async (nextLiked) => {
      await queryClient.cancelQueries({ queryKey: feedQueryKey(communityId) });
      const snapshot = patchPostInFeed(queryClient, communityId, post.id, (p) => ({
        ...p,
        likedByMe: nextLiked,
        likeCount: p.likeCount + (nextLiked ? 1 : -1),
      }));
      return { snapshot };
    },
    onError: (_error, _next, context) => {
      restoreFeed(queryClient, communityId, context?.snapshot);
      toast.error("Couldn't update your like. Please try again.");
    },
  });

  return (
    <button
      type="button"
      onClick={() => canLike && mutation.mutate(!post.likedByMe)}
      disabled={!canLike}
      aria-pressed={post.likedByMe}
      aria-label={
        post.likedByMe
          ? `Unlike (${post.likeCount} likes)`
          : `Like (${post.likeCount} likes)`
      }
      title={canLike ? undefined : 'Join the community to like posts'}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 ${
        post.likedByMe
          ? 'text-rose-600 dark:text-rose-400'
          : 'text-zinc-500 hover:text-rose-600 dark:text-zinc-400 dark:hover:text-rose-400'
      } ${!canLike ? 'cursor-default opacity-60 hover:text-zinc-500 dark:hover:text-zinc-400' : ''}`}
    >
      <span aria-hidden="true">{post.likedByMe ? '♥' : '♡'}</span>
      <span className="tabular-nums">{post.likeCount}</span>
    </button>
  );
}
