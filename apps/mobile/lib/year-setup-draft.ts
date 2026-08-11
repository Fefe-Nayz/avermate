import * as SecureStore from "expo-secure-store";
import { localUserKey } from "@/lib/local-settings";

export const YEAR_SETUP_DRAFT_VERSION = 1 as const;

export type YearSetupStep = "year" | "subjects" | "periods";

export interface PersistedPeriodDraft {
  localId: string;
  periodId?: string;
  name: string;
  startsAt: string;
  endsAt: string;
  isCumulative: boolean;
}

export interface YearSetupDraft {
  version: typeof YEAR_SETUP_DRAFT_VERSION;
  idempotencyKey: string;
  yearId: string | null;
  step: YearSetupStep;
  year: {
    name: string;
    startsAt: string;
    endsAt: string;
    scale: string;
  };
  periods: PersistedPeriodDraft[] | null;
  updatedAt: number;
}

interface SetupDraftStorage {
  getItemAsync(key: string): Promise<string | null>;
  setItemAsync(key: string, value: string): Promise<void>;
  deleteItemAsync(key: string): Promise<void>;
}

const writes = new Map<string, Promise<void>>();

function storageKey(userId: string): string {
  return localUserKey(userId, "year-setup");
}

function isString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPeriodDraft(value: unknown): value is PersistedPeriodDraft {
  if (!value || typeof value !== "object") return false;
  const period = value as Partial<PersistedPeriodDraft>;
  return (
    isString(period.localId) &&
    (period.periodId === undefined || isString(period.periodId)) &&
    typeof period.name === "string" &&
    isString(period.startsAt) &&
    isString(period.endsAt) &&
    typeof period.isCumulative === "boolean"
  );
}

/** Invalid or future-version values are ignored instead of breaking startup. */
export function parseYearSetupDraft(
  value: string | null,
): YearSetupDraft | null {
  if (!value) return null;
  try {
    const draft = JSON.parse(value) as Partial<YearSetupDraft>;
    if (
      draft.version !== YEAR_SETUP_DRAFT_VERSION ||
      !isString(draft.idempotencyKey) ||
      !(draft.yearId === null || isString(draft.yearId)) ||
      !(["year", "subjects", "periods"] as const).includes(
        draft.step as YearSetupStep,
      ) ||
      !draft.year ||
      typeof draft.year.name !== "string" ||
      !isString(draft.year.startsAt) ||
      !isString(draft.year.endsAt) ||
      typeof draft.year.scale !== "string" ||
      !(
        draft.periods === null ||
        (Array.isArray(draft.periods) && draft.periods.every(isPeriodDraft))
      ) ||
      typeof draft.updatedAt !== "number"
    ) {
      return null;
    }
    return draft as YearSetupDraft;
  } catch {
    return null;
  }
}

export async function loadYearSetupDraft(
  userId: string,
  storage: SetupDraftStorage = SecureStore,
): Promise<YearSetupDraft | null> {
  return parseYearSetupDraft(await storage.getItemAsync(storageKey(userId)));
}

/**
 * Serialize writes per account. A slow SecureStore write can otherwise finish
 * after a newer field edit and resurrect stale wizard state.
 */
export function persistYearSetupDraft(
  userId: string,
  draft: YearSetupDraft,
  storage: SetupDraftStorage = SecureStore,
): Promise<void> {
  const key = storageKey(userId);
  const pending = (writes.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(() => storage.setItemAsync(key, JSON.stringify(draft)));
  writes.set(key, pending);
  return pending.finally(() => {
    if (writes.get(key) === pending) writes.delete(key);
  });
}

/** Only the completed wizard may remove its own draft. */
export function clearYearSetupDraft(
  userId: string,
  idempotencyKey: string,
  storage: SetupDraftStorage = SecureStore,
): Promise<void> {
  const key = storageKey(userId);
  const pending = (writes.get(key) ?? Promise.resolve())
    .catch(() => undefined)
    .then(async () => {
      const current = parseYearSetupDraft(await storage.getItemAsync(key));
      if (current?.idempotencyKey === idempotencyKey) {
        await storage.deleteItemAsync(key);
      }
    });
  writes.set(key, pending);
  return pending.finally(() => {
    if (writes.get(key) === pending) writes.delete(key);
  });
}
