import { describe, expect, test } from "bun:test"
import {
  academicYearBoundary,
  academicYearDateValue,
  gradeRecordCounts,
  schoolConnectionState,
} from "./school-sync-onboarding-model"

describe("school synchronization onboarding model", () => {
  test("turns durable connection statuses into actionable UI states", () => {
    expect(schoolConnectionState("active", true)).toBe("connected")
    expect(schoolConnectionState("error", true)).toBe("attention")
    expect(schoolConnectionState("pending", true)).toBe("pending")
    expect(schoolConnectionState("revoked", true)).toBe("reconnect")
    expect(schoolConnectionState("disconnected", true)).toBe("reconnect")
    expect(schoolConnectionState("active", false)).toBe("unavailable")
  })

  test("counts provider snapshot states separately from non-numeric grades", () => {
    expect(
      gradeRecordCounts([
        { syncState: "managed", value: 15, outOf: 20, significant: true },
        { syncState: "managed", value: null, outOf: null, significant: false },
        { syncState: "missing", value: 8, outOf: 10, significant: true },
        { syncState: "dismissed", value: 12, outOf: 20, significant: true },
      ])
    ).toEqual({ managed: 2, missing: 1, dismissed: 1, nonNumeric: 1 })
  })

  test("keeps edited academic-year dates as inclusive school-local boundaries", () => {
    const start = academicYearBoundary("2026-09-01", "start")
    const end = academicYearBoundary("2027-08-31", "end")
    expect(start?.toISOString()).toBe("2026-08-31T22:00:00.000Z")
    expect(end?.toISOString()).toBe("2027-08-31T21:59:59.999Z")
    expect(academicYearDateValue(end!)).toBe("2027-08-31")
    expect(
      academicYearDateValue(
        new Date("2026-07-31T22:00:00.000Z"),
        "Europe/Paris"
      )
    ).toBe("2026-08-01")
    expect(
      academicYearBoundary("2026-08-01", "start", "Europe/Paris")?.toISOString()
    ).toBe("2026-07-31T22:00:00.000Z")
    expect(academicYearBoundary("31/08/2027", "end")).toBeNull()
  })
})
