import { describe, expect, test } from "bun:test";
import {
  linearFit,
  regressionInterval,
  REGRESSION_QUALITY_SAMPLE,
  tValue,
} from "./regression";

/**
 * A fitted line is the easiest thing in this package to draw wrongly and have nobody
 * notice: every wrong slope still looks like a trend. So the numbers here are ones whose
 * answers are known in advance rather than recorded from a first run.
 */
describe("linear fit", () => {
  test("recovers a line it was given exactly", () => {
    // y = 2x + 1, four points, no scatter.
    const fit = linearFit([
      { x: 0, y: 1 },
      { x: 1, y: 3 },
      { x: 2, y: 5 },
      { x: 3, y: 7 },
    ]);

    expect(fit?.slope).toBeCloseTo(2, 12);
    expect(fit?.intercept).toBeCloseTo(1, 12);
    expect(fit?.r2).toBeCloseTo(1, 12);
    expect(fit?.residualError).toBeCloseTo(0, 12);
  });

  test("finds the least-squares line through scatter", () => {
    // (1,1) (2,3) (3,2) (4,3): Sxx = 5 and Sxy = 2.5, so the slope is a half and the line
    // passes through the means, (2.5, 2.25).
    const fit = linearFit([
      { x: 1, y: 1 },
      { x: 2, y: 3 },
      { x: 3, y: 2 },
      { x: 4, y: 3 },
    ]);

    expect(fit?.slope).toBeCloseTo(0.5, 12);
    expect(fit?.intercept).toBeCloseTo(2.25 - 0.5 * 2.5, 12);
    // Residuals −0.5, 1, −0.5, 0 against a total variation of 2.75.
    expect(fit?.r2).toBeCloseTo(1 - 1.5 / 2.75, 12);
  });

  test("withholds a quality it cannot measure", () => {
    // Two points: the line is exact by construction, so an R² of 1 would say the results
    // agree with a trend when what happened is that a line was drawn through both of them.
    const fit = linearFit([
      { x: 0, y: 0.4 },
      { x: 1, y: 0.9 },
    ]);

    expect(fit?.slope).toBeCloseTo(0.5, 12);
    expect(fit?.r2).toBeNull();
    expect(fit?.residualError).toBeNull();
    expect(fit?.sample).toBeLessThan(REGRESSION_QUALITY_SAMPLE);
  });

  test("withholds a quality where there is no variation to explain", () => {
    // Three identical results: the fit is flat and perfect, and "explains 100% of the
    // variation" would be a sentence about nothing.
    const fit = linearFit([
      { x: 0, y: 0.7 },
      { x: 1, y: 0.7 },
      { x: 2, y: 0.7 },
    ]);

    expect(fit?.slope).toBeCloseTo(0, 12);
    expect(fit?.r2).toBeNull();
  });

  test("declines what is not a line", () => {
    expect(linearFit([{ x: 1, y: 1 }])).toBeNull();
    expect(linearFit([])).toBeNull();
    // Every result on the same day: vertical, and not a function of x.
    expect(
      linearFit([
        { x: 5, y: 0.2 },
        { x: 5, y: 0.9 },
      ]),
    ).toBeNull();
  });

  test("ignores a hole rather than treating it as a zero", () => {
    const withHole = linearFit([
      { x: 0, y: 1 },
      { x: 1, y: Number.NaN },
      { x: 2, y: 5 },
    ]);
    const without = linearFit([
      { x: 0, y: 1 },
      { x: 2, y: 5 },
    ]);

    expect(withHole?.slope).toBeCloseTo(without?.slope ?? 0, 12);
    expect(withHole?.sample).toBe(2);
  });
});

describe("the band around a fit", () => {
  const points = [
    { x: 0, y: 0.5 },
    { x: 1, y: 0.55 },
    { x: 2, y: 0.52 },
    { x: 3, y: 0.62 },
    { x: 4, y: 0.6 },
  ];

  test("is narrowest at the centre of the data and widest at its ends", () => {
    const fit = linearFit(points);
    const band = regressionInterval(fit!, [0, 2, 4]);
    const width = (index: number) =>
      (band?.[index]?.high ?? 0) - (band?.[index]?.low ?? 0);

    // The line pivots about the middle, so that is where it is best pinned down. This
    // shape is the whole argument against reading a fitted line past its last point.
    expect(width(1)).toBeLessThan(width(0));
    expect(width(1)).toBeLessThan(width(2));
    expect(width(0)).toBeCloseTo(width(2), 10);
  });

  test("keeps the fitted line at its centre", () => {
    const fit = linearFit(points)!;
    const band = regressionInterval(fit, [1.5])!;

    expect(band[0]?.center).toBeCloseTo(fit.intercept + fit.slope * 1.5, 12);
  });

  test("widens as the results scatter", () => {
    const tight = linearFit([
      { x: 0, y: 0.5 },
      { x: 1, y: 0.6 },
      { x: 2, y: 0.7 },
      { x: 3, y: 0.8 },
    ])!;
    const loose = linearFit([
      { x: 0, y: 0.2 },
      { x: 1, y: 0.9 },
      { x: 2, y: 0.3 },
      { x: 3, y: 0.95 },
    ])!;
    const widthOf = (fit: typeof tight) => {
      const band = regressionInterval(fit, [0])!;
      return band[0]!.high - band[0]!.low;
    };

    expect(widthOf(loose)).toBeGreaterThan(widthOf(tight));
  });

  test("refuses a band it has no degrees of freedom for", () => {
    const fit = linearFit([
      { x: 0, y: 0.4 },
      { x: 1, y: 0.9 },
    ])!;

    expect(regressionInterval(fit, [0, 1])).toBeNull();
  });
});

describe("the t multiplier", () => {
  test("follows the table for small samples", () => {
    // Where it matters most: a fit of four results has two degrees of freedom, and using
    // the normal 1.96 there would understate the band by nearly half.
    expect(tValue(1)).toBeCloseTo(12.706, 3);
    expect(tValue(2)).toBeCloseTo(4.303, 3);
    expect(tValue(10)).toBeCloseTo(2.228, 3);
  });

  test("settles towards the normal for large ones", () => {
    expect(tValue(30)).toBeCloseTo(2.042, 3);
    expect(tValue(200)).toBeCloseTo(1.96, 3);
    expect(tValue(0)).toBeNaN();
  });

  test("never widens as the sample grows", () => {
    const values = Array.from({ length: 150 }, (_, index) => tValue(index + 1));

    for (let index = 1; index < values.length; index += 1) {
      expect(values[index]!).toBeLessThanOrEqual(values[index - 1]!);
    }
  });
});
