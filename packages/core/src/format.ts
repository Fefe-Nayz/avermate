import type { Ratio } from "./types";

/**
 * Presentation helpers. The engine works in ratios; screens work in whatever
 * scale the year uses. Every conversion between the two lives here so a "17.5"
 * means the same thing on a chart axis, in a table cell and in a screenshot.
 */

export interface ScaleOptions {
  scale: number;
  /** Digits after the decimal point. */
  decimals?: number;
  locale?: string;
}

export function scaled(ratio: Ratio, scale: number): number | null {
  return ratio === null ? null : ratio * scale;
}

export function formatScaled(
  ratio: Ratio,
  { scale, decimals = 2, locale }: ScaleOptions,
): string | null {
  const value = scaled(ratio, scale);
  if (value === null) return null;
  return value.toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** A signed delta, e.g. "+0.42" — used for impacts and trends. */
export function formatDelta(
  delta: number | null,
  { scale, decimals = 2, locale }: ScaleOptions,
): string | null {
  if (delta === null) return null;
  const value = delta * scale;
  const formatted = Math.abs(value).toLocaleString(locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
  if (Math.abs(value) < 10 ** -decimals / 2) return `±${formatted}`;
  return `${value > 0 ? "+" : "−"}${formatted}`;
}

export function formatPercent(
  ratio: Ratio,
  { decimals = 0, locale }: { decimals?: number; locale?: string } = {},
): string | null {
  if (ratio === null) return null;
  return ratio.toLocaleString(locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * The raw points of a grade, e.g. "14 / 20". Kept separate from the average
 * formatting: a grade is a fact, an average is a computation.
 */
export function formatPoints(
  value: number,
  outOf: number,
  { decimals = 2, locale }: { decimals?: number; locale?: string } = {},
): string {
  const trim = (input: number) =>
    input.toLocaleString(locale, {
      minimumFractionDigits: Number.isInteger(input) ? 0 : decimals,
      maximumFractionDigits: decimals,
    });
  return `${trim(value)} / ${trim(outOf)}`;
}

/** Coefficients read better without trailing zeroes: "1", "1.5", "0.75". */
export function formatCoefficient(
  coefficient: number,
  locale?: string,
): string {
  return coefficient.toLocaleString(locale, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

/** Clamp a hypothetical result into something a user could actually be given. */
export function clampRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return 0;
  return Math.min(1, Math.max(0, ratio));
}

/** Colour band for a result, so charts and badges agree on what "good" is. */
export type ResultBand = "excellent" | "good" | "fair" | "weak" | "poor";

export function bandOf(ratio: Ratio, passingRatio = 0.5): ResultBand | null {
  if (ratio === null) return null;
  const headroom = 1 - passingRatio;
  if (ratio >= passingRatio + headroom * 0.7) return "excellent";
  if (ratio >= passingRatio + headroom * 0.4) return "good";
  if (ratio >= passingRatio) return "fair";
  if (ratio >= passingRatio * 0.7) return "weak";
  return "poor";
}
