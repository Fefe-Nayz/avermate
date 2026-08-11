import { describe, expect, test } from "bun:test"
import { yearReviewWindowKey } from "./year-review-window"

const atNoon = (isoDay: string) => new Date(`${isoDay}T12:00:00.000Z`)

describe("yearReviewWindowKey", () => {
  const schoolStart = atNoon("2025-09-01")
  const schoolEnd = atNoon("2026-06-30")

  test("opens thirty days before a school year ends", () => {
    expect(
      yearReviewWindowKey(atNoon("2026-05-31"), schoolStart, schoolEnd)
    ).toBe("school-2026")
  })

  test("stays open for fourteen days after the end", () => {
    expect(
      yearReviewWindowKey(atNoon("2026-07-14"), schoolStart, schoolEnd)
    ).toBe("school-2026")
    expect(
      yearReviewWindowKey(atNoon("2026-07-15"), schoolStart, schoolEnd)
    ).toBeNull()
  })

  test("offers a separate calendar recap in December", () => {
    expect(
      yearReviewWindowKey(atNoon("2025-12-12"), schoolStart, schoolEnd)
    ).toBe("calendar-2025")
  })

  test("does not announce a recap outside either window", () => {
    expect(
      yearReviewWindowKey(atNoon("2026-02-01"), schoolStart, schoolEnd)
    ).toBeNull()
  })

  test("rejects an invalid year range", () => {
    expect(
      yearReviewWindowKey(atNoon("2026-01-01"), schoolEnd, schoolStart)
    ).toBeNull()
  })
})
