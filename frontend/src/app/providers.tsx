'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactNode, useState } from 'react';
import { ToastProvider } from '@/components/toast/ToastProvider';
import { ApiError } from '@/lib/api';
import { SessionProvider } from '@/lib/session';

export function Providers({ children }: { children: ReactNode }) {
  // created in state so a hot reload doesn't rebuild the cache mid-session
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // 4xx responses are answers, not transient failures — never retry them
            retry: (failureCount, error) =>
              !(error instanceof ApiError && error.status < 500) &&
              failureCount < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <SessionProvider>{children}</SessionProvider>
      </ToastProvider>
    </QueryClientProvider>
  );
}
