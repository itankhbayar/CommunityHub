'use client';

import { ReactNode, useState } from 'react';
import { dangerButtonClass, secondaryButtonClass } from './form';
import { Modal } from './Modal';

interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  /** what happens if they confirm — spelled out, not implied */
  children: ReactNode;
  confirmLabel: string;
  /** awaited; dialog closes on success, stays open with the error surfaced otherwise */
  onConfirm: () => Promise<void>;
}

/** Destructive-action gate: nothing irreversible happens on a single click. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setPending(false);
    }
  }

  function close() {
    setError(null);
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title={title}>
      <div className="text-sm text-zinc-600 dark:text-zinc-400">{children}</div>
      {error && (
        <p
          role="alert"
          className="mt-3 rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
        >
          {error}
        </p>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={close} className={secondaryButtonClass}>
          Cancel
        </button>
        <button
          type="button"
          onClick={() => void confirm()}
          disabled={pending}
          className={dangerButtonClass}
        >
          {pending ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
