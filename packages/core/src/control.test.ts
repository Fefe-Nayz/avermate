import { describe, expect, test } from "bun:test";
import {
  controlBand,
  CONTROL_DEVIATIONS,
  CONTROL_MINIMUM_SAMPLE,
} from "./control";

/**
 * A control band's only job is saying which marks belong to the same pattern, so what has
 * to hold is the refusals and the edges: it must not draw limits it cannot support, must
 * not call an ordinary mark unusual, and must not call a mark unusual merely because the
 * band was cut off at full marks.
 */

/** A steady run, long enough to have limits. */
const steady = Array.from({ length: 12 }, (_, index) =>
  index % 2 === 0 ? 0.7 : 0.75,
);

describe("where ordinary results fall", () => {
  test("puts the level at the middle of the marks", () => {
    const band = controlBand(steady);

    expect(band?.center).toBeCloseTo(0.725, 10);
    expect(band?.sample).toBe(12);
    expect(band?.deviations).toBe(CONTROL_DEVIATIONS);
  });

  test("draws one point per mark, in order", () => {
    const band = controlBand(steady);

    expect(band?.points).toHaveLength(12);
    expect(band?.points.map((point) => point.step)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(band?.points[0]?.observed).toBe(0.7);
  });

  test("says nothing about a run it has too few marks for", () => {
    // Limits drawn from a handful of marks are drawn from noise, and a card that flags an
    // ordinary result as unusual is worse than one that says nothing.
    expect(controlBand(steady.slice(0, CONTROL_MINIMUM_SAMPLE - 1))).toBeNull();
    expect(controlBand(steady.slice(0, CONTROL_MINIMUM_SAMPLE))).not.toBeNull();
  });

  test("says nothing where every mark is the same", () => {
    // A band of no width would report every result as exactly ordinary and any repeat as
    // unusual — an artefact of dividing by nothing.
    expect(controlBand(Array.from({ length: 12 }, () => 0.7))).toBeNull();
  });

  test("finds the mark that does not belong to the pattern", () => {
    const band = controlBand([...steady, 0.1]);

    expect(band?.unusual).toHaveLength(1);
    // The last point, and identified by key rather than by position so a renderer cannot
    // mismatch it against a filtered list.
    expect(band?.unusual[0]).toBe(band?.points.at(-1)?.key);
  });

  test("treats a mark far above the level as unusual too", () => {
    // Outside is not the same as bad. A run of sevens and a sudden twenty is a change
    // worth remarking on, and a chart that only flagged the low side would be a chart
    // about disappointment rather than about variation.
    const band = controlBand([...Array.from({ length: 12 }, () => 0.35), 1]);

    expect(band?.unusual).toHaveLength(1);
  });

  test("calls nothing unusual in a run that has no outliers", () => {
    expect(controlBand(steady)?.unusual).toEqual([]);
  });

  test("clamps the limits to the scale without clamping the judgement", () => {
    /**
     * A high level and a wide spread put the upper limit past full marks. The drawn limit
     * is capped — nothing can exceed the top, and drawing an edge at 21/20 would put the
     * band somewhere no result can go — but whether a mark is *unusual* is still measured
     * against the uncapped limit, or every top mark in a spread-out run would be flagged.
     */
    // Tight at the top: the level is 0.985 and two deviations reach 1.012, so the upper
    // limit is capped and no mark sits outside either edge.
    const high = [
      0.96, 0.98, 1, 0.97, 0.99, 1, 0.98, 0.97, 1, 0.99, 0.98, 1,
    ];
    const band = controlBand(high);

    expect(band?.points[0]?.high).toBe(1);
    expect(band?.unusual).toEqual([]);
  });

  test("takes the width it is given", () => {
    const tight = controlBand(steady, 1);
    const wide = controlBand(steady, 3);

    expect(tight?.deviations).toBe(1);
    expect(tight?.points[0]?.low).toBeGreaterThan(
      wide?.points[0]?.low ?? Number.NEGATIVE_INFINITY,
    );
    // A narrower band flags more marks, which is what makes stating the width necessary.
    expect((tight?.unusual.length ?? 0) >= (wide?.unusual.length ?? 0)).toBe(
      true,
    );
  });

  test("ignores what is not a number", () => {
    const band = controlBand([...steady, Number.NaN]);

    expect(band?.sample).toBe(12);
  });

  test("never draws a band upside down", () => {
    const band = controlBand(steady);

    for (const point of band?.points ?? []) {
      expect(point.low).toBeLessThanOrEqual(point.center);
      expect(point.center).toBeLessThanOrEqual(point.high);
    }
  });
});
