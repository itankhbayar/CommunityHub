'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useContext } from 'react';
import { api, ApiError } from './api';
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

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: SESSION_QUERY_KEY });
  };

  return (
    <SessionContext.Provider value={{ user: data, isLoading, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}
