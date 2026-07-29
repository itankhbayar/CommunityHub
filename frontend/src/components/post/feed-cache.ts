import { InfiniteData, QueryClient } from '@tanstack/react-query';
import { Feed, Post } from '@/lib/types';

export function feedQueryKey(communityId: string) {
  return ['feed', communityId] as const;
}

type FeedCache = InfiniteData<Feed, string | undefined>;

/** Applies a per-post patch across every cached feed page. */
export function patchPostInFeed(
  queryClient: QueryClient,
  communityId: string,
  postId: string,
  patch: (post: Post) => Post,
): FeedCache | undefined {
  const key = feedQueryKey(communityId);
  const previous = queryClient.getQueryData<FeedCache>(key);

  if (previous) {
    queryClient.setQueryData<FeedCache>(key, {
      ...previous,
      pages: previous.pages.map((page) => ({
        ...page,
        items: page.items.map((post) => (post.id === postId ? patch(post) : post)),
      })),
    });
  }

  return previous;
}

export function restoreFeed(
  queryClient: QueryClient,
  communityId: string,
  snapshot: FeedCache | undefined,
): void {
  if (snapshot) {
    queryClient.setQueryData(feedQueryKey(communityId), snapshot);
  }
}

export function removePostFromFeed(
  queryClient: QueryClient,
  communityId: string,
  postId: string,
): FeedCache | undefined {
  const key = feedQueryKey(communityId);
  const previous = queryClient.getQueryData<FeedCache>(key);

  if (previous) {
    queryClient.setQueryData<FeedCache>(key, {
      ...previous,
      pages: previous.pages.map((page) => ({
        ...page,
        items: page.items.filter((post) => post.id !== postId),
      })),
    });
  }

  return previous;
}
