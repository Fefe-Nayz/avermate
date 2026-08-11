import { describe, expect, test } from "bun:test";
import {
  createPointerInspectionController,
  panDomainBy,
  pinchDomainFromGesture,
  resolveNearestProjectedSeriesPoints,
  zoomDomainAt,
} from "@avermate/core/chart-interaction";

interface Point {
  datum: { enabled: boolean; series: string; timestamp: number };
  datumIndex: number;
  x: number;
  y: number;
}

const options = {
  getSeriesId: (point: Point) => point.datum.series,
  getTimestamp: (point: Point) => point.datum.timestamp,
  isEnabled: (point: Point) => point.datum.enabled,
};

const point = (
  series: string,
  timestamp: number,
  x: number,
  y: number,
  datumIndex = 0,
  enabled = true,
): Point => ({ datum: { enabled, series, timestamp }, datumIndex, x, y });

const scale = (domain: readonly [number, number]) => ({
  map: (value: number) => ((value - domain[0]) / (domain[1] - domain[0])) * 100,
  invert: (position: number) =>
    domain[0] + (position / 100) * (domain[1] - domain[0]),
});

describe("shared TanStack viewport consumer on Expo", () => {
  test("resolves one real nearest point per irregular and sparse series", () => {
    const points = [
      point("aligned", 0, 0, 10),
      point("aligned", 10, 50, 20, 1),
      point("aligned", 20, 100, 30, 2),
      point("irregular", 3, 15, 40),
      point("irregular", 17, 85, 45, 1),
      point("sparse", 1, 5, 70),
    ];
    const selected = resolveNearestProjectedSeriesPoints(
      points,
      { x: 62, y: 22 },
      options,
    );
    expect(selected).toHaveLength(3);
    expect(selected.find((item) => item.datum.series === "aligned")?.x).toBe(
      50,
    );
    expect(selected.find((item) => item.datum.series === "irregular")?.x).toBe(
      85,
    );
    expect(selected.find((item) => item.datum.series === "sparse")?.x).toBe(5);
  });

  test("uses earlier timestamps for equal distances and ignores hidden series", () => {
    const selected = resolveNearestProjectedSeriesPoints(
      [
        point("tie", 20, 60, 0, 1),
        point("tie", 10, 40, 0, 0),
        point("hidden", 15, 50, 0, 0, false),
      ],
      { x: 50, y: 0 },
      options,
    );
    expect(selected.map((item) => item.datum.timestamp)).toEqual([10]);
  });

  test("keeps zoom, pan and fixed-baseline pinch in semantic domains", () => {
    expect(zoomDomainAt(scale([0, 100]), [0, 100], [0, 100], 25, 2)).toEqual([
      12.5, 62.5,
    ]);
    expect(panDomainBy(scale([20, 80]), [20, 80], [0, 100], 10)).toEqual([
      14, 74,
    ]);
    expect(
      pinchDomainFromGesture(scale([20, 80]), [20, 80], [0, 100], 50, 60, 2),
    ).toEqual([32, 62]);
  });

  test("clears focus on pointer leave after rapid inspection", () => {
    const calls: string[] = [];
    const controller = createPointerInspectionController({
      clear: () => calls.push("clear"),
      inspect: (x) => calls.push(String(x)),
    });
    for (let index = 0; index < 30; index += 1) controller.move(index, 0);
    controller.leave();
    expect(calls).toHaveLength(31);
    expect(calls.at(-1)).toBe("clear");
  });
});
