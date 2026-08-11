import { describe, expect, test } from "bun:test"
import {
  clearYearSetupDraft,
  readYearSetupDraft,
  writeYearSetupDraft,
  yearSetupDraftKey,
  type DraftStorage,
  type YearSetupDraft,
} from "./year-setup-draft"

class MemoryStorage implements DraftStorage {
  readonly values = new Map<string, string>()

  getItem(key: string) {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string) {
    this.values.set(key, value)
  }

  removeItem(key: string) {
    this.values.delete(key)
  }
}

const draft: YearSetupDraft = {
  version: 1,
  idempotencyKey: "setup-key-123",
  name: "2026–2027",
  startsAt: "2026-09-01",
  endsAt: "2027-07-15",
  scale: "20",
  presetId: "lycee",
  periodTemplate: "trimesters",
  step: "preset",
}

describe("year setup draft", () => {
  test("keeps one stable idempotency key with the editable setup values", () => {
    const storage = new MemoryStorage()
    writeYearSetupDraft(storage, "additional", draft)

    expect(readYearSetupDraft(storage, "additional")).toEqual(draft)
    expect(readYearSetupDraft(storage, "first")).toBeNull()
  })

  test("drops corrupt or obsolete state instead of blocking onboarding", () => {
    const storage = new MemoryStorage()
    storage.setItem(yearSetupDraftKey("first"), "{")

    expect(readYearSetupDraft(storage, "first")).toBeNull()
    expect(storage.getItem(yearSetupDraftKey("first"))).toBeNull()

    storage.setItem(
      yearSetupDraftKey("first"),
      JSON.stringify({ ...draft, version: 0 })
    )
    expect(readYearSetupDraft(storage, "first")).toBeNull()
  })

  test("clears only the completed flow", () => {
    const storage = new MemoryStorage()
    writeYearSetupDraft(storage, "first", draft)
    writeYearSetupDraft(storage, "additional", {
      ...draft,
      idempotencyKey: "another-key",
    })

    clearYearSetupDraft(storage, "first")

    expect(readYearSetupDraft(storage, "first")).toBeNull()
    expect(readYearSetupDraft(storage, "additional")?.idempotencyKey).toBe(
      "another-key"
    )
  })
})
