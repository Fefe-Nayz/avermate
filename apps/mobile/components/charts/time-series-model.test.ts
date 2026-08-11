import { describe, expect, test } from "bun:test";
import {
  createSerializableTimeSeriesModel,
  gradeSeriesInputs,
} from "./time-series-model";

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
});
