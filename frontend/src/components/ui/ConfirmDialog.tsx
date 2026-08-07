'use client';

import { ReactNode, useId, useState } from 'react';
import { dangerButtonClass, inputClass, secondaryButtonClass } from './form';
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
  /**
   * When set, the confirm button stays disabled until this exact string is
   * typed. Reserve it for actions that destroy data belonging to other people
   * — a modal alone is enough friction for anything undoable or self-scoped.
   */
  confirmPhrase?: string;
}

/** Destructive-action gate: nothing irreversible happens on a single click. */
export function ConfirmDialog({
  open,
  onClose,
  title,
  children,
  confirmLabel,
  onConfirm,
  confirmPhrase,
}: ConfirmDialogProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const phraseId = useId();

  const phraseSatisfied = !confirmPhrase || typed === confirmPhrase;

  async function confirm() {
    if (pending || !phraseSatisfied) return;
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
    setTyped('');
    onClose();
  }

  return (
    <Modal open={open} onClose={close} title={title}>
      <div className="text-sm text-zinc-600 dark:text-zinc-400">{children}</div>

      {confirmPhrase && (
        <div className="mt-4 flex flex-col gap-1.5">
          <label htmlFor={phraseId} className="text-sm font-medium">
            Type <code className="font-mono text-red-600 dark:text-red-400">
              {confirmPhrase}
            </code>{' '}
            to confirm
          </label>
          <input
            id={phraseId}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            // the browser's own autofill/suggestion UI would defeat the point
            // of asking someone to type the name out
            autoCorrect="off"
            spellCheck={false}
            className={inputClass}
          />
        </div>
      )}

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
          disabled={pending || !phraseSatisfied}
          className={dangerButtonClass}
        >
          {pending ? 'Working…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
