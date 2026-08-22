/** A semantic numeric viewport. Time-series consumers store timestamps here. */
export type NumericDomain = readonly [start: number, end: number];

/** The small, renderer-independent scale surface required by chart gestures. */
export interface NumericScaleLike {
  invert?: (position: number) => unknown;
  map: (value: number) => number;
}

/** A datum after a renderer has projected it into scene coordinates. */
export interface ProjectedSeriesPoint<TDatum = unknown> {
  datum: TDatum;
  datumIndex: number;
  x: number;
  y: number;
}

export interface NearestProjectedSeriesOptions<TPoint> {
  getSeriesId: (point: TPoint) => string;
  getTimestamp?: (point: TPoint) => number;
  isEnabled?: (point: TPoint) => boolean;
}

function isFiniteDomain(domain: NumericDomain): boolean {
  return domain.every(Number.isFinite) && domain[0] !== domain[1];
}

function assertDomain(domain: NumericDomain, name: string): void {
  if (!isFiniteDomain(domain)) {
    throw new RangeError(`${name} must contain two distinct finite values.`);
  }
}

function toAscending(domain: NumericDomain): NumericDomain {
  return domain[0] <= domain[1] ? domain : [domain[1], domain[0]];
}

function restoreDirection(
  ascending: NumericDomain,
  reference: NumericDomain,
): NumericDomain {
  return reference[0] <= reference[1]
    ? ascending
    : [ascending[1], ascending[0]];
}

/** Clamp a requested viewport to its extent and a semantic maximum zoom. */
export function constrainDomain(
  requested: NumericDomain,
  extent: NumericDomain,
  maximumZoom: number,
): NumericDomain {
  assertDomain(requested, "requested domain");
  assertDomain(extent, "domain extent");

  if (!Number.isFinite(maximumZoom) || maximumZoom < 1) {
    throw new RangeError("maximumZoom must be a finite value of at least 1.");
  }

  const [extentStart, extentEnd] = toAscending(extent);
  const [requestedStart, requestedEnd] = toAscending(requested);
  const extentSpan = extentEnd - extentStart;
  const minimumSpan = extentSpan / maximumZoom;
  const span = Math.min(
    extentSpan,
    Math.max(minimumSpan, requestedEnd - requestedStart),
  );
  const requestedCenter = (requestedStart + requestedEnd) / 2;
  let start = requestedCenter - span / 2;
  let end = start + span;

  if (start < extentStart) {
    end += extentStart - start;
    start = extentStart;
  }
  if (end > extentEnd) {
    start -= end - extentEnd;
    end = extentEnd;
  }

  return restoreDirection([start, end], requested);
}

function invertNumber(scale: NumericScaleLike, position: number): number {
  const value = scale.invert?.(position);
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new TypeError(
      "Time-series gestures require an invertible numeric scale.",
    );
  }
  return value;
}

/** Zoom a semantic domain around a scene-coordinate anchor. */
export function zoomDomainAt(
  scale: NumericScaleLike,
  domain: NumericDomain,
  extent: NumericDomain,
  anchor: number,
  factor: number,
  maximumZoom = 64,
): NumericDomain {
  assertDomain(domain, "visible domain");
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError("factor must be a finite positive value.");
  }

  const first = anchor + (scale.map(domain[0]) - anchor) / factor;
  const second = anchor + (scale.map(domain[1]) - anchor) / factor;
  return constrainDomain(
    [invertNumber(scale, first), invertNumber(scale, second)],
    extent,
    maximumZoom,
  );
}

/** Positive scene delta means the plotted content moved to the right. */
export function panDomainBy(
  scale: NumericScaleLike,
  domain: NumericDomain,
  extent: NumericDomain,
  delta: number,
  maximumZoom = 64,
): NumericDomain {
  if (!Number.isFinite(delta)) throw new RangeError("delta must be finite.");

  return constrainDomain(
    [
      invertNumber(scale, scale.map(domain[0]) - delta),
      invertNumber(scale, scale.map(domain[1]) - delta),
    ],
    extent,
    maximumZoom,
  );
}

/**
 * Resolve a complete two-pointer gesture from one immutable baseline. This
 * prevents a pure two-finger translation from accumulating accidental zoom.
 */
export function pinchDomainFromGesture(
  scale: NumericScaleLike,
  baselineDomain: NumericDomain,
  extent: NumericDomain,
  baselineMidpoint: number,
  currentMidpoint: number,
  factor: number,
  maximumZoom = 64,
): NumericDomain {
  assertDomain(baselineDomain, "pinch baseline domain");
  if (!Number.isFinite(factor) || factor <= 0) {
    throw new RangeError("pinch factor must be a finite positive value.");
  }

  const firstScene = scale.map(baselineDomain[0]);
  const secondScene = scale.map(baselineDomain[1]);
  return constrainDomain(
    [
      invertNumber(
        scale,
        baselineMidpoint + (firstScene - currentMidpoint) / factor,
      ),
      invertNumber(
        scale,
        baselineMidpoint + (secondScene - currentMidpoint) / factor,
      ),
    ],
    extent,
    maximumZoom,
  );
}

function compareProjectedIdentity<TPoint extends ProjectedSeriesPoint<unknown>>(
  left: TPoint,
  right: TPoint,
  options: NearestProjectedSeriesOptions<TPoint>,
): number {
  const timestamp =
    (options.getTimestamp?.(left) ?? left.x) -
    (options.getTimestamp?.(right) ?? right.x);
  if (timestamp !== 0) return timestamp;

  const series = options
    .getSeriesId(left)
    .localeCompare(options.getSeriesId(right));
  return series !== 0 ? series : left.datumIndex - right.datumIndex;
}

/**
 * Select one independently nearest real sample per enabled series. The first
 * result is the nearest in two dimensions and acts as the coherent tooltip's
 * primary datum; all other entries remain at their own real timestamps.
 */
export function resolveNearestProjectedSeriesPoints<
  TPoint extends ProjectedSeriesPoint<unknown>,
>(
  points: readonly TPoint[],
  pointer: { x: number; y: number },
  options: NearestProjectedSeriesOptions<TPoint>,
): readonly TPoint[] {
  const nearestBySeries = new Map<string, TPoint>();

  for (const point of points) {
    if (!(options.isEnabled?.(point) ?? true)) continue;
    const seriesId = options.getSeriesId(point);
    const current = nearestBySeries.get(seriesId);
    if (!current) {
      nearestBySeries.set(seriesId, point);
      continue;
    }

    const distance = Math.abs(point.x - pointer.x);
    const currentDistance = Math.abs(current.x - pointer.x);
    if (
      distance < currentDistance ||
      (distance === currentDistance &&
        compareProjectedIdentity(point, current, options) < 0)
    ) {
      nearestBySeries.set(seriesId, point);
    }
  }

  const selected = [...nearestBySeries.values()];
  if (selected.length < 2) return selected;

  let primaryIndex = 0;
  let primaryDistance = Number.POSITIVE_INFINITY;
  selected.forEach((point, index) => {
    const distance = Math.hypot(point.x - pointer.x, point.y - pointer.y);
    if (
      distance < primaryDistance ||
      (distance === primaryDistance &&
        compareProjectedIdentity(
          point,
          selected[primaryIndex] as TPoint,
          options,
        ) < 0)
    ) {
      primaryIndex = index;
      primaryDistance = distance;
    }
  });

  const [primary] = selected.splice(primaryIndex, 1);
  return primary ? [primary, ...selected] : selected;
}

export type ChartKeyboardCommand =
  "pan-left" | "pan-right" | "reset" | "zoom-in" | "zoom-out";

/** Plain arrows and Home/End stay available for renderer datum navigation. */
export function resolveChartKeyboardCommand(input: {
  altKey: boolean;
  key: string;
}): ChartKeyboardCommand | null {
  if (input.key === "0") return "reset";
  if (input.key === "+" || input.key === "=") return "zoom-in";
  if (input.key === "-") return "zoom-out";
  if (input.altKey && input.key === "ArrowLeft") return "pan-left";
  if (input.altKey && input.key === "ArrowRight") return "pan-right";
  return null;
}

export function createPointerInspectionController(handlers: {
  clear: () => void;
  inspect: (clientX: number, clientY: number) => void;
}) {
  return { leave: handlers.clear, move: handlers.inspect };
}

/** Convert wheel line/page units into scene pixels used by the scale. */
export function normalizeWheelDelta(
  input: { deltaMode: number; deltaX: number; deltaY: number },
  page: { height: number; width: number },
  lineSize = 16,
): { x: number; y: number } {
  if (input.deltaMode === 1) {
    return { x: input.deltaX * lineSize, y: input.deltaY * lineSize };
  }
  if (input.deltaMode === 2) {
    return { x: input.deltaX * page.width, y: input.deltaY * page.height };
  }
  return { x: input.deltaX, y: input.deltaY };
}

/** Page scroll remains available until the plot is pointer-armed or focused. */
export function shouldHandleChartWheel(input: {
  armedByPointer: boolean;
  ctrlKey: boolean;
  focusedWithin: boolean;
}): boolean {
  return input.armedByPointer || input.focusedWithin;
}
