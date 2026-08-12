import type { NumericDomain, NumericScaleLike } from "@avermate/core/chart-interaction";
import type { SerializableChartSeries } from "./time-series-model";

/**
 * Everything the time-series chart computes before it paints anything.
 *
 * Kept out of the component so the arithmetic that decides where a sample
 * lands — and which gridlines a reader is shown — can be tested without a
 * renderer, a screen size or a gesture.
 */

export const GUTTER_LEFT = 38;
export const GUTTER_RIGHT = 10;
export const GUTTER_TOP = 10;
export const GUTTER_BOTTOM = 22;

export interface PlotRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface Datum {
  color: string;
  detail?: string;
  id: string;
  label: string;
  seriesId: string;
  timestamp: number;
  value: number;
}

export interface ProjectedPoint {
  datum: Datum;
  datumIndex: number;
  x: number;
  y: number;
}

export interface ProjectedSeries {
  color: string;
  id: string;
  path: string;
}

/** The drawing area inside the axis gutters. Never zero-sized, so no scale divides by nothing. */
export function plotRect(width: number, height: number): PlotRect {
  return {
    height: Math.max(1, height - GUTTER_TOP - GUTTER_BOTTOM),
    width: Math.max(1, width - GUTTER_LEFT - GUTTER_RIGHT),
    x: GUTTER_LEFT,
    y: GUTTER_TOP,
  };
}

export function createXScale(
  viewport: NumericDomain,
  plot: PlotRect,
): NumericScaleLike {
  const span = viewport[1] - viewport[0] || 1;
  return {
    invert: (position) => viewport[0] + ((position - plot.x) / plot.width) * span,
    map: (value) => plot.x + ((value - viewport[0]) / span) * plot.width,
  };
}

export function createYScale(
  yDomain: NumericDomain,
  plot: PlotRect,
): (value: number) => number {
  const span = yDomain[1] - yDomain[0] || 1;
  return (value) =>
    plot.y + plot.height - ((value - yDomain[0]) / span) * plot.height;
}

export function sameDomain(left: NumericDomain, right: NumericDomain): boolean {
  const tolerance = Math.max(Math.abs(right[1] - right[0]), 1) * 1e-9;
  return (
    Math.abs(left[0] - right[0]) <= tolerance &&
    Math.abs(left[1] - right[1]) <= tolerance
  );
}

/** Round tick values a reader recognises — 2, 2.5, 5 — never 3.7142. */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [];
  const rough = (max - min) / Math.max(1, count);
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10]
      .map((factor) => factor * magnitude)
      .find((candidate) => candidate >= rough) ?? magnitude * 10;

  const ticks: number[] = [];
  const first = Math.ceil(min / step) * step;
  for (let value = first; value <= max + step * 1e-6; value += step) {
    // Binary addition drifts; a tick labelled 12.999999999 is a visible bug.
    ticks.push(Math.round(value * 1e6) / 1e6);
  }
  return ticks;
}

/** Evenly spaced timestamps across the visible range, ends included. */
export function timeTicks(viewport: NumericDomain, count: number): number[] {
  const steps = Math.max(1, count - 1);
  const span = viewport[1] - viewport[0];
  return Array.from(
    { length: steps + 1 },
    (_unused, index) => viewport[0] + (span * index) / steps,
  );
}

/**
 * Project every visible sample once, producing both the polyline for each
 * series and the flat point list the nearest-point search consumes.
 */
export function projectSeries(
  series: readonly SerializableChartSeries[],
  scaleX: NumericScaleLike,
  scaleY: (value: number) => number,
): { paths: ProjectedSeries[]; points: ProjectedPoint[] } {
  const points: ProjectedPoint[] = [];
  const paths: ProjectedSeries[] = [];

  for (const item of series) {
    let path = "";
    item.points.forEach((point, index) => {
      const x = scaleX.map(point.timestamp);
      const y = scaleY(point.value);
      path += `${index === 0 ? "M" : " L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
      points.push({
        datum: {
          color: item.color,
          detail: point.detail,
          id: point.id,
          label: item.label,
          seriesId: item.id,
          timestamp: point.timestamp,
          value: point.value,
        },
        datumIndex: index,
        x,
        y,
      });
    });
    paths.push({ color: item.color, id: item.id, path });
  }

  return { paths, points };
}
