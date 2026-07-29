'use client';

import { useEffect, useMemo, useRef } from 'react';

/** Stable debounced wrapper; pending call is dropped on unmount. */
export function useDebouncedCallback<Args extends unknown[]>(
  callback: (...args: Args) => void,
  delayMs: number,
): (...args: Args) => void {
  const callbackRef = useRef(callback);
  // updated post-render, not during — keeps the latest closure without
  // retriggering the memo below
  useEffect(() => {
    callbackRef.current = callback;
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  return useMemo(
    () =>
      (...args: Args) => {
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          callbackRef.current(...args);
        }, delayMs);
      },
    [delayMs],
  );
}
