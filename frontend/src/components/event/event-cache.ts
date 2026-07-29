import { QueryClient } from '@tanstack/react-query';
import { CommunityEvent, Paginated } from '@/lib/types';

export function eventsQueryKey(communityId: string) {
  return ['events', communityId] as const;
}

export function eventQueryKey(eventId: string) {
  return ['event', eventId] as const;
}

interface EventCacheSnapshot {
  list: Paginated<CommunityEvent> | undefined;
  detail: CommunityEvent | undefined;
}

/** Patches one event wherever it is cached — the tab list and the detail page. */
export function patchEvent(
  queryClient: QueryClient,
  communityId: string,
  eventId: string,
  patch: (event: CommunityEvent) => CommunityEvent,
): EventCacheSnapshot {
  const listKey = eventsQueryKey(communityId);
  const detailKey = eventQueryKey(eventId);

  const list = queryClient.getQueryData<Paginated<CommunityEvent>>(listKey);
  const detail = queryClient.getQueryData<CommunityEvent>(detailKey);

  if (list) {
    queryClient.setQueryData<Paginated<CommunityEvent>>(listKey, {
      ...list,
      items: list.items.map((e) => (e.id === eventId ? patch(e) : e)),
    });
  }
  if (detail) {
    queryClient.setQueryData<CommunityEvent>(detailKey, patch(detail));
  }

  return { list, detail };
}

export function restoreEvent(
  queryClient: QueryClient,
  communityId: string,
  eventId: string,
  snapshot: EventCacheSnapshot,
): void {
  if (snapshot.list) {
    queryClient.setQueryData(eventsQueryKey(communityId), snapshot.list);
  }
  if (snapshot.detail) {
    queryClient.setQueryData(eventQueryKey(eventId), snapshot.detail);
  }
}
