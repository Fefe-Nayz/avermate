import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import {
  averageEventDates,
  averageOverTime,
  DENSITY_MINIMUM_SAMPLE,
  kernelDensity,
  dispersionMinimum,
  dispersionOf,
  interquartileRange,
  medianAbsoluteDeviation,
  quantile,
  range,
  segmentedTrendLine,
  standardDeviation,
  WIDGET_DISPERSIONS,
  type SeriesPoint,
} from "./analytics";
import { SubjectGraph } from "./graph";
import type { Subject } from "./types";

const DAY = 86_400_000;

function points(values: Array<number | null>, gaps?: number[]): SeriesPoint[] {
  let timestamp = Date.UTC(2026, 0, 1);
  return values.map((ratio, index) => {
    if (index > 0) timestamp += (gaps?.[index - 1] ?? 1) * DAY;
    return { date: new Date(timestamp), ratio };
  });
}

describe("segmented trend line", () => {
  it("fits against real irregular timestamps rather than array positions", () => {
    const source = points([0, null, 1], [5, 5]);
    const trend = segmentedTrendLine(source);
    assert.equal(trend.length, 3);
    assert.equal(trend[0]?.ratio, 0);
    assert.equal(trend[1]?.ratio, 0.5);
    assert.equal(trend[2]?.ratio, 1);
  });

  it("uses subdivisions to preserve local changes in direction", () => {
    const trend = segmentedTrendLine(points([0.2, 0.4, 0.8, 0.6]), 2);
    assert.ok((trend[1]?.ratio ?? 0) > (trend[0]?.ratio ?? 0));
    assert.ok((trend[3]?.ratio ?? 0) < (trend[2]?.ratio ?? 0));
  });

  it("keeps the line inside the first and last observation", () => {
    const trend = segmentedTrendLine(points([null, 0.3, 0.5, null]), 1);
    assert.equal(trend[0]?.ratio, null);
    assert.notEqual(trend[1]?.ratio, null);
    assert.notEqual(trend[2]?.ratio, null);
    assert.equal(trend[3]?.ratio, null);
  });

  it("returns no fitted line with fewer than two readings", () => {
    assert.deepEqual(segmentedTrendLine(points([null, 0.4, null]), 4), []);
  });
});

describe("average event dates", () => {
  let counter = 0;
  const grade = (subjectId: string, passedAt: Date) => {
    counter += 1;
    return {
      id: `g${counter}`,
      name: `grade ${counter}`,
      value: 12,
      outOf: 20,
      coefficient: 1,
      passedAt,
      createdAt: passedAt,
      subjectId,
      periodId: null,
      components: [],
    };
  };
  const subject = (id: string, parentId: string | null, dates: Date[]) => ({
    id,
    name: id,
    shortName: null,
    parentId,
    coefficient: 1,
    kind: "subject" as const,
    isMain: false,
    sortOrder: 0,
    grades: dates.map((at) => grade(id, at)),
  });

  const from = new Date("2026-01-01T00:00:00");
  const to = new Date("2026-03-01T12:00:00");

  it("puts one event per graded day, none in between, plus both ends", () => {
    const subjects = [
      subject("maths", null, [
        new Date("2026-01-10T09:00:00"),
        new Date("2026-01-10T15:00:00"), // same day: one event
        new Date("2026-02-02T08:00:00"),
      ]),
    ];
    const dates = averageEventDates(subjects, from, to);
    assert.equal(dates.length, 4); // start, two graded days, end
    assert.equal(dates[0]?.getTime(), from.getTime());
    assert.equal(dates[dates.length - 1]?.getTime(), to.getTime());
    // The event sits at the end of its day so both grades count into it.
    assert.equal(dates[1]?.getHours(), 23);
    assert.equal(dates[1]?.getDate(), 10);
    assert.equal(dates[2]?.getDate(), 2);
  });

  it("clamps grades outside the window onto its edges", () => {
    const subjects = [
      subject("maths", null, [
        new Date("2025-12-01"), // before: clamped to start
        new Date("2026-04-01"), // after: clamped to end
      ]),
    ];
    const dates = averageEventDates(subjects, from, to);
    assert.equal(dates.length, 2);
    assert.equal(dates[0]?.getTime(), from.getTime());
    assert.equal(dates[1]?.getTime(), to.getTime());
  });

  it("scopes events to the target's own subtree", () => {
    const subjects = [
      subject("sciences", null, []),
      subject("maths", "sciences", [new Date("2026-01-20T10:00:00")]),
      subject("anglais", null, [new Date("2026-02-15T10:00:00")]),
    ];
    // Maths only moves on its own grade day…
    const maths = averageEventDates(subjects, from, to, "maths");
    assert.equal(maths.length, 3);
    assert.equal(maths[1]?.getDate(), 20);
    // …the parent inherits it, and everything moves for the general average.
    assert.equal(averageEventDates(subjects, from, to, "sciences").length, 3);
    assert.equal(averageEventDates(subjects, from, to).length, 4);
  });
});

describe("average over time", () => {
  it("keeps the period general bonus in every historical snapshot", () => {
    const at = new Date("2026-01-10T12:00:00");
    const subjects: Subject[] = [
      {
        id: "maths",
        name: "Maths",
        shortName: null,
        parentId: null,
        coefficient: 1,
        kind: "subject",
        isMain: false,
        sortOrder: 0,
        grades: [
          {
            id: "grade",
            name: "Grade",
            value: 10,
            outOf: 20,
            coefficient: 1,
            passedAt: at,
            createdAt: at,
            subjectId: "maths",
            periodId: "period",
            components: [],
          },
        ],
      },
    ];
    const graph = new SubjectGraph(subjects, {
      scale: 20,
      generalBonus: 2,
    });

    assert.equal(graph.ratio(null), 0.6);
    assert.deepEqual(
      averageOverTime(graph.subjects, [at], null, null, graph.options),
      [{ date: at, ratio: 0.6 }],
    );
  });
});

/**
 * The dispersion estimators a spread card may choose between.
 *
 * The point of offering four is that they disagree, and each disagreement is a
 * real answer to a slightly different question: a term of fourteens with one 2/20
 * *is* volatile by its range and steady by its middle half. What must not vary is
 * the arithmetic, so every case here is a hand-computed number rather than a
 * comparison between two of the estimators.
 */
describe("dispersion estimators", () => {
  const steady = [0.7, 0.72, 0.68, 0.71, 0.69, 0.7];
  // The same marks, plus one disaster.
  const outlier = [...steady, 0.1];

  it("interpolates a quantile between the two nearest ranks", () => {
    // Four values: the median sits between the middle two, and the quartiles
    // land exactly on the first and third.
    assert.equal(quantile([0, 1, 2, 3], 0.5), 1.5);
    assert.equal(quantile([0, 1, 2, 3], 0.25), 0.75);
    assert.equal(quantile([0, 1, 2, 3], 0.75), 2.25);
    // Ends are clamped, not extrapolated.
    assert.equal(quantile([4, 8], 0), 4);
    assert.equal(quantile([4, 8], 1), 8);
    assert.equal(quantile([], 0.5), null);
    assert.equal(quantile([9], 0.3), 9);
  });

  it("gives the full span to the range", () => {
    assert.ok(Math.abs((range([0.2, 0.9, 0.5]) as number) - 0.7) < 1e-12);
    assert.equal(range([0.5]), null);
  });

  it("measures the middle half without the tails", () => {
    // q1 = 0.25, q3 = 0.75 on 0..1 in five steps.
    assert.equal(interquartileRange([0, 0.25, 0.5, 0.75, 1]), 0.5);
    // Four is the minimum: three marks have no middle half.
    assert.equal(interquartileRange([0.4, 0.5, 0.6]), null);
  });

  it("scales the median absolute deviation to a standard deviation", () => {
    // Deviations from the median 0.5 are 0.2, 0.1, 0, 0.1, 0.2 — median 0.1.
    const value = medianAbsoluteDeviation([0.3, 0.4, 0.5, 0.6, 0.7]);
    assert.ok(value !== null && Math.abs(value - 0.14826) < 1e-9);
    assert.equal(medianAbsoluteDeviation([0.4, 0.6]), null);
  });

  it("is what makes one bad paper a catastrophe or a footnote", () => {
    const deviation = dispersionOf(outlier, "standard-deviation") as number;
    const middle = dispersionOf(outlier, "interquartile-range") as number;
    const steadyDeviation = dispersionOf(
      steady,
      "standard-deviation",
    ) as number;

    // The disaster more than triples the deviation…
    assert.ok(deviation > steadyDeviation * 3);
    // …and leaves the middle half where it was, within a hundredth.
    assert.ok(middle < 0.05);
  });

  it("refuses to answer below its own minimum, and says where that is", () => {
    for (const estimator of WIDGET_DISPERSIONS) {
      const minimum = dispersionMinimum(estimator);
      const short = Array.from(
        { length: minimum - 1 },
        (_, index) => index / 10,
      );
      const enough = Array.from({ length: minimum }, (_, index) => index / 10);
      assert.equal(dispersionOf(short, estimator), null, estimator);
      assert.notEqual(dispersionOf(enough, estimator), null, estimator);
    }
  });

  it("defaults to the deviation, which is what every stored card measured", () => {
    assert.equal(
      dispersionOf(steady, "standard-deviation"),
      standardDeviation(steady),
    );
  });
});

/**
 * The shape behind a violin. What is tested is the honesty rather than the smoothness: a
 * density over four marks is an interpolation dressed as knowledge, a density that leaks
 * past full marks draws a subject scoring twenty-two out of twenty, and a set of identical
 * marks must give a narrow shape rather than an infinite spike.
 */
describe("kernel density", () => {
  const marks = [0.4, 0.55, 0.6, 0.62, 0.65, 0.7, 0.72, 0.8];

  it("refuses a sample too small to have a shape", () => {
    for (let count = 0; count < DENSITY_MINIMUM_SAMPLE; count += 1) {
      const values = marks.slice(0, count);
      assert.equal(kernelDensity(values), null, `${count} marks`);
    }
    assert.notEqual(
      kernelDensity(marks.slice(0, DENSITY_MINIMUM_SAMPLE)),
      null,
    );
  });

  it("stays inside the scale", () => {
    const points = kernelDensity([0.02, 0.03, 0.05, 0.95, 0.97, 0.99]);
    assert.ok(points !== null);
    for (const point of points) {
      assert.ok(point.at >= 0 && point.at <= 1, `${point.at} outside 0..1`);
      assert.ok(Number.isFinite(point.density));
    }
  });

  it("puts its mass where the marks are", () => {
    const points = kernelDensity(marks);
    assert.ok(points !== null);
    const peak = points.reduce((best, point) =>
      point.density > best.density ? point : best,
    );
    // The marks cluster in the low sixties out of twenty; the peak belongs there rather
    // than at either end.
    assert.ok(peak.at > 0.5 && peak.at < 0.8, `peak at ${peak.at}`);
  });

  it("widens with the spread rather than with the count", () => {
    const tight = kernelDensity([0.6, 0.6, 0.61, 0.6, 0.59, 0.6]);
    const wide = kernelDensity([0.2, 0.4, 0.6, 0.8, 0.95, 0.05]);
    assert.ok(tight !== null && wide !== null);
    const width = (points: NonNullable<typeof tight>) => {
      const peak = Math.max(...points.map((point) => point.density));
      // How much of the curve carries at least a tenth of the peak: a tight set is a narrow
      // band, a scattered one covers the scale.
      return points.filter((point) => point.density > peak * 0.1).length;
    };
    assert.ok(width(tight) < width(wide));
  });

  it("gives near-identical marks a shape rather than a spike", () => {
    const points = kernelDensity([0.6, 0.6, 0.6, 0.6, 0.6, 0.6]);
    assert.ok(points !== null);
    const peak = Math.max(...points.map((point) => point.density));
    // With no floor on the bandwidth this diverges; the floor is half a point of the scale.
    assert.ok(Number.isFinite(peak) && peak < 100, `peak ${peak}`);
  });
});
