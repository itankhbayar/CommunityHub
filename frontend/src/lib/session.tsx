'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext, useEffect } from 'react';
import { api, ApiError } from './api';
import { setSessionHint } from './session-hint';
import { SessionUser } from './types';

interface SessionState {
  /** undefined while loading, null when signed out */
  user: SessionUser | null | undefined;
  isLoading: boolean;
  /** re-fetch after login/logout/membership changes */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

export function useSession(): SessionState {
  const state = useContext(SessionContext);
  if (!state) throw new Error('useSession must be used inside <SessionProvider>');
  return state;
}

export const SESSION_QUERY_KEY = ['session'] as const;

export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: SESSION_QUERY_KEY,
    queryFn: async (): Promise<SessionUser | null> => {
      try {
        return await api<SessionUser>('/auth/me');
      } catch (error) {
        // signed out is a state, not an error
        if (error instanceof ApiError && error.status === 401) return null;
        throw error;
      }
    },
    staleTime: 60_000,
    retry: (failureCount, error) =>
      !(error instanceof ApiError) && failureCount < 2,
  });

  // Record the outcome so the next page load can pick the right placeholder
  // before the network answers. Login and logout both land here via refresh().
  // An errored query leaves `data` undefined and the previous hint standing —
  // a failed round trip is not evidence either way.
  useEffect(() => {
    if (data !== undefined) setSessionHint(data !== null);
  }, [data]);

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  };

  return (
    <SessionContext.Provider value={{ user: data, isLoading, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}
