import { describe, expect, test } from "bun:test";
import { SubjectGraph, type CustomAverage, type Subject } from "@avermate/core";
import { averageAnalytics } from "./average-analytics";

function subject(id: string, value: number, coefficient: number): Subject {
  return {
    id,
    name: id,
    shortName: null,
    parentId: null,
    coefficient,
    kind: "subject",
    isMain: false,
    sortOrder: 0,
    grades: [
      {
        id: `${id}-grade`,
        name: `${id} result`,
        value,
        outOf: 20,
        coefficient: 1,
        passedAt: new Date("2026-02-01T12:00:00Z"),
        createdAt: new Date("2026-02-01T12:00:00Z"),
        subjectId: id,
        periodId: null,
        components: [],
      },
    ],
  };
}

describe("averageAnalytics", () => {
  const graph = new SubjectGraph([
    subject("mathematics", 16, 2),
    subject("history", 10, 1),
    subject("arts", 20, 1),
  ]);

  test("resolves the general composition, statistics and impacts", () => {
    const result = averageAnalytics(graph, "general", [], 0.5);

    expect(result?.custom).toBeNull();
    expect(result?.ratio).toBeCloseTo(0.775);
    expect(result?.composition.map((item) => item.subject.id)).toEqual([
      "arts",
      "history",
      "mathematics",
    ]);
    expect(result?.grades).toHaveLength(3);
    expect(result?.impacts).toHaveLength(3);
    expect(result?.passRate).toBe(1);
  });

  test("honours a custom subset and its coefficient overrides", () => {
    const custom: CustomAverage = {
      id: "scientific",
      name: "Scientific",
      isMain: true,
      sortOrder: 0,
      entries: [
        {
          subjectId: "mathematics",
          coefficient: 3,
          includeChildren: false,
        },
        {
          subjectId: "arts",
          coefficient: 1,
          includeChildren: false,
        },
      ],
    };

    const result = averageAnalytics(graph, custom.id, [custom], 0.5);

    expect(result?.ratio).toBeCloseTo(0.85);
    expect(result?.composition.map((item) => item.coefficient)).toEqual([3, 1]);
    expect(result?.grades.map((grade) => grade.subjectId).sort()).toEqual([
      "arts",
      "mathematics",
    ]);
    expect(result?.impacts.map((item) => item.subject.id).sort()).toEqual([
      "arts",
      "mathematics",
    ]);
  });

  test("rejects an average that is not in the current snapshot", () => {
    expect(averageAnalytics(graph, "deleted", [], 0.5)).toBeNull();
  });
});
