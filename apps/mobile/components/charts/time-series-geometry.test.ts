import { describe, expect, test } from "bun:test";
import {
  panDomainBy,
  pinchDomainFromGesture,
  resolveNearestProjectedSeriesPoints,
  type NumericDomain,
} from "@avermate/core/chart-interaction";
import {
  createXScale,
  createYScale,
  linePath,
  niceTicks,
  plotRect,
  projectSeries,
  sameDomain,
  timeTicks,
  viewportYDomain,
} from "./time-series-geometry";
import type { SerializableChartSeries } from "./time-series-model";

const DAY = 86_400_000;

function series(
  id: string,
  color: string,
  values: number[],
): SerializableChartSeries {
  return {
    color,
    id,
    label: id,
    points: values.map((value, index) => ({
      id: `${id}:${index}`,
      timestamp: index * DAY,
      value,
    })),
  };
}

describe("native time-series geometry", () => {
  test("keeps the plot area positive even on an unmeasured container", () => {
    const collapsed = plotRect(0, 0);
    expect(collapsed.width).toBeGreaterThan(0);
    expect(collapsed.height).toBeGreaterThan(0);
  });

  test("the x scale round-trips between timestamps and scene pixels", () => {
    const plot = plotRect(360, 240);
    const viewport: NumericDomain = [0, 10 * DAY];
    const scale = createXScale(viewport, plot);

    expect(scale.map(viewport[0])).toBeCloseTo(plot.x, 6);
    expect(scale.map(viewport[1])).toBeCloseTo(plot.x + plot.width, 6);
    expect(scale.invert?.(scale.map(4 * DAY))).toBeCloseTo(4 * DAY, 3);
  });

  test("the y scale puts the low end of the domain at the bottom", () => {
    const plot = plotRect(360, 240);
    const scale = createYScale([0, 20], plot);

    expect(scale(0)).toBeCloseTo(plot.y + plot.height, 6);
    expect(scale(20)).toBeCloseTo(plot.y, 6);
    expect(scale(10)).toBeCloseTo(plot.y + plot.height / 2, 6);
  });

  test("gridline values are readable and stay inside the domain", () => {
    expect(niceTicks(0, 20, 5)).toEqual([0, 5, 10, 15, 20]);
    for (const tick of niceTicks(11.2, 15.8, 5)) {
      expect(tick).toBeGreaterThanOrEqual(11.2);
      expect(tick).toBeLessThanOrEqual(15.8);
      // No 12.000000000000002 under a label.
      expect(String(tick).length).toBeLessThanOrEqual(6);
    }
    expect(niceTicks(5, 5, 5)).toEqual([]);
    expect(niceTicks(Number.NaN, 10, 5)).toEqual([]);
  });

  test("date ticks include both ends of the visible range", () => {
    const ticks = timeTicks([0, 9 * DAY], 4);
    expect(ticks).toHaveLength(4);
    expect(ticks[0]).toBe(0);
    expect(ticks.at(-1)).toBe(9 * DAY);
  });

  test("projection emits one point per sample and a matching polyline", () => {
    const plot = plotRect(360, 240);
    const scale = createXScale([0, 2 * DAY], plot);
    const { paths, points } = projectSeries(
      [series("a", "#111", [10, 12, 14]), series("b", "#222", [8, 9, 7])],
      scale,
      createYScale([0, 20], plot),
    );

    expect(points).toHaveLength(6);
    expect(paths).toHaveLength(2);
    expect(paths[0]?.path.startsWith("M ")).toBe(true);
    expect(paths[0]?.path.match(/L/g)).toHaveLength(2);
    // Later samples sit further right, and higher marks sit higher up.
    expect(points[1]?.x).toBeGreaterThan(points[0]?.x as number);
    expect(points[1]?.y).toBeLessThan(points[0]?.y as number);
  });

  test("a hidden series contributes neither a line nor a hit target", () => {
    const plot = plotRect(360, 240);
    const visible = [series("a", "#111", [10, 12])];
    const { paths, points } = projectSeries(
      visible,
      createXScale([0, DAY], plot),
      createYScale([0, 20], plot),
    );

    expect(paths.map((item) => item.id)).toEqual(["a"]);
    expect(new Set(points.map((point) => point.datum.seriesId))).toEqual(
      new Set(["a"]),
    );
  });

  test("a pinch stays inside the extent and is reversible by a reset", () => {
    const plot = plotRect(360, 240);
    const extent: NumericDomain = [0, 10 * DAY];
    const baseline = createXScale(extent, plot);

    const zoomedIn = pinchDomainFromGesture(
      baseline,
      extent,
      extent,
      plot.x + plot.width / 2,
      plot.x + plot.width / 2,
      3,
      8,
    );
    expect(zoomedIn[0]).toBeGreaterThanOrEqual(extent[0]);
    expect(zoomedIn[1]).toBeLessThanOrEqual(extent[1]);
    expect(zoomedIn[1] - zoomedIn[0]).toBeLessThan(extent[1] - extent[0]);
    expect(sameDomain(zoomedIn, extent)).toBe(false);
    expect(sameDomain(extent, extent)).toBe(true);

    // Panning far past the edge clamps rather than running off the data.
    const panned = panDomainBy(
      createXScale(zoomedIn, plot),
      zoomedIn,
      extent,
      -10_000,
      8,
    );
    expect(panned[1]).toBeLessThanOrEqual(extent[1]);
    expect(panned[1] - panned[0]).toBeCloseTo(zoomedIn[1] - zoomedIn[0], 6);
  });

  test("inspection picks one real sample per series near the finger", () => {
    const plot = plotRect(360, 240);
    const scaleX = createXScale([0, 2 * DAY], plot);
    const { points } = projectSeries(
      [series("a", "#111", [10, 12, 14]), series("b", "#222", [8, 9, 7])],
      scaleX,
      createYScale([0, 20], plot),
    );

    const picked = resolveNearestProjectedSeriesPoints(
      points,
      { x: scaleX.map(2 * DAY), y: plot.y },
      { getSeriesId: (point) => point.datum.seriesId },
    );

    expect(picked).toHaveLength(2);
    expect(new Set(picked.map((point) => point.datum.seriesId))).toEqual(
      new Set(["a", "b"]),
    );
    for (const point of picked) expect(point.datumIndex).toBe(2);
    // The primary datum leads, and it is the one nearest in two dimensions.
    expect(picked[0]?.datum.seriesId).toBe("a");
  });
});

describe("line paths and viewport framing", () => {
  const coords: Array<readonly [number, number]> = [
    [0, 100],
    [50, 20],
    [100, 60],
    [150, 60],
  ];

  test("straight and step paths visit every sample", () => {
    const straight = linePath(coords, "straight");
    expect(straight).toBe(
      "M 0.00 100.00 L 50.00 20.00 L 100.00 60.00 L 150.00 60.00",
    );
    const step = linePath(coords, "step");
    expect(step).toContain("L 50.00 100.00 L 50.00 20.00");
    expect(step.endsWith("L 150.00 60.00 L 150.00 60.00")).toBe(true);
  });

  test("smooth paths pass through the samples and never overshoot", () => {
    const smooth = linePath(coords, "smooth");
    expect(smooth.startsWith("M 0.00 100.00")).toBe(true);
    expect(smooth.endsWith("150.00 60.00")).toBe(true);
    // Every cubic control ordinate stays inside the data's y-range: monotone
    // interpolation may flatten, never bulge past a sample.
    const ordinates = [
      ...smooth.matchAll(/C ([\d.]+) ([\d.]+) ([\d.]+) ([\d.]+)/g),
    ].flatMap((match) => [Number(match[2]), Number(match[4])]);
    for (const y of ordinates) {
      expect(y).toBeGreaterThanOrEqual(20 - 1e-6);
      expect(y).toBeLessThanOrEqual(100 + 1e-6);
    }
  });

  test("projectSeries tags each path with its line treatment", () => {
    const plot = plotRect(360, 240);
    const { paths } = projectSeries(
      [
        { ...series("dots", "#111", [10, 12]), line: "none" },
        series("run", "#222", [8, 9]),
      ],
      createXScale([0, DAY], plot),
      createYScale([0, 20], plot),
      "straight",
    );
    expect(paths.find((path) => path.id === "dots")?.line).toBe("none");
    expect(paths.find((path) => path.id === "run")?.line).toBe("full");
  });

  test("viewport y-domain frames visible values plus crossing neighbours", () => {
    const item = series("a", "#111", [2, 18, 10, 4]);
    // Viewport covers only the middle two samples; the outer ones (2 and 4)
    // still count because their segments enter the frame.
    const framed = viewportYDomain([item], [0.5 * DAY, 2.5 * DAY], 20, [0, 20]);
    expect(framed[0]).toBeLessThanOrEqual(2);
    expect(framed[1]).toBeGreaterThanOrEqual(18);

    // A viewport past every sample falls back to the resting domain.
    const empty = viewportYDomain(
      [{ ...item, points: [] }],
      [0, DAY],
      20,
      [0, 20],
    );
    expect(empty).toEqual([0, 20]);
  });
});
