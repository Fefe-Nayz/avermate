import type { IntervalPoint } from "./projection";

/**
 * Where your ordinary results fall, and which ones did not.
 *
 * A control chart: the marks in order, the level they sit around, and a band inside which
 * ordinary variation lands. What it is *for* is the thing a list of marks hides — not
 * whether a result is good, but whether it belongs to the same pattern as the others.
 *
 * Three commitments make it honest, and the audit asks for all three:
 *
 * - **Descriptive, never diagnostic.** The band says "this is the spread you have been
 *   running at". It does not say a mark outside it was a bad day, a hard paper or a
 *   change of level, because the data cannot tell those apart.
 * - **A minimum sample.** Limits drawn from five marks are drawn from noise, and a card
 *   that flags an ordinary result as unusual is worse than one that says nothing.
 * - **The width is stated.** Two standard deviations is a choice, not a law, and a reader
 *   who is told "two" can weigh a point that sits just outside.
 *
 * Deliberately *not* the anomaly card. That one judges the latest mark against the marks
 * before it — excluding itself, so it cannot hide in its own average — and answers "is
 * this one strange". This draws the whole run and answers "how strange is my run".
 */

export interface ControlBand {
  /** Never widened by a renderer: these are control limits, not a confidence interval. */
  intervalKind: "control";
  /** One point per mark, in the order they were sat. */
  points: IntervalPoint[];
  /** The level the marks sit around. */
  center: number;
  /** One standard deviation of the marks. */
  deviation: number;
  /** How many deviations the limits are drawn at. */
  deviations: number;
  /** Marks the limits were computed from. */
  sample: number;
  /** Keys of the points outside the limits. */
  unusual: string[];
}

/**
 * Marks needed before limits mean anything.
 *
 * Eight, which is the same judgement as the anomaly card's five plus the fact that this
 * one draws a *shape*: a band over six points is read as a pattern, and six marks do not
 * have one.
 */
export const CONTROL_MINIMUM_SAMPLE = 8;

/** How wide the band is drawn, in standard deviations. */
export const CONTROL_DEVIATIONS = 2;

/**
 * The band, from the marks in the order they were sat.
 *
 * `null` where there is nothing to draw: too few marks, or marks with no spread at all —
 * a band of zero width would report every result as exactly ordinary and any repeat of it
 * as unusual, which is an artefact of dividing by nothing.
 *
 * The limits are clamped to the scale. A limit above full marks is not reachable, and
 * drawing it would put the band's edge somewhere no result can go; clamping says the
 * honest thing, which is that nothing can exceed the top.
 */
export function controlBand(
  ratios: readonly number[],
  deviations: number = CONTROL_DEVIATIONS,
): ControlBand | null {
  const usable = ratios.filter((value) => Number.isFinite(value));
  if (usable.length < CONTROL_MINIMUM_SAMPLE) return null;

  const center = usable.reduce((sum, value) => sum + value, 0) / usable.length;
  const variance =
    usable.reduce((sum, value) => sum + (value - center) ** 2, 0) /
    usable.length;
  const deviation = Math.sqrt(variance);
  if (deviation < 1e-9) return null;

  const low = Math.max(0, center - deviations * deviation);
  const high = Math.min(1, center + deviations * deviation);
  const unusual: string[] = [];
  const points: IntervalPoint[] = usable.map((value, index) => {
    const key = `mark-${index}`;
    // Outside the *unclamped* limits, so a mark is not called unusual merely because the
    // band was cut off at full marks.
    if (
      value < center - deviations * deviation ||
      value > center + deviations * deviation
    ) {
      unusual.push(key);
    }
    return { key, step: index, low, center, high, observed: value };
  });

  return {
    intervalKind: "control",
    points,
    center,
    deviation,
    deviations,
    sample: usable.length,
    unusual,
  };
}
