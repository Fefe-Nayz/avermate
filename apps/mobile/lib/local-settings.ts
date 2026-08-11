/**
 * A SecureStore namespace owned by one account.
 *
 * Better Auth IDs currently only contain safe characters, but normalising the
 * value here keeps the storage contract valid if that implementation changes.
 */
export function localUserKey(userId: string, setting: string): string {
  const owner = userId.replace(/[^A-Za-z0-9._-]/g, "_");
  const name = setting.replace(/[^A-Za-z0-9._-]/g, "_");
  return `avermate.user.${owner}.${name}`;
}

/** Global keys used by builds before account-scoped local state. */
export const LEGACY_LOCAL_KEYS = [
  "avermate.locale",
  "avermate.theme",
  "avermate.haptics",
  "avermate.year",
  "avermate.period",
] as const;

export const LOCAL_USER_SETTING_NAMES = [
  "locale",
  "theme",
  "haptics",
  "year",
  "period",
  "year-setup",
  "system-widget",
] as const;

export async function clearLocalUserSettings(userId: string): Promise<void> {
  const SecureStore = await import("expo-secure-store");
  await Promise.all(
    LOCAL_USER_SETTING_NAMES.map((setting) =>
      SecureStore.deleteItemAsync(localUserKey(userId, setting)),
    ),
  );
}
