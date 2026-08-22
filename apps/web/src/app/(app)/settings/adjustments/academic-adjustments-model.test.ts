import { describe, expect, test } from "bun:test"
import type { Period, Subject, Year } from "@avermate/core"
import {
  buildPeriodAdjustmentGraph,
  parseAdjustmentPoints,
  periodAdjustmentBaseRatio,
} from "./academic-adjustments-model"

const year: Year = {
  id: "year",
  name: "2026–2027",
  startsAt: new Date("2026-09-01T00:00:00.000Z"),
  endsAt: new Date("2027-07-01T00:00:00.000Z"),
  scale: 20,
  defaultOutOf: 20,
  passingRatio: 0.5,
  decimals: 2,
}

const autumn: Period = {
  id: "autumn",
  name: "Autumn",
  startAt: new Date("2026-09-01T00:00:00.000Z"),
  endAt: new Date("2026-12-31T23:59:59.000Z"),
  isCumulative: false,
  generalBonus: 1,
  sortOrder: 0,
}

const spring: Period = {
  ...autumn,
  id: "spring",
  name: "Spring",
  startAt: new Date("2027-01-01T00:00:00.000Z"),
  endAt: new Date("2027-07-01T00:00:00.000Z"),
  generalBonus: -1,
  sortOrder: 1,
}

const subjects: Subject[] = [
  {
    id: "maths",
    name: "Mathematics",
    shortName: "Maths",
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: true,
    sortOrder: 0,
    bonus: 9,
    periodBonuses: { autumn: 2, spring: -2 },
    grades: [
      {
        id: "autumn-grade",
        name: "Autumn test",
        value: 10,
        outOf: 20,
        coefficient: 1,
        passedAt: new Date("2026-10-01T00:00:00.000Z"),
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
        subjectId: "maths",
        periodId: "autumn",
        components: [],
      },
      {
        id: "spring-grade",
        name: "Spring test",
        value: 18,
        outOf: 20,
        coefficient: 1,
        passedAt: new Date("2027-03-01T00:00:00.000Z"),
        createdAt: new Date("2027-03-01T00:00:00.000Z"),
        subjectId: "maths",
        periodId: "spring",
        components: [],
      },
    ],
  },
]

describe("academic adjustment editor model", () => {
  test("uses the selected period's grades and adjustments, not the active one", () => {
    const autumnGraph = buildPeriodAdjustmentGraph({
      customAverages: [],
      period: autumn,
      subjects,
      year,
    })
    const springGraph = buildPeriodAdjustmentGraph({
      customAverages: [],
      period: spring,
      subjects,
      year,
    })

    expect(autumnGraph.ratio("maths")).toBeCloseTo(0.6)
    expect(autumnGraph.ratio(null)).toBeCloseTo(0.65)
    expect(springGraph.ratio("maths")).toBeCloseTo(0.8)
    expect(springGraph.ratio(null)).toBeCloseTo(0.75)
  })

  test("parses localized points", () => {
    expect(parseAdjustmentPoints("+0,5")).toBe(0.5)
    expect(parseAdjustmentPoints("not a number")).toBe(0)
  })

  test("keeps the saved base stable while previewing unsaved points", () => {
    const draft = buildPeriodAdjustmentGraph({
      adjustments: {
        generalPoints: 3,
        subjectPoints: { maths: 4 },
      },
      customAverages: [],
      period: autumn,
      subjects,
      year,
    })

    expect(
      periodAdjustmentBaseRatio({
        customAverages: [],
        period: autumn,
        subjectId: "maths",
        subjects,
        year,
      })
    ).toBeCloseTo(0.5)
    expect(
      periodAdjustmentBaseRatio({
        customAverages: [],
        period: autumn,
        subjectId: null,
        subjects,
        year,
      })
    ).toBeCloseTo(0.6)
    expect(draft.ratio("maths")).toBeCloseTo(0.7)
    expect(draft.ratio(null)).toBeCloseTo(0.85)
  })

  test("recovers the exact base even when a saved bonus is clamped", () => {
    const nearCeiling: Subject[] = [
      {
        ...subjects[0]!,
        periodBonuses: { autumn: 2 },
        grades: [
          {
            ...subjects[0]!.grades[0]!,
            value: 19.5,
          },
        ],
      },
    ]
    const saved = buildPeriodAdjustmentGraph({
      customAverages: [],
      period: { ...autumn, generalBonus: 2 },
      subjects: nearCeiling,
      year,
    })
    expect(saved.ratio("maths")).toBe(1)
    expect(saved.ratio(null)).toBe(1)
    expect(
      periodAdjustmentBaseRatio({
        customAverages: [],
        period: { ...autumn, generalBonus: 2 },
        subjectId: "maths",
        subjects: nearCeiling,
        year,
      })
    ).toBeCloseTo(0.975)
    expect(
      periodAdjustmentBaseRatio({
        customAverages: [],
        period: { ...autumn, generalBonus: 2 },
        subjectId: null,
        subjects: nearCeiling,
        year,
      })
    ).toBe(1)
  })
})
