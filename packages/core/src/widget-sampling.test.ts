import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "./graph";
import { evaluateWidgetDefinition } from "./widget-evaluator";
import { widgetDefinitionFromCard } from "./widget-defaults";
import { WIDGET_LIMITS } from "./widget-types";
import type { Grade, Subject, WidgetTransform } from "./index";

/**
 * A transform must never see a shortened series.
 *
 * `sampleEvenly` used to run inside the bucket walk, which put it *before* every
 * transform: a cumulative summed a sample of the buckets instead of all of them,
 * and a seven-point moving average averaged seven points that were no longer
 * seven consecutive days. Measured on 600 daily buckets before the fix: 500
 * points out, with gaps of one day and two. Those are wrong numbers, not a
 * coarse drawing — and no amount of chart polish makes a wrong total right.
 *
 * The property that holds now, and that these tests pin: **the value a transform
 * computes does not depend on the drawing budget**. Whether a series is under the
 * budget or three times over it, the arithmetic is the arithmetic.
 */

function seriesOf(days: number): SubjectGraph {
  const grades: Grade[] = Array.from({ length: days }, (_, index) => {
    const passedAt = new Date(2025, 0, 1 + index);
    return {
      id: `g${index}`,
      name: `g${index}`,
      value: 10,
      outOf: 20,
      coefficient: 1,
      passedAt,
      createdAt: passedAt,
      subjectId: "m",
      periodId: null,
      components: [],
    };
  });
  const subject: Subject = {
    id: "m",
    name: "M",
    shortName: null,
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: true,
    sortOrder: 0,
    grades,
  };
  return new SubjectGraph([subject]);
}

function dailySeries(days: number, transforms: WidgetTransform[]) {
  const graph = seriesOf(days);
  const definition = widgetDefinitionFromCard({
    metric: "gradeCount",
    targetKind: "general",
    targetId: null,
    goalId: null,
    display: "chart",
  });
  definition.analysis.groupBy = {
    kind: "time",
    interval: "day",
    accumulation: "none",
  };
  definition.analysis.transforms = transforms;

  const from = new Date(2025, 0, 1);
  const to = new Date(2029, 0, 1);
  const result = evaluateWidgetDefinition(definition, {
    graph,
    subjects: graph.subjects,
    yearSubjects: graph.subjects,
    scope: null,
    from,
    to,
    passingRatio: 0.5,
    goals: [],
    periods: [],
    customAverages: [],
    resolveTarget: () => ({
      graph,
      subjects: graph.subjects,
      scope: null,
      subjectId: null,
    }),
    year: { startsAt: from, endsAt: to, scale: 20 },
    now: to,
    surface: "insights",
  });
  if (result.kind !== "series")
    throw new Error(`expected a series, got ${result.kind}`);
  return result.values;
}

/** One grade a day, so bucket k reports k results to date. */
const bucketValue = (k: number) => k;
const triangular = (n: number) => (n * (n + 1)) / 2;

describe("the drawing budget does not change the arithmetic", () => {
  test("a cumulative sums every bucket, over the budget or under it", () => {
    for (const days of [120, WIDGET_LIMITS.resultPoints + 100, 900]) {
      const values = dailySeries(days, [{ kind: "cumulative" }]);
      // Closed form over *all* buckets. Under the old order this came out as the
      // sum over the sampled subset — 150250 instead of 180300 at 600 days.
      expect(values.at(-1)?.value, `${days} days`).toBe(triangular(days));
    }
  });

  test("a moving average takes consecutive buckets, over the budget or under it", () => {
    const points = 7;
    for (const days of [120, WIDGET_LIMITS.resultPoints + 100, 900]) {
      const values = dailySeries(days, [{ kind: "moving-average", points }]);
      // The mean of the last seven consecutive buckets: (n-6 … n) / 7 = n - 3.
      const expected =
        Array.from({ length: points }, (_, index) =>
          bucketValue(days - index),
        ).reduce((sum, value) => sum + value, 0) / points;
      expect(values.at(-1)?.value, `${days} days`).toBeCloseTo(expected, 9);
    }
  });

  test("the last point survives, because for a cumulative it is the answer", () => {
    const values = dailySeries(900, [{ kind: "cumulative" }]);
    expect(values.at(-1)?.value).toBe(triangular(900));
    expect(values[0]?.value).toBe(triangular(1));
  });
});

describe("the drawing budget still bounds what a renderer receives", () => {
  test("one series never exceeds it", () => {
    const values = dailySeries(900, []);
    expect(values.length).toBeLessThanOrEqual(WIDGET_LIMITS.resultPoints);
    expect(values.length).toBeGreaterThan(1);
  });

  test("a series under the budget is handed over whole", () => {
    const days = 120;
    const values = dailySeries(days, []);
    expect(values.length).toBe(days);
    // Every day present, so nothing here is a sample of anything.
    const gaps = values
      .slice(1)
      .map((item, index) =>
        Math.round(
          ((item.date as Date).getTime() -
            (values[index]?.date as Date).getTime()) /
            86_400_000,
        ),
      );
    expect([...new Set(gaps)]).toEqual([1]);
  });

  test("the bucket guard is far above anything a year can produce", () => {
    // Daily buckets across two school years is 730. The guard exists to stop a
    // pathological window walking forever, not to shape results — which is why
    // it is nowhere near the drawing budget any more.
    expect(WIDGET_LIMITS.seriesBuckets).toBeGreaterThan(730 * 2);
    expect(WIDGET_LIMITS.seriesBuckets).toBeGreaterThan(
      WIDGET_LIMITS.resultPoints,
    );
  });
});
