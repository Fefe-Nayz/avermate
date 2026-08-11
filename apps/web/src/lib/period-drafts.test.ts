import { describe, expect, test } from "bun:test"
import {
  periodDraftProblems,
  periodDraftsFromTemplate,
} from "./period-drafts"

const trimesters = {
  id: "trimesters",
  periods: [
    { key: "one", from: 0, to: 1 / 3 },
    { key: "two", from: 1 / 3, to: 2 / 3 },
    { key: "three", from: 2 / 3, to: 1 },
  ],
}

describe("period drafts", () => {
  test("turns a relative template into exact, non-overlapping calendar days", () => {
    const drafts = periodDraftsFromTemplate({
      template: trimesters,
      startsAt: "2026-09-01",
      endsAt: "2027-07-15",
      names: ["Term 1", "Term 2", "Term 3"],
    })

    expect(drafts[0]?.startAt).toBe("2026-09-01")
    expect(drafts.at(-1)?.endAt).toBe("2027-07-15")
    expect(periodDraftProblems(drafts, {
      startsAt: "2026-09-01",
      endsAt: "2027-07-15",
    })).toEqual([])
    expect(new Date(drafts[1]!.startAt).getTime()).toBe(
      new Date(drafts[0]!.endAt).getTime() + 86_400_000
    )
  })

  test("reports overlap, inverted ranges, empty names and year overflow", () => {
    expect(
      periodDraftProblems(
        [
          {
            key: "one",
            name: "",
            startAt: "2026-08-31",
            endAt: "2026-10-01",
            isCumulative: false,
          },
          {
            key: "two",
            name: "Two",
            startAt: "2026-10-01",
            endAt: "2026-09-30",
            isCumulative: false,
          },
        ],
        { startsAt: "2026-09-01", endsAt: "2027-07-15" }
      ).sort()
    ).toEqual(["empty-name", "invalid-range", "outside-year", "overlap"])
  })

  test("preserves cumulative template semantics", () => {
    const drafts = periodDraftsFromTemplate({
      template: {
        id: "semesters-cumulative",
        periods: [
          { key: "one", from: 0, to: 0.5 },
          { key: "two", from: 0.5, to: 1, isCumulative: true },
        ],
      },
      startsAt: "2026-09-01",
      endsAt: "2027-07-15",
      names: ["Semester 1", "Whole year"],
    })

    expect(drafts.map((period) => period.isCumulative)).toEqual([false, true])
  })
})
