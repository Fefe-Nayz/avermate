import type {
  NumericDomain,
  NumericScaleLike,
} from "@avermate/core/chart-interaction";
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
  line: "full" | "faint" | "none";
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
    invert: (position) =>
      viewport[0] + ((position - plot.x) / plot.width) * span,
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

export type LinePathStyle = "smooth" | "straight" | "step";

function sign(value: number): number {
  return value < 0 ? -1 : 1;
}

/**
 * Monotone cubic tangents (Fritsch–Carlson, as d3's curveMonotoneX): the
 * curve passes through every sample and never overshoots between two of
 * them, so a smoothed average can still be read as the truth.
 */
function monotonePath(
  coords: ReadonlyArray<readonly [number, number]>,
): string {
  const n = coords.length;
  if (n < 3) return straightPath(coords);

  const secants: number[] = [];
  for (let index = 0; index < n - 1; index += 1) {
    const [x0, y0] = coords[index]!;
    const [x1, y1] = coords[index + 1]!;
    const dx = x1 - x0;
    secants.push(dx === 0 ? 0 : (y1 - y0) / dx);
  }

  const tangents: number[] = new Array(n).fill(0);
  for (let index = 1; index < n - 1; index += 1) {
    const before = secants[index - 1]!;
    const after = secants[index]!;
    if (before * after <= 0) {
      tangents[index] = 0;
      continue;
    }
    const [xPrev] = coords[index - 1]!;
    const [xHere] = coords[index]!;
    const [xNext] = coords[index + 1]!;
    const h0 = xHere - xPrev;
    const h1 = xNext - xHere;
    const weighted =
      (3 * (h0 + h1)) / ((2 * h1 + h0) / before + (h1 + 2 * h0) / after);
    tangents[index] =
      (sign(before) + sign(after)) *
      Math.min(Math.abs(before), Math.abs(after), 0.5 * Math.abs(weighted));
  }
  // Endpoint tangents keep the first and last segments monotone too.
  tangents[0] = endpointTangent(coords[0]!, coords[1]!, tangents[1]!);
  tangents[n - 1] = endpointTangent(
    coords[n - 1]!,
    coords[n - 2]!,
    tangents[n - 2]!,
  );

  let path = `M ${coords[0]![0].toFixed(2)} ${coords[0]![1].toFixed(2)}`;
  for (let index = 0; index < n - 1; index += 1) {
    const [x0, y0] = coords[index]!;
    const [x1, y1] = coords[index + 1]!;
    const dx = (x1 - x0) / 3;
    path +=
      ` C ${(x0 + dx).toFixed(2)} ${(y0 + dx * tangents[index]!).toFixed(2)}` +
      ` ${(x1 - dx).toFixed(2)} ${(y1 - dx * tangents[index + 1]!).toFixed(2)}` +
      ` ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  }
  return path;
}

function endpointTangent(
  end: readonly [number, number],
  inner: readonly [number, number],
  innerTangent: number,
): number {
  const h = inner[0] - end[0];
  if (h === 0) return 0;
  const secant = (inner[1] - end[1]) / h;
  const candidate = (3 * secant - innerTangent) / 2;
  return secant * candidate <= 0
    ? 0
    : Math.min(Math.abs(candidate), 3 * Math.abs(secant)) * sign(candidate);
}

function straightPath(
  coords: ReadonlyArray<readonly [number, number]>,
): string {
  return coords
    .map(
      ([x, y], index) =>
        `${index === 0 ? "M" : " L"} ${x.toFixed(2)} ${y.toFixed(2)}`,
    )
    .join("");
}

/** Step-after: the value holds until the next sample lands. */
function stepPath(coords: ReadonlyArray<readonly [number, number]>): string {
  let path = "";
  coords.forEach(([x, y], index) => {
    if (index === 0) {
      path = `M ${x.toFixed(2)} ${y.toFixed(2)}`;
      return;
    }
    const [, previousY] = coords[index - 1]!;
    path += ` L ${x.toFixed(2)} ${previousY.toFixed(2)} L ${x.toFixed(2)} ${y.toFixed(2)}`;
  });
  return path;
}

export function linePath(
  coords: ReadonlyArray<readonly [number, number]>,
  style: LinePathStyle,
): string {
  if (coords.length === 0) return "";
  if (style === "smooth") return monotonePath(coords);
  if (style === "step") return stepPath(coords);
  return straightPath(coords);
}

/**
 * Project every visible sample once, producing both the path for each series
 * and the flat point list the nearest-point search consumes.
 *
 * Faint grade connectors ignore the line-style preference and stay straight,
 * as on the web: a smooth or stepped sweep between unrelated assessments
 * would claim a relationship that does not exist.
 */
export function projectSeries(
  series: readonly SerializableChartSeries[],
  scaleX: NumericScaleLike,
  scaleY: (value: number) => number,
  lineStyle: LinePathStyle = "straight",
): { paths: ProjectedSeries[]; points: ProjectedPoint[] } {
  const points: ProjectedPoint[] = [];
  const paths: ProjectedSeries[] = [];

  for (const item of series) {
    const coords: Array<readonly [number, number]> = [];
    item.points.forEach((point, index) => {
      const x = scaleX.map(point.timestamp);
      const y = scaleY(point.value);
      coords.push([x, y]);
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
    paths.push({
      color: item.color,
      id: item.id,
      line: item.line ?? "full",
      path: linePath(coords, item.line === "faint" ? "straight" : lineStyle),
    });
  }

  return { paths, points };
}

/**
 * The y-window that keeps every visible run inside the plot: values inside
 * the viewport plus, per series, the nearest sample just outside each edge —
 * an interpolated line may leave through the sides but never through the top
 * or bottom.
 */
export function viewportYDomain(
  series: readonly SerializableChartSeries[],
  viewport: NumericDomain,
  maximumScale: number,
  fallback: NumericDomain,
): NumericDomain {
  const values: number[] = [];
  for (const item of series) {
    const points = item.points;
    for (let index = 0; index < points.length; index += 1) {
      const point = points[index]!;
      if (point.timestamp >= viewport[0] && point.timestamp <= viewport[1]) {
        values.push(point.value);
      }
    }
    // Off-screen neighbours whose segments cross into the frame.
    let before: number | null = null;
    let after: number | null = null;
    for (const point of points) {
      if (point.timestamp < viewport[0]) before = point.value;
      if (point.timestamp > viewport[1]) {
        after = point.value;
        break;
      }
    }
    if (before !== null) values.push(before);
    if (after !== null) values.push(after);
  }
  if (values.length === 0) return fallback;

  const minimum = Math.min(...values);
  const maximum = Math.max(...values);
  const padding = Math.max((maximum - minimum) * 0.12, maximumScale * 0.025);
  const start = Math.max(0, minimum - padding);
  const end = Math.min(maximumScale, maximum + padding);
  if (start !== end) return [start, end];
  return [
    Math.max(0, start - maximumScale * 0.025),
    Math.min(maximumScale, end + maximumScale * 0.025),
  ];
}
