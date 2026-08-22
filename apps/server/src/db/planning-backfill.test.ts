import { expect, test } from "bun:test";
import { planningBackfillValue } from "./planning-backfill";
import type { plannerItems } from "./schema";

type LegacyPlannerItem = typeof plannerItems.$inferSelect;

const base = {
  id: "legacy-1",
  title: "Legacy",
  notes: null,
  startsAt: new Date("2027-02-01T09:00:00.000Z"),
  endsAt: null,
  allDay: true,
  status: "todo",
  completedAt: null,
  subjectId: null,
  sortOrder: 2,
  yearId: "year-1",
  userId: "user-1",
  createdAt: new Date("2027-01-01T00:00:00.000Z"),
  updatedAt: new Date("2027-01-01T00:00:00.000Z"),
} satisfies Omit<LegacyPlannerItem, "kind">;

test("maps a legacy task to a due personal task with the same identity", () => {
  const mapped = planningBackfillValue({ ...base, kind: "task" });
  expect(mapped.target).toBe("task");
  if (mapped.target !== "task") throw new Error("Expected a task mapping");
  expect(mapped.values).toMatchObject({
    id: base.id,
    dueAt: base.startsAt,
    scheduledAt: null,
    syncState: "detached",
  });
});

test("maps a legacy event to an explicit UTC calendar event", () => {
  const mapped = planningBackfillValue({ ...base, kind: "event" });
  expect(mapped.target).toBe("event");
  if (mapped.target !== "event") throw new Error("Expected an event mapping");
  expect(mapped.values).toMatchObject({
    id: base.id,
    startsAt: base.startsAt,
    timezone: "UTC",
    syncState: "detached",
  });
});
