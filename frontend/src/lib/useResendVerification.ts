'use client';

import { useState } from 'react';
import { useToast } from '@/components/toast/ToastProvider';
import { api, ApiError } from './api';
import { useSession } from './session';

/**
 * Shared by the advisory banner and the account page, which are two entry
 * points to one action. Keeping the call in one place means the wording of the
 * success toast — which has to stay true whether the server actually sent
 * anything or suppressed it under the per-account cooldown — is written once.
 */
export function useResendVerification() {
  const { refresh } = useSession();
  const toast = useToast();
  const [pending, setPending] = useState(false);

  async function resend(): Promise<void> {
    if (pending) return;
    setPending(true);
    try {
      await api('/auth/verify-email/resend', { method: 'POST' });
      toast.success('Confirmation email on its way. Check your inbox.');
      // in case the address was confirmed in another tab while this one sat open
      await refresh();
    } catch (error) {
      toast.error(
        error instanceof ApiError
          ? error.message
          : "Couldn't send the email. Please try again.",
      );
    } finally {
      setPending(false);
    }
  }

  return { resend, pending };
}
