import { eq } from "drizzle-orm";
import { calendarEvents, plannerItems, planningTasks } from "./schema";

type LegacyPlannerItem = typeof plannerItems.$inferSelect;

export type PlanningBackfillValue =
  | {
      target: "task";
      values: typeof planningTasks.$inferInsert;
    }
  | {
      target: "event";
      values: typeof calendarEvents.$inferInsert;
    }
  | { target: "skip"; id: string; reason: string };

/**
 * Deterministic row mapping kept outside generated migrations. Run the
 * backfill only after the planning tables have been migrated into the target
 * database. Source rows intentionally remain for the legacy `planner` API.
 */
export function planningBackfillValue(
  row: LegacyPlannerItem,
): PlanningBackfillValue {
  if (row.kind === "task") {
    return {
      target: "task",
      values: {
        id: row.id,
        title: row.title,
        notes: row.notes,
        localNote: null,
        scheduledAt: null,
        dueAt: row.startsAt,
        status: row.status,
        completedAt: row.completedAt,
        subjectId: row.subjectId,
        sortOrder: row.sortOrder,
        yearId: row.yearId,
        userId: row.userId,
        syncState: "detached",
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      },
    };
  }
  if (!row.startsAt) {
    return {
      target: "skip",
      id: row.id,
      reason: "Legacy event has no start date",
    };
  }
  return {
    target: "event",
    values: {
      id: row.id,
      eventKind: "event",
      title: row.title,
      description: row.notes,
      localNote: null,
      startsAt: row.startsAt,
      endsAt: row.endsAt,
      allDay: row.allDay,
      timezone: "UTC",
      location: null,
      subjectId: row.subjectId,
      yearId: row.yearId,
      userId: row.userId,
      syncState: "detached",
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    },
  };
}

/** Idempotent compatibility backfill; same ids suppress duplicates in v2 reads. */
export async function backfillLegacyPlannerItems() {
  const { db } = await import(".");
  const rows = await db.select().from(plannerItems);
  let tasks = 0;
  let events = 0;
  const skipped: Array<{ id: string; reason: string }> = [];
  for (const row of rows) {
    const mapped = planningBackfillValue(row);
    if (mapped.target === "skip") {
      skipped.push({ id: mapped.id, reason: mapped.reason });
      continue;
    }
    if (mapped.target === "task") {
      const inserted = await db
        .insert(planningTasks)
        .values(mapped.values)
        .onConflictDoNothing()
        .returning({ id: planningTasks.id });
      tasks += inserted.length;
      continue;
    }
    const inserted = await db
      .insert(calendarEvents)
      .values(mapped.values)
      .onConflictDoNothing()
      .returning({ id: calendarEvents.id });
    events += inserted.length;
  }
  return { tasks, events, skipped };
}

/** Useful to verify a particular legacy id after an operational backfill. */
export async function planningBackfillTargetExists(
  item: Pick<LegacyPlannerItem, "id" | "kind">,
) {
  const { db } = await import(".");
  const [row] =
    item.kind === "task"
      ? await db
          .select({ id: planningTasks.id })
          .from(planningTasks)
          .where(eq(planningTasks.id, item.id))
          .limit(1)
      : await db
          .select({ id: calendarEvents.id })
          .from(calendarEvents)
          .where(eq(calendarEvents.id, item.id))
          .limit(1);
  return Boolean(row);
}
