import { describe, expect, test } from "bun:test";
import { SubjectGraph } from "@avermate/core";
import {
  clampTimelineDay,
  dayAtOffset,
  subjectsAtTimelineDay,
  timelineBounds,
} from "./timeline";

const year = {
  startsAt: new Date(2025, 8, 1),
  endsAt: new Date(2026, 5, 30),
};

describe("identity/year-safe semantic time travel", () => {
  test("clamps dates to the selected school year and current day", () => {
    const now = new Date(2026, 0, 15, 12).getTime();
    expect(clampTimelineDay("2024-01-01", year, now)).toBe("2025-09-01");
    expect(clampTimelineDay("2027-01-01", year, now)).toBe("2026-01-15");
    expect(clampTimelineDay("invalid", year, now)).toBeNull();
    expect(dayAtOffset(year, now, 999)).toBe("2026-01-15");
    expect(timelineBounds(year, now).totalDays).toBeGreaterThan(100);
  });

  test("removes future grades from the one graph every screen consumes", () => {
    const grade = (id: string, day: string) => ({
      id,
      name: id,
      value: 10,
      outOf: 20,
      coefficient: 1,
      passedAt: new Date(`${day}T12:00:00`),
      createdAt: new Date(`${day}T12:00:00`),
      subjectId: "subject",
      periodId: null,
      components: [],
    });
    const visible = subjectsAtTimelineDay(
      [
        {
          id: "subject",
          name: "Subject",
          shortName: null,
          parentId: null,
          coefficient: 1,
          kind: "subject",
          isMain: true,
          sortOrder: 0,
          grades: [grade("past", "2025-10-01"), grade("future", "2025-10-03")],
        },
      ],
      "2025-10-02",
    );
    const graph = new SubjectGraph(visible);
    expect(graph.allGrades().map((item) => item.id)).toEqual(["past"]);
  });
});
