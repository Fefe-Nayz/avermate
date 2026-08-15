import { useSyncExternalStore } from "react";

let compact = false;
let reduceMotion = false;
let revision = 0;
const listeners = new Set<() => void>();

export function setInteractionPreferences(value: {
  compactMode: boolean;
  reduceMotion: boolean;
}): void {
  if (compact === value.compactMode && reduceMotion === value.reduceMotion)
    return;
  compact = value.compactMode;
  reduceMotion = value.reduceMotion;
  revision += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useInteractionPreferences() {
  useSyncExternalStore(
    subscribe,
    () => revision,
    () => 0,
  );
  return { compactMode: compact, reduceMotion } as const;
}
