import { describe, expect, test } from "bun:test"
import {
  isActiveSyncJob,
  isTerminalSyncJob,
  moodleMobileLaunchUrl,
  readSyncRunSummary,
} from "./moodle-sync-model"

describe("Moodle sync view model", () => {
  test("builds the mobile hand-off under the user's HTTPS Moodle base path", () => {
    expect(moodleMobileLaunchUrl("https://school.example/moodle/")).toBe(
      "https://school.example/moodle/admin/tool/mobile/launch.php?service=moodle_mobile_app&passport=TOKEN123&confirmed=1"
    )
  })

  test("never turns an unsafe or ambiguous base address into a login link", () => {
    expect(moodleMobileLaunchUrl("http://school.example")).toBeNull()
    expect(moodleMobileLaunchUrl("https://user:pass@school.example")).toBeNull()
    expect(
      moodleMobileLaunchUrl("https://school.example?token=secret")
    ).toBeNull()
    expect(moodleMobileLaunchUrl("not a url")).toBeNull()
  })

  test("accepts only complete, non-negative durable-job results", () => {
    expect(
      readSyncRunSummary({
        downloaded: 2,
        updated: 1,
        skipped: 3,
        errors: [{ externalId: "remote-1", message: "one file failed" }],
      })
    ).toEqual({
      downloaded: 2,
      updated: 1,
      skipped: 3,
      errors: [{ externalId: "remote-1", message: "one file failed" }],
    })
    expect(readSyncRunSummary({ downloaded: 2, updated: 1 })).toBeNull()
    expect(
      readSyncRunSummary({
        downloaded: -1,
        updated: 0,
        skipped: 0,
        errors: [],
      })
    ).toBeNull()
  })

  test("separates pollable and terminal job states", () => {
    expect(isActiveSyncJob("queued")).toBe(true)
    expect(isActiveSyncJob("running")).toBe(true)
    expect(isTerminalSyncJob("succeeded")).toBe(true)
    expect(isTerminalSyncJob("failed")).toBe(true)
    expect(isTerminalSyncJob("cancelled")).toBe(true)
    expect(isTerminalSyncJob("running")).toBe(false)
  })
})
