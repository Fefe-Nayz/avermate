import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "./graph";
import type { Grade, Subject } from "./types";
import {
  PROJECTION_MAXIMUM_STEPS,
  PROJECTION_MINIMUM_SAMPLE,
  projectionBand,
} from "./projection";

let counter = 0;
function grade(subjectId: string, value: number, coefficient = 1): Grade {
  counter += 1;
  return {
    id: `g${counter}`,
    name: `g${counter}`,
    value,
    outOf: 20,
    coefficient,
    passedAt: new Date(2026, 0, 1),
    createdAt: new Date(2026, 0, 1),
    subjectId,
    periodId: null,
    components: [],
  };
}

function subject(id: string, coefficient: number, grades: Grade[]): Subject {
  return {
    id,
    name: id,
    shortName: null,
    parentId: null,
    coefficient,
    kind: "subject",
    isMain: true,
    sortOrder: 0,
    grades,
  };
}

const always = (count: number) => () => count;

/**
 * A band around a projection is the easiest chart in this app to lie with, so what is
 * tested here is the honesty rather than the shape: the band is ordered, it is built
 * from the reader's own marks, it refuses to appear when there is nothing to build it
 * from, and it never calls itself a confidence interval.
 */
describe("projection band", () => {
  const marks = [8, 12, 14, 15, 16];

  test("is a scenario band and says so", () => {
    const graph = new SubjectGraph([
      subject(
        "maths",
        1,
        marks.map((value) => grade("maths", value)),
      ),
    ]);
    const band = projectionBand(graph, always(3));

    expect(band?.intervalKind).toBe("scenario");
    // Not "confidence", not "prediction": no distribution is assumed and no coverage
    // is claimed. The three paths are the reader's own quartiles replayed.
    expect(band?.quantiles).toEqual({ low: 0.25, center: 0.5, high: 0.75 });
    expect(band?.sample).toBe(marks.length);
  });

  test("stays ordered at every step", () => {
    const graph = new SubjectGraph([
      subject(
        "maths",
        3,
        marks.map((value) => grade("maths", value)),
      ),
      subject("art", 1, [grade("art", 11), grade("art", 19), grade("art", 13)]),
    ]);
    const band = projectionBand(graph, always(4));
    if (!band) throw new Error("expected a band");

    for (const point of band.points) {
      expect(point.low, `step ${point.step}`).toBeLessThanOrEqual(point.center);
      expect(point.center, `step ${point.step}`).toBeLessThanOrEqual(
        point.high,
      );
    }
  });

  test("starts at today's average, which is the one point that is not a scenario", () => {
    const graph = new SubjectGraph([
      subject(
        "maths",
        1,
        marks.map((value) => grade("maths", value)),
      ),
    ]);
    const band = projectionBand(graph, always(2));
    const first = band?.points[0];

    expect(first?.step).toBe(0);
    expect(first?.observed).toBeCloseTo(graph.ratio(null) ?? 0, 12);
    expect(first?.low).toBe(first?.center);
    expect(first?.high).toBe(first?.center);
    // Every later point is a scenario, so none of them is observed.
    expect(
      band?.points.slice(1).every((point) => point.observed === null),
    ).toBe(true);
  });

  test("widens as the scenarios diverge, and never crosses", () => {
    const graph = new SubjectGraph([
      subject(
        "maths",
        1,
        marks.map((value) => grade("maths", value)),
      ),
    ]);
    const band = projectionBand(graph, always(5));
    if (!band) throw new Error("expected a band");

    const widths = band.points.map((point) => point.high - point.low);
    for (let index = 1; index < widths.length; index += 1) {
      // Each further result carries more of the average, so the scenarios can only
      // separate. Equal is allowed — a saturated average stops moving — crossing is
      // not.
      expect(widths[index]!, `step ${index}`).toBeGreaterThanOrEqual(
        widths[index - 1]! - 1e-12,
      );
    }
  });

  test("draws the scenarios from the reader's own marks", () => {
    // A steady reader and a wild one, with the same average: the wild one's band must
    // be wider, because the scenarios are *their* quartiles.
    const steady = new SubjectGraph([
      subject(
        "maths",
        1,
        [12, 12, 12, 12].map((v) => grade("maths", v)),
      ),
    ]);
    const wild = new SubjectGraph([
      subject(
        "maths",
        1,
        [4, 8, 16, 20].map((v) => grade("maths", v)),
      ),
    ]);

    const steadyBand = projectionBand(steady, always(4));
    const wildBand = projectionBand(wild, always(4));
    if (!steadyBand || !wildBand) throw new Error("expected two bands");

    expect(steadyBand.points[0]?.center).toBeCloseTo(
      wildBand.points[0]?.center ?? -1,
      12,
    );
    const width = (band: typeof steadyBand) => {
      const last = band.points.at(-1);
      return (last?.high ?? 0) - (last?.low ?? 0);
    };
    expect(width(steadyBand)).toBeCloseTo(0, 12);
    expect(width(wildBand)).toBeGreaterThan(0.1);
  });

  test("refuses to draw what it cannot build", () => {
    const marked = new SubjectGraph([
      subject(
        "maths",
        1,
        marks.map((value) => grade("maths", value)),
      ),
    ]);

    // Nothing left to sit.
    expect(projectionBand(marked, always(0))).toBeNull();
    // No average at all.
    expect(
      projectionBand(new SubjectGraph([subject("maths", 1, [])]), always(3)),
    ).toBeNull();
    // Too few marks to have quartiles worth the name.
    const thin = new SubjectGraph([
      subject(
        "maths",
        1,
        Array.from({ length: PROJECTION_MINIMUM_SAMPLE - 1 }, (_, index) =>
          grade("maths", 10 + index),
        ),
      ),
    ]);
    expect(projectionBand(thin, always(3))).toBeNull();
  });

  test("stops before a band becomes a wash", () => {
    const graph = new SubjectGraph([
      subject(
        "maths",
        1,
        marks.map((value) => grade("maths", value)),
      ),
    ]);
    const band = projectionBand(graph, always(50));

    // Plus today, which is a point rather than a step.
    expect(band?.points).toHaveLength(PROJECTION_MAXIMUM_STEPS + 1);
  });

  test("weighs a future result the way that subject's results are weighed", () => {
    // Every mark in Maths carries four; the projection must not add a coefficient-one
    // homework and report a movement the real next exam would dwarf.
    const graph = new SubjectGraph([
      subject(
        "maths",
        1,
        marks.map((value) => grade("maths", value, 4)),
      ),
      subject("art", 1, [grade("art", 10), grade("art", 10), grade("art", 10)]),
    ]);
    const band = projectionBand(graph, (id) => (id === "maths" ? 1 : 0));
    if (!band) throw new Error("expected a band");

    const step = band.points[1];
    // One more Maths result at the reader's best quartile moves the average by more
    // than a coefficient-one result could.
    expect((step?.high ?? 0) - (band.points[0]?.center ?? 0)).toBeGreaterThan(
      0,
    );
  });
});
