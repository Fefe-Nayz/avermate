import { describe, expect, test } from "bun:test";
import {
  createSerializableTimeSeriesModel,
  createTrendChartSeries,
  gradeSeriesInputs,
  type SerializableChartSeries,
} from "./time-series-model";

const DAY = 86_400_000;

function chartSeries(
  id: string,
  values: readonly number[],
  extra: Partial<SerializableChartSeries> = {},
): SerializableChartSeries {
  return {
    color: "#123456",
    id,
    label: id,
    points: values.map((value, index) => ({
      id: `${id}:${index}`,
      timestamp: index * DAY,
      value,
    })),
    ...extra,
  };
}

describe("Expo DOM chart bridge", () => {
  test("crosses the bridge as JSON-safe primitives and drops missing samples", () => {
    const model = createSerializableTimeSeriesModel({
      autoZoom: true,
      maximumScale: 20,
      series: [
        {
          color: "#123456",
          id: "sparse",
          label: "Sparse",
          points: [
            { date: new Date("2026-01-01T12:00:00Z"), value: 12 },
            { date: new Date("invalid"), value: 13 },
            { date: new Date("2026-02-01T12:00:00Z"), value: null },
            { date: new Date("2026-03-01T12:00:00Z"), value: 16 },
          ],
        },
      ],
    });

    expect(model.series[0]?.points).toHaveLength(2);
    const parsed = JSON.parse(JSON.stringify(model));
    expect(typeof parsed.series[0].points[0].timestamp).toBe("number");
    expect(parsed.series[0].points[0].date).toBeUndefined();
    expect(model.yDomain[0]).toBeGreaterThan(0);
    expect(model.domain[1]).toBeGreaterThan(model.domain[0]);
  });

  test("keeps irregular grade timestamps in independent subject series", () => {
    const grade = (id: string, subjectId: string, day: string) => ({
      id,
      subjectId,
      name: id,
      value: 15,
      outOf: 20,
      coefficient: 1,
      passedAt: new Date(`${day}T12:00:00Z`),
      createdAt: new Date(`${day}T12:00:00Z`),
      periodId: null,
      components: [],
    });
    const series = gradeSeriesInputs({
      colors: ["#1", "#2"],
      grades: [
        grade("a1", "alpha", "2026-01-01"),
        grade("b1", "beta", "2026-01-07"),
        grade("a2", "alpha", "2026-02-15"),
      ],
      scale: 20,
      subjects: [
        {
          id: "alpha",
          name: "Alpha",
          shortName: null,
          parentId: null,
          coefficient: 1,
          kind: "subject",
          isMain: false,
          sortOrder: 0,
          grades: [],
        },
        {
          id: "beta",
          name: "Beta",
          shortName: null,
          parentId: null,
          coefficient: 1,
          kind: "subject",
          isMain: false,
          sortOrder: 1,
          grades: [],
        },
      ],
    });

    expect(series.map((item) => item.points.length)).toEqual([2, 1]);
    expect(series[0]?.points[1]?.date.getTime()).not.toBe(
      series[1]?.points[0]?.date.getTime(),
    );
  });

  test("carries the primary flag across the serialization boundary", () => {
    const model = createSerializableTimeSeriesModel({
      maximumScale: 20,
      series: [
        {
          color: "#123456",
          id: "main",
          label: "Main",
          primary: true,
          points: [{ date: new Date("2026-01-01T12:00:00Z"), value: 12 }],
        },
        {
          color: "#654321",
          id: "child",
          label: "Child",
          points: [{ date: new Date("2026-01-01T12:00:00Z"), value: 8 }],
        },
      ],
    });

    expect(model.series[0]?.primary).toBe(true);
    expect(model.series[1]?.primary).toBeUndefined();
  });
});

describe("trend series", () => {
  test("reproduces a linear run on the chart's own scale", () => {
    const trend = createTrendChartSeries({
      maximumScale: 20,
      series: [chartSeries("a", [10, 11, 12, 13])],
      subdivisions: 1,
    });

    expect(trend).not.toBeNull();
    expect(trend?.points).toHaveLength(4);
    trend?.points.forEach((point, index) => {
      expect(point.timestamp).toBe(index * DAY);
      expect(point.value).toBeCloseTo(10 + index, 6);
    });
  });

  test("follows the flagged primary series over the first one", () => {
    const trend = createTrendChartSeries({
      maximumScale: 20,
      series: [
        chartSeries("first", [5, 5, 5]),
        chartSeries("flagged", [15, 15, 15], { primary: true }),
      ],
      subdivisions: 1,
    });

    for (const point of trend?.points ?? []) {
      expect(point.value).toBeCloseTo(15, 6);
    }
  });

  test("defaults to the first full line, as mobile callers seat the subject", () => {
    const trend = createTrendChartSeries({
      maximumScale: 20,
      series: [
        chartSeries("subject", [12, 12, 12]),
        chartSeries("child", [4, 4, 4]),
      ],
      subdivisions: 1,
    });

    for (const point of trend?.points ?? []) {
      expect(point.value).toBeCloseTo(12, 6);
    }
  });

  test("pools a dots-only grade cloud chronologically, like the web grade chart", () => {
    const late = chartSeries("late", [16, 18], { line: "none" });
    late.points = late.points.map((point) => ({
      ...point,
      timestamp: point.timestamp + DAY,
    }));
    const trend = createTrendChartSeries({
      maximumScale: 20,
      series: [chartSeries("early", [10, 12], { line: "none" }), late],
      subdivisions: 1,
    });

    expect(trend?.points.map((point) => point.timestamp)).toEqual([
      0,
      DAY,
      DAY,
      2 * DAY,
    ]);
    // A strictly rising pooled cloud keeps a rising trend.
    const values = trend?.points.map((point) => point.value) ?? [];
    expect(values.at(-1)).toBeGreaterThan(values[0] ?? Number.NaN);
  });

  test("never predicts beyond the grading scale", () => {
    const trend = createTrendChartSeries({
      maximumScale: 20,
      series: [chartSeries("a", [25, 25, 25])],
      subdivisions: 1,
    });

    for (const point of trend?.points ?? []) {
      expect(point.value).toBeLessThanOrEqual(20);
    }
  });

  test("declines to draw a trend through fewer than two samples", () => {
    expect(
      createTrendChartSeries({
        maximumScale: 20,
        series: [chartSeries("a", [12])],
        subdivisions: 1,
      }),
    ).toBeNull();
    expect(
      createTrendChartSeries({ maximumScale: 20, series: [], subdivisions: 1 }),
    ).toBeNull();
  });
});
