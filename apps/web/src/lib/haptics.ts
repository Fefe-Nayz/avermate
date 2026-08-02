"use client";

/**
 * Haptic feedback.
 *
 * The Vibration API is all the web gives us, so patterns are hand-tuned to
 * read as distinct through a phone case: a tap for selection, a double pulse
 * for success, a long one for an error. Silently inert on hardware without a
 * motor, which is every desktop.
 */

export type HapticTone =
  | "selection"
  | "light"
  | "medium"
  | "heavy"
  | "success"
  | "warning"
  | "error";

const PATTERNS: Record<HapticTone, number | number[]> = {
  selection: 8,
  light: 12,
  medium: 22,
  heavy: 38,
  success: [14, 45, 22],
  warning: [24, 60, 24],
  error: [36, 55, 36, 55, 36],
};

const STORAGE_KEY = "avermate:haptics";

let enabled = true;

export function loadHapticsPreference(): boolean {
  if (typeof window === "undefined") return true;
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    enabled = stored === null ? true : stored === "true";
  } catch {
    enabled = true;
  }
  return enabled;
}

export function setHapticsEnabled(value: boolean): void {
  enabled = value;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(value));
  } catch {
    // Private browsing can refuse storage; the in-memory flag still holds.
  }
}

export function hapticsEnabled(): boolean {
  return enabled;
}

export function haptic(tone: HapticTone = "medium"): void {
  if (!enabled) return;
  if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
  try {
    navigator.vibrate(PATTERNS[tone]);
  } catch {
    // Some browsers throw when the page is not visible. Not worth reporting.
  }
}

/** Wraps a handler so it buzzes before running. */
export function withHaptic<T extends unknown[]>(
  tone: HapticTone,
  handler?: (...args: T) => void,
): (...args: T) => void {
  return (...args: T) => {
    haptic(tone);
    handler?.(...args);
  };
}
