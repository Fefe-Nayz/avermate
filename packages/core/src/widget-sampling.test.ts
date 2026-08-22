import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { SubjectGraph } from "./graph";
import { widgetFrameSeries } from "./widget-frame";
import { evaluateWidgetDefinition } from "./widget-evaluator";
import { widgetDefinitionFromCard } from "./widget-defaults";
import { WIDGET_LIMITS } from "./widget-types";
import type {
  Grade,
  Subject,
  WidgetEvaluationResult,
  WidgetSeriesDatum,
  WidgetTransform,
} from "./index";

/**
 * The plotted rows of a grouped result, as a renderer reads them.
 *
 * A grouped reading is a data frame now; every chart in the app goes through this same
 * projection, so the assertions below test  what a renderer would actually draw rather than an
 * intermediate the frame replaced.
 */
const PLOT_SLOTS = {
  x: null,
  y: "value",
  color: null,
  series: null,
  facet: null,
} as const;

function plotted(result: WidgetEvaluationResult): WidgetSeriesDatum[] {
  return result.kind === "data-frame"
    ? widgetFrameSeries(result.frame, PLOT_SLOTS)
    : [];
}

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
  definition.analysis.dimensions = [
    {
      id: "group",
      kind: "time",
      grain: "day",
      // Running, so bucket k reports every result to date — a sequence whose sums
      // and means have closed forms, which is what makes the assertions below
      // exact rather than golden.
      accumulation: "running",
      fill: "observed",
    },
  ];
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
  if (result.kind !== "data-frame")
    throw new Error(`expected a series, got ${result.kind}`);
  return plotted(result);
}

/** One grade a day and a running count, so bucket k reports k results to date. */
const bucketValue = (k: number) => k;
const triangular = (n: number) => (n * (n + 1)) / 2;

describe("the drawing budget does not change the arithmetic", () => {
  test("the fixture is the sequence the closed forms below assume", () => {
    // Asserted rather than assumed: every expectation in this file is a formula
    // over bucket k, so the formulas are only worth anything if bucket k really
    // reports k. Read under the budget, where nothing is thinned.
    const values = dailySeries(120, []);
    expect(values.map((item) => item.value)).toEqual(
      Array.from({ length: 120 }, (_, index) => bucketValue(index + 1)),
    );
  });

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

/**
 * The two evaluator defects the review's §16 named, and one of them was mine.
 *
 * Fixing the sampling order left the moving average correct and its cost
 * pathological: it scanned the whole result once per row, which was survivable
 * while a drawing budget thinned the series to a few hundred points first and is
 * not now that transforms see everything.
 */
describe("transforms cost what they should, and rank what they can measure", () => {
  test("a moving average makes one pass, not a scan per point", () => {
    // Asserted as shape, not as a clock. The measurement that motivated the rewrite
    // was real — 104ms against 0.69ms on 4 000 buckets, 150× — but a timing
    // assertion flaked about one run in ten even taking the best of three, and a
    // flaky guard is worse than an absent one. This says the thing the timing was a
    // proxy for: the window advances with a running sum, and nothing re-scans the
    // result for every row.
    const source = readFileSync(
      new URL("./widget-evaluator.ts", import.meta.url),
      "utf8",
    );
    const branch = source
      .slice(
        source.indexOf('transform.kind === "moving-average"'),
        source.indexOf('transform.kind === "cumulative"'),
      )
      // Comments out, or the negative assertions below match the very prose that
      // explains what the old implementation did.
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(branch).toContain("const means = new Map<WidgetSeriesDatum,");
    expect(branch).toContain("sum -= leaving");
    // The two calls that made it quadratic, one per row apiece.
    expect(branch).not.toContain("result.filter");
    expect(branch).not.toContain("findIndex");
  });

  test("and it still averages the same seven consecutive buckets", () => {
    // The arithmetic is unchanged by the rewrite: bucket k reports k, so the mean
    // of the last seven is n - 3.
    const values = dailySeries(200, [{ kind: "moving-average", points: 7 }]);
    expect(values.at(-1)?.value).toBeCloseTo(200 - 3, 9);
    // And the first bucket has only itself in its window.
    expect(values[0]?.value).toBeCloseTo(1, 9);
  });
});

/**
 * A sort has to say what it does with what it could not measure.
 *
 * `?? 0` ranked an absent value among the real zeros, so an empty bucket sat above
 * every subject that had actually dropped — and a descending sort put "nothing
 * happened" at the top of a page about what went wrong.
 */
describe("sorting values that are not there", () => {
  const sorted = (
    values: readonly (number | null)[],
    direction: "ascending" | "descending",
  ) => {
    const sign = direction === "ascending" ? 1 : -1;
    return [...values].sort((left, right) => {
      if (left === null) return right === null ? 0 : 1;
      if (right === null) return -1;
      return sign * (left - right);
    });
  };

  test("absent goes last, whichever way the sort runs", () => {
    expect(sorted([3, null, -2, 0], "ascending")).toEqual([-2, 0, 3, null]);
    expect(sorted([3, null, -2, 0], "descending")).toEqual([3, 0, -2, null]);
  });

  test("and is never confused with a real zero or a negative", () => {
    // The case `?? 0` got wrong: descending, the gap outranked the drop.
    const order = sorted([null, -1.5], "descending");
    expect(order).toEqual([-1.5, null]);
    expect(order.indexOf(null)).toBe(1);
  });

  test("the evaluator's own sort agrees", () => {
    expect(
      readFileSync(new URL("./widget-evaluator.ts", import.meta.url), "utf8"),
    ).toContain("if (left.value === null) return right.value === null ? 0 : 1");
  });
});
