import { describe, expect, test } from "bun:test";
import { SubjectGraph, type Grade, type Subject } from "@avermate/core";
import {
  addMonths,
  asGradesView,
  dayKey,
  gradeTableRows,
  groupGradesByDay,
  latestGradeDay,
  monthMatrix,
  monthResultDays,
  newestFirst,
  startOfMonth,
} from "./grade-views";

function grade(id: string, subjectId: string, passedAt: Date): Grade {
  return {
    id,
    name: `${id} test`,
    value: 12,
    outOf: 20,
    coefficient: 1,
    passedAt,
    createdAt: passedAt,
    subjectId,
    periodId: null,
    components: [],
  };
}

function subject(id: string, overrides: Partial<Subject> = {}): Subject {
  return {
    id,
    name: id,
    shortName: null,
    parentId: null,
    coefficient: 1,
    kind: "subject",
    isMain: false,
    sortOrder: 0,
    grades: [],
    ...overrides,
  };
}

describe("asGradesView", () => {
  test("keeps the two non-default views", () => {
    expect(asGradesView("table")).toBe("table");
    expect(asGradesView("calendar")).toBe("calendar");
  });

  test("narrows anything else to the timeline", () => {
    expect(asGradesView("timeline")).toBe("timeline");
    expect(asGradesView("nonsense")).toBe("timeline");
    expect(asGradesView(null)).toBe("timeline");
    expect(asGradesView(undefined)).toBe("timeline");
  });
});

describe("dayKey", () => {
  test("uses the local day, zero-padded", () => {
    expect(dayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 11, 31))).toBe("2026-12-31");
  });

  test("keeps a late-evening date on its local day", () => {
    // toISOString would shift this into the next (or previous) UTC day in
    // most timezones; the key must not.
    expect(dayKey(new Date(2026, 0, 5, 23, 30))).toBe("2026-01-05");
    expect(dayKey(new Date(2026, 0, 5, 0, 15))).toBe("2026-01-05");
  });
});

describe("groupGradesByDay", () => {
  test("buckets grades by local day, preserving order within a day", () => {
    const first = grade("a", "maths", new Date(2026, 2, 10, 8, 0));
    const second = grade("b", "maths", new Date(2026, 2, 10, 14, 0));
    const other = grade("c", "maths", new Date(2026, 2, 11, 9, 0));

    const byDay = groupGradesByDay([first, second, other]);

    expect([...byDay.keys()]).toEqual(["2026-03-10", "2026-03-11"]);
    expect(byDay.get("2026-03-10")?.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("month arithmetic", () => {
  test("startOfMonth lands on the first at local midnight", () => {
    const start = startOfMonth(new Date(2026, 7, 15, 13, 45));
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(7);
    expect(start.getDate()).toBe(1);
    expect(start.getHours()).toBe(0);
  });

  test("addMonths never clamps because it works on month starts", () => {
    const january = new Date(2026, 0, 1);
    expect(addMonths(january, 1).getMonth()).toBe(1);
    expect(addMonths(january, -1).getFullYear()).toBe(2025);
    expect(addMonths(january, -1).getMonth()).toBe(11);
    expect(addMonths(new Date(2026, 11, 1), 1).getFullYear()).toBe(2027);
  });
});

describe("monthMatrix", () => {
  test("stays rectangular: every row is a full week", () => {
    for (const weekStartsOn of [0, 1] as const) {
      const weeks = monthMatrix(new Date(2026, 7, 1), weekStartsOn);
      for (const week of weeks) expect(week).toHaveLength(7);
    }
  });

  test("covers every day of the month exactly once", () => {
    const weeks = monthMatrix(new Date(2026, 7, 1), 1);
    const august = weeks
      .flat()
      .filter((day) => day.getMonth() === 7 && day.getFullYear() === 2026);
    expect(august).toHaveLength(31);
    expect(new Set(august.map((day) => day.getDate())).size).toBe(31);
  });

  test("starts each week on the requested weekday", () => {
    // February 2026 starts on a Sunday.
    const mondayFirst = monthMatrix(new Date(2026, 1, 1), 1);
    expect(mondayFirst[0]?.[0]?.getDay()).toBe(1);
    expect(dayKey(mondayFirst[0]?.[0] as Date)).toBe("2026-01-26");

    const sundayFirst = monthMatrix(new Date(2026, 1, 1), 0);
    expect(sundayFirst[0]?.[0]?.getDay()).toBe(0);
    expect(dayKey(sundayFirst[0]?.[0] as Date)).toBe("2026-02-01");
  });

  test("uses no filler week when the month already fills the grid", () => {
    // February 2026, Sunday-first: 1st is a Sunday and the 28th a Saturday.
    const weeks = monthMatrix(new Date(2026, 1, 1), 0);
    expect(weeks).toHaveLength(4);
    expect(dayKey(weeks.at(-1)?.at(-1) as Date)).toBe("2026-02-28");
  });
});

describe("monthResultDays", () => {
  test("counts in-month days with results, ignoring leading spill", () => {
    const month = new Date(2026, 1, 1);
    const weeks = monthMatrix(month, 1);
    const byDay = groupGradesByDay([
      grade("outside", "maths", new Date(2026, 0, 26)),
      grade("morning", "maths", new Date(2026, 1, 3, 9, 0)),
      grade("evening", "maths", new Date(2026, 1, 3, 18, 0)),
      grade("later", "maths", new Date(2026, 1, 20)),
    ]);

    expect(monthResultDays(weeks, byDay, month)).toBe(2);
  });
});

describe("latestGradeDay", () => {
  const fallback = new Date(2026, 7, 15);

  test("returns the most recent result's day", () => {
    const latest = latestGradeDay(
      [
        grade("old", "maths", new Date(2026, 1, 2)),
        grade("new", "maths", new Date(2026, 5, 9)),
        grade("mid", "maths", new Date(2026, 3, 1)),
      ],
      fallback,
    );
    expect(dayKey(latest)).toBe("2026-06-09");
  });

  test("falls back when there is nothing", () => {
    expect(latestGradeDay([], fallback)).toBe(fallback);
  });
});

describe("gradeTableRows", () => {
  const graph = new SubjectGraph([
    subject("sciences", { kind: "category", sortOrder: 0 }),
    subject("maths", {
      parentId: "sciences",
      sortOrder: 0,
      grades: [grade("algebra", "maths", new Date(2026, 2, 3))],
    }),
    subject("physics", {
      parentId: "sciences",
      sortOrder: 1,
      grades: [grade("optics", "physics", new Date(2026, 2, 5))],
    }),
    subject("history", { sortOrder: 1 }),
  ]);

  test("walks the hierarchy in display order with depths", () => {
    const rows = gradeTableRows(graph, "");
    expect(rows.map((row) => row.subject.id)).toEqual([
      "sciences",
      "maths",
      "physics",
      "history",
    ]);
    expect(rows.map((row) => row.depth)).toEqual([0, 1, 1, 0]);
  });

  test("matches on the subject name", () => {
    const rows = gradeTableRows(graph, "  HIST ");
    expect(rows.map((row) => row.subject.id)).toEqual(["history"]);
  });

  test("keeps a subject whose grade name matches", () => {
    const rows = gradeTableRows(graph, "optics");
    expect(rows.map((row) => row.subject.id)).toEqual(["physics"]);
  });

  test("returns nothing when nothing matches", () => {
    expect(gradeTableRows(graph, "chemistry")).toEqual([]);
  });
});

describe("newestFirst", () => {
  test("sorts by date descending without touching the input", () => {
    const input = [
      grade("old", "maths", new Date(2026, 0, 5)),
      grade("new", "maths", new Date(2026, 4, 5)),
      grade("mid", "maths", new Date(2026, 2, 5)),
    ];
    const sorted = newestFirst(input);

    expect(sorted.map((item) => item.id)).toEqual(["new", "mid", "old"]);
    expect(input.map((item) => item.id)).toEqual(["old", "new", "mid"]);
  });
});
