"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * State that survives a reload, kept in localStorage.
 *
 * Reads happen after mount rather than during the first render: the server
 * has no storage, and reading it in a lazy initialiser would make the two
 * renders disagree and hydration fail.
 */
export function useStickyState<T>(
  key: string,
  initial: T,
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(initial);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(key);
      if (stored !== null) setValue(JSON.parse(stored) as T);
    } catch {
      // Corrupted or unavailable storage falls back to the initial value.
    }
  }, [key]);

  const update = useCallback(
    (next: T) => {
      setValue(next);
      try {
        window.localStorage.setItem(key, JSON.stringify(next));
      } catch {
        // Private browsing refuses writes; the value still holds in memory.
      }
    },
    [key],
  );

  return [value, update];
}
