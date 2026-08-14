import { describe, expect, test } from "bun:test"
import {
  widgetEvaluationTime,
  widgetTimelineCutoff,
} from "./widget-evaluation-time"

describe("widget evaluation time", () => {
  test("uses the selected calendar day as rolling-window now", () => {
    const liveNow = new Date(2026, 7, 14, 10).getTime()
    const result = widgetEvaluationTime(
      "2026-03-10",
      liveNow,
      new Date(2025, 8, 1),
      new Date(2026, 0, 31, 23, 59, 59, 999)
    )

    expect(result.to).toEqual(new Date(2026, 0, 31, 23, 59, 59, 999))
    expect(result.now).toEqual(new Date(2026, 2, 10, 23, 59, 59, 999))
  })

  test("bounds a whole-year query at the selected timeline day", () => {
    const liveNow = new Date(2026, 7, 14, 10).getTime()
    const result = widgetEvaluationTime(
      "2026-03-10",
      liveNow,
      new Date(2025, 8, 1),
      new Date(2026, 7, 31, 23, 59, 59, 999)
    )

    expect(result.to).toEqual(new Date(2026, 2, 10, 23, 59, 59, 999))
    expect(result.now).toEqual(result.to)
  })

  test("falls back to the request-stable clock for an invalid day", () => {
    const liveNow = new Date(2026, 7, 14, 10).getTime()
    expect(widgetTimelineCutoff("2026-02-31", liveNow)).toBe(liveNow)
    expect(widgetTimelineCutoff(null, liveNow)).toBe(liveNow)
  })
})
