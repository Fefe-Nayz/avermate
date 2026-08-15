import * as SecureStore from "expo-secure-store";
import { localUserKey } from "./local-settings";
import {
  DEFAULT_SYSTEM_WIDGET_PREFERENCE,
  parseSystemWidgetPreference,
  type SystemWidgetPreference,
} from "./system-widget-model";

const listeners = new Set<() => void>();
let revision = 0;

function storageKey(userId: string): string {
  return localUserKey(userId, "system-widget");
}

export function systemWidgetSettingsRevision(): number {
  return revision;
}

export function subscribeSystemWidgetSettings(
  listener: () => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function changed(): void {
  revision += 1;
  for (const listener of listeners) listener();
}

export async function loadSystemWidgetPreference(
  userId: string,
): Promise<SystemWidgetPreference> {
  const stored = await SecureStore.getItemAsync(storageKey(userId));
  return parseSystemWidgetPreference(stored);
}

export async function saveSystemWidgetPreference(
  userId: string,
  preference: SystemWidgetPreference,
): Promise<void> {
  await SecureStore.setItemAsync(
    storageKey(userId),
    JSON.stringify(preference),
  );
  changed();
}

export async function clearSystemWidgetPreference(
  userId: string,
): Promise<void> {
  await SecureStore.deleteItemAsync(storageKey(userId));
  changed();
}

export function disabledSystemWidgetPreference(): SystemWidgetPreference {
  return DEFAULT_SYSTEM_WIDGET_PREFERENCE;
}
