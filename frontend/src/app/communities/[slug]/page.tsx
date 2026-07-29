'use client';

import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { LikeButton } from '@/components/post/LikeButton';
import { PostForm } from '@/components/post/PostForm';
import {
  feedQueryKey,
  removePostFromFeed,
} from '@/components/post/feed-cache';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/toast/ToastProvider';
import { primaryButtonClass, secondaryButtonClass } from '@/components/ui/form';
import { api, ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { canModerate, isMember } from '@/lib/roles';
import { useSession } from '@/lib/session';
import { Feed, Post } from '@/lib/types';
import { useCommunity } from './community-context';

const PAGE_SIZE = 10;

export default function FeedPage() {
  const community = useCommunity();
  const { user } = useSession();
  const canInteract = isMember(user, community);
  const moderates = canModerate(user, community);

  const [composing, setComposing] = useState(false);

  const {
    data,
    isPending,
    isError,
    refetch,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: feedQueryKey(community.id),
    queryFn: ({ pageParam }) =>
      api<Feed>(
        `/communities/${community.id}/posts?limit=${PAGE_SIZE}${
          pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''
        }`,
      ),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
  });

  // sentinel-based infinite scroll
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && hasNextPage && !isFetchingNextPage) {
          void fetchNextPage();
        }
      },
      { rootMargin: '400px' }, // start loading before the user hits the end
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);

  if (isPending) return <FeedSkeleton />;

  if (isError) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-zinc-200 py-12 text-center dark:border-zinc-800">
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Couldn&apos;t load the feed.
        </p>
        <button type="button" onClick={() => void refetch()} className={secondaryButtonClass}>
          Retry
        </button>
      </div>
    );
  }

  const posts = data.pages.flatMap((page) => page.items);

  return (
    <div className="flex flex-col gap-4">
      {canInteract && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => setComposing(true)}
            className={primaryButtonClass}
          >
            New post
          </button>
        </div>
      )}

      <Modal open={composing} onClose={() => setComposing(false)} title="New post">
        <PostForm
          communityId={community.id}
          onDone={() => setComposing(false)}
          onCancel={() => setComposing(false)}
        />
      </Modal>

      {posts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-zinc-300 py-12 text-center dark:border-zinc-700">
          <p className="text-2xl" aria-hidden="true">
            📝
          </p>
          <p className="text-sm font-medium">No posts yet</p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {canInteract
              ? 'Be the first to share something.'
              : 'Join the community to start the conversation.'}
          </p>
        </div>
      ) : (
        <>
          <ul className="flex flex-col gap-4">
            {posts.map((post) => (
              <li key={post.id}>
                <PostCard
                  post={post}
                  communityId={community.id}
                  canLike={canInteract}
                  canEdit={post.isMine || moderates}
                />
              </li>
            ))}
          </ul>

          {/* the sentinel drives fetchNextPage via IntersectionObserver */}
          <div ref={sentinelRef} aria-hidden="true" />

          {isFetchingNextPage && (
            <div className="py-2" aria-hidden="true">
              <PostSkeleton />
            </div>
          )}

          {!hasNextPage && (
            <p className="py-4 text-center text-sm text-zinc-400 dark:text-zinc-500">
              You&apos;re all caught up ✨
            </p>
          )}
        </>
      )}
    </div>
  );
}

function PostCard({
  post,
  communityId,
  canLike,
  canEdit,
}: {
  post: Post;
  communityId: string;
  canLike: boolean;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function deletePost() {
    try {
      await api<void>(`/posts/${post.id}`, { method: 'DELETE' });
    } catch (error) {
      // rethrown so the ConfirmDialog surfaces it inline
      throw error instanceof ApiError ? error : new Error("Couldn't delete the post.");
    }
    removePostFromFeed(queryClient, communityId, post.id);
    toast.success('Post deleted.');
  }

  return (
    <article className="rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <header className="mb-2 flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">
          {post.author.displayName}
          {post.isMine && (
            <span className="ml-1.5 text-xs font-normal text-zinc-400">(you)</span>
          )}
        </span>
        <time
          dateTime={post.createdAt}
          title={new Date(post.createdAt).toLocaleString()}
          className="shrink-0 text-xs text-zinc-400 dark:text-zinc-500"
        >
          {timeAgo(post.createdAt)}
        </time>
      </header>

      <p className="text-sm leading-relaxed whitespace-pre-wrap">{post.body}</p>

      <footer className="mt-3 flex items-center justify-between">
        <LikeButton post={post} communityId={communityId} canLike={canLike} />

        {canEdit && (
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500 dark:hover:bg-zinc-900 dark:hover:text-zinc-100"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => setDeleting(true)}
              className="rounded px-2 py-1 text-xs text-zinc-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-500 dark:hover:bg-red-950 dark:hover:text-red-300"
            >
              Delete
            </button>
          </div>
        )}
      </footer>

      <Modal open={editing} onClose={() => setEditing(false)} title="Edit post">
        <PostForm
          communityId={communityId}
          existing={post}
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      </Modal>

      <ConfirmDialog
        open={deleting}
        onClose={() => setDeleting(false)}
        title="Delete post?"
        confirmLabel="Delete post"
        onConfirm={deletePost}
      >
        This removes {post.isMine ? 'your' : `${post.author.displayName}'s`} post
        and its likes permanently. There is no undo.
      </ConfirmDialog>
    </article>
  );
}

function PostSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="mb-3 h-4 w-32 rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="h-3 w-full rounded bg-zinc-100 dark:bg-zinc-900" />
      <div className="mt-2 h-3 w-3/4 rounded bg-zinc-100 dark:bg-zinc-900" />
    </div>
  );
}

function FeedSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading feed">
      <PostSkeleton />
      <PostSkeleton />
      <PostSkeleton />
    </div>
  );
}
