import { beforeEach, describe, expect, mock, test } from "bun:test";

const values = new Map<string, string>();
mock.module("expo-secure-store", () => ({
  getItemAsync: async (key: string) => values.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    values.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    values.delete(key);
  },
}));

const {
  clearYearSetupDraft,
  loadYearSetupDraft,
  parseYearSetupDraft,
  persistYearSetupDraft,
} = await import("./year-setup-draft");

const draft = {
  version: 1 as const,
  idempotencyKey: "setup-test-1234",
  yearId: null,
  presetId: null,
  step: "year" as const,
  year: {
    name: "2026–2027",
    startsAt: "2026-09-01T12:00:00.000Z",
    endsAt: "2027-07-01T12:00:00.000Z",
    scale: "20",
  },
  periods: null,
  updatedAt: 1,
};

beforeEach(() => values.clear());

describe("year setup draft persistence", () => {
  test("round-trips an account-scoped resumable draft", async () => {
    await persistYearSetupDraft("alice", draft);
    expect(await loadYearSetupDraft("alice")).toEqual(draft);
    expect(await loadYearSetupDraft("bob")).toBeNull();
  });

  test("ignores truncated, malformed and future-version values", () => {
    expect(parseYearSetupDraft("{")).toBeNull();
    expect(
      parseYearSetupDraft(JSON.stringify({ ...draft, version: 2 })),
    ).toBeNull();
    expect(
      parseYearSetupDraft(
        JSON.stringify({ ...draft, year: { ...draft.year, startsAt: null } }),
      ),
    ).toBeNull();
  });

  test("migrates drafts saved before preset selection was persisted", () => {
    const { presetId: _presetId, ...legacyDraft } = draft;

    expect(parseYearSetupDraft(JSON.stringify(legacyDraft))).toEqual(draft);
  });

  test("only a matching completed flow can clear the saved draft", async () => {
    await persistYearSetupDraft("alice", draft);
    await clearYearSetupDraft("alice", "another-setup");
    expect(await loadYearSetupDraft("alice")).toEqual(draft);

    await clearYearSetupDraft("alice", draft.idempotencyKey);
    expect(await loadYearSetupDraft("alice")).toBeNull();
  });

  test("serializes rapid writes so the newest edit wins", async () => {
    await Promise.all([
      persistYearSetupDraft("alice", { ...draft, updatedAt: 2 }),
      persistYearSetupDraft("alice", {
        ...draft,
        step: "subjects",
        yearId: "y_1",
        updatedAt: 3,
      }),
    ]);

    expect(await loadYearSetupDraft("alice")).toMatchObject({
      step: "subjects",
      yearId: "y_1",
      updatedAt: 3,
    });
  });
});
