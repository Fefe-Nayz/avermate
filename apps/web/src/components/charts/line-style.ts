import { curveLinear, curveMonotoneX, curveStepAfter } from "d3-shape"

/**
 * How the average charts connect their samples. All three tell the truth at
 * the data points; they differ in what they claim between them:
 *
 * - `smooth` eases through the samples (monotone, so it never overshoots a
 *   real value and cannot invent a peak that was never reached),
 * - `straight` connects them directly,
 * - `step` holds each value until the next one — the literal shape of a
 *   running average, which only moves when a grade lands.
 */
export const LINE_STYLES = ["smooth", "straight", "step"] as const

export type ChartLineStyle = (typeof LINE_STYLES)[number]

const CURVES = {
  smooth: curveMonotoneX,
  straight: curveLinear,
  step: curveStepAfter,
} as const

/** Tolerates values missing from caches written before the field existed. */
export function lineStyleCurve(style: ChartLineStyle | undefined) {
  return CURVES[style ?? "smooth"] ?? CURVES.smooth
}
