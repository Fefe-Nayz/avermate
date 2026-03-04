import {
  WebHaptics,
  type HapticInput,
  type TriggerOptions,
} from "web-haptics";

export type AppHapticPreset =
  | "success"
  | "warning"
  | "error"
  | "light"
  | "medium"
  | "heavy"
  | "selection";

export const HAPTICS_STORAGE_KEY = "avermate:haptics-enabled";
const DEFAULT_HAPTICS_ENABLED = true;

let webHapticsInstance: WebHaptics | null = null;

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function getWebHaptics(): WebHaptics | null {
  if (!isBrowser()) {
    return null;
  }

  if (!webHapticsInstance) {
    webHapticsInstance = new WebHaptics();
  }

  return webHapticsInstance;
}

export function isHapticsEnabled(): boolean {
  if (!isBrowser()) {
    return DEFAULT_HAPTICS_ENABLED;
  }

  try {
    const storedValue = window.localStorage.getItem(HAPTICS_STORAGE_KEY);

    if (storedValue === null) {
      return DEFAULT_HAPTICS_ENABLED;
    }

    return storedValue === "true";
  } catch {
    return DEFAULT_HAPTICS_ENABLED;
  }
}

export function setHapticsEnabled(enabled: boolean): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(HAPTICS_STORAGE_KEY, String(enabled));
  } catch {
    // localStorage can be unavailable in strict privacy contexts.
  }
}

export function triggerHaptic(
  input: AppHapticPreset | HapticInput = "medium",
  options?: TriggerOptions
): void {
  if (!isHapticsEnabled()) {
    return;
  }

  const haptics = getWebHaptics();

  if (!haptics) {
    return;
  }

  void haptics.trigger(input, options);
}
