/**
 * A straight line through the results, and how much of them it actually explains.
 *
 * The app already had a slope — `trend`, which answers "up or down, how fast" and is what
 * the trend arrows read. What it could not say is the part a reader needs before believing
 * it: whether the points are anywhere near the line. A slope of +0.4 a month through six
 * results that zigzag by four points is the same number as a slope of +0.4 through six
 * results that walk straight up, and only one of them is a trend.
 *
 * So a fit here carries three things and refuses to carry them at sizes where they mean
 * nothing:
 *
 * - **The line**, as a slope and an intercept in the caller's own x units.
 * - **How much of the variation it explains** — R², `null` below three points, because a
 *   line through two points is exact by construction and its R² is 1 for every pair of
 *   results that ever existed.
 * - **How uncertain the line is**, as a band around it. That is uncertainty *about the
 *   fitted line*, not about where the next result lands — a different and much wider
 *   question — which is why the band this produces is named `confidence` and nothing here
 *   will call it a prediction.
 */

export interface RegressionPoint {
  x: number;
  y: number;
}

export interface LinearFit {
  slope: number;
  intercept: number;
  /**
   * Share of the variation the line explains, 0 … 1.
   *
   * `null` under three points, and for a set of results that are all the same: with no
   * variation to explain, "how much of it is explained" has no answer, and every
   * convention for filling one in — 0, 1 — reads as a verdict on the fit.
   */
  r2: number | null;
  /** Points the fit was computed from, which is what the reader should be told. */
  sample: number;
  /** Mean of x, kept because the band's width is measured from it. */
  meanX: number;
  /** Σ(x − x̄)², the spread of the x values the line was fitted over. */
  spreadX: number;
  /** Residual standard error, `null` under three points (no degrees of freedom left). */
  residualError: number | null;
}

/** Two points make a line; anything less makes nothing. */
export const REGRESSION_MINIMUM_SAMPLE = 2;
/** Below this the *quality* of a fit cannot be stated, only its direction. */
export const REGRESSION_QUALITY_SAMPLE = 3;

/**
 * The least-squares line through the points.
 *
 * `null` when there is no line to draw: fewer than two points, or every x the same — a
 * vertical line is not a function of x and no amount of algebra makes it one.
 */
export function linearFit(
  points: readonly RegressionPoint[],
): LinearFit | null {
  const usable = points.filter(
    (point) => Number.isFinite(point.x) && Number.isFinite(point.y),
  );
  const n = usable.length;
  if (n < REGRESSION_MINIMUM_SAMPLE) return null;

  const meanX = usable.reduce((sum, point) => sum + point.x, 0) / n;
  const meanY = usable.reduce((sum, point) => sum + point.y, 0) / n;

  let spreadX = 0;
  let covariance = 0;
  for (const point of usable) {
    const dx = point.x - meanX;
    spreadX += dx * dx;
    covariance += dx * (point.y - meanY);
  }
  if (spreadX === 0) return null;

  const slope = covariance / spreadX;
  const intercept = meanY - slope * meanX;

  let residualSum = 0;
  let totalSum = 0;
  for (const point of usable) {
    const fitted = intercept + slope * point.x;
    residualSum += (point.y - fitted) ** 2;
    totalSum += (point.y - meanY) ** 2;
  }

  const enough = n >= REGRESSION_QUALITY_SAMPLE;
  /**
   * "No variation" is not `totalSum === 0`.
   *
   * These y values are ratios — a sum of marks over a sum of coefficients — so three
   * identical results arrive identical to fifteen digits and not to sixteen: 0.7 three
   * times has a mean of 0.6999999999999999 and a total variation of about 1e-32. Compared
   * against exact zero that counts as variation, and R² then reports the ratio of two
   * pieces of floating dust, which came out as a confident 0.
   */
  const varied = Math.sqrt(totalSum / n) > 1e-9 * Math.max(1, Math.abs(meanY));
  return {
    slope,
    intercept,
    r2: enough && varied ? 1 - residualSum / totalSum : null,
    sample: n,
    meanX,
    spreadX,
    // n − 2: the line spent two of the points on itself, and what is left is what can
    // speak about the scatter around it.
    residualError: enough ? Math.sqrt(residualSum / (n - 2)) : null,
  };
}

/**
 * Two-sided 95% t values, by degrees of freedom.
 *
 * The standard table, because a fit of six results has five degrees of freedom and using
 * the normal 1.96 there understates the band by a fifth. Above thirty the difference stops
 * mattering at the width of a stroke, so the tail is a short ladder rather than a formula.
 */
const T_95: readonly number[] = [
  12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201,
  2.179, 2.16, 2.145, 2.131, 2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074,
  2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042,
];

/** The multiplier for a 95% interval at this many degrees of freedom. */
export function tValue(degreesOfFreedom: number): number {
  if (degreesOfFreedom < 1) return Number.NaN;
  if (degreesOfFreedom <= T_95.length) {
    return T_95[degreesOfFreedom - 1] as number;
  }
  if (degreesOfFreedom <= 40) return 2.021;
  if (degreesOfFreedom <= 60) return 2.0;
  if (degreesOfFreedom <= 120) return 1.98;
  return 1.96;
}

export interface RegressionInterval {
  x: number;
  center: number;
  low: number;
  high: number;
}

/**
 * The fitted line, with the band that says how well it is pinned down.
 *
 * Widest at the ends and narrowest in the middle, which is not decoration: the line is
 * pinned through the centre of the data and every degree of tilt it is uncertain about
 * swings the ends. A reader who has seen this shape once understands why extending the
 * line past the last result is a claim rather than a reading.
 *
 * `null` when there are not enough points for a residual error — the same threshold that
 * withholds R², for the same reason.
 */
export function regressionInterval(
  fit: LinearFit,
  xs: readonly number[],
): RegressionInterval[] | null {
  if (fit.residualError === null) return null;
  const t = tValue(fit.sample - 2);
  if (!Number.isFinite(t)) return null;

  return xs.map((x) => {
    const center = fit.intercept + fit.slope * x;
    const width =
      t *
      fit.residualError! *
      Math.sqrt(1 / fit.sample + (x - fit.meanX) ** 2 / fit.spreadX);
    return { x, center, low: center - width, high: center + width };
  });
}
