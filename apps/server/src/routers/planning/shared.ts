import {
  isIsoDate,
  isValidTimeZone,
  lockedPlanningFields,
  planningManagement,
  type PlanningResourceKind,
  type PlanningSyncState,
} from "@avermate/core/planning";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  academicAssignments,
  calendarEvents,
  planningTasks,
  syncConnections,
  timetableOccurrences,
  timetableSeries,
} from "../../db/schema";
import { assertSameYear } from "../../lib/domain-integrity";
import { badRequest, notFound } from "../../lib/orpc";
import { requireSubject, requireYear } from "../../lib/ownership";

export const idSchema = z.string().min(1);
export const titleSchema = z.string().trim().min(1).max(160);
export const optionalTextSchema = z.string().trim().max(10_000).nullable();
export const localNoteSchema = z.string().trim().max(4_000).nullable();
export const dateOnlySchema = z
  .string()
  .refine(isIsoDate, "Expected a valid ISO date (YYYY-MM-DD)");
export const timezoneSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .refine(isValidTimeZone, "Expected a valid IANA timezone");
export const taskStatusSchema = z.enum(["todo", "doing", "done"]);
export const syncStateSchema = z.enum([
  "managed",
  "detached",
  "missing",
  "dismissed",
]);

type ManagedRow = {
  sourceConnectionId: string | null;
  externalId: string | null;
  syncState: PlanningSyncState;
};

export interface PlanningConnectionInfo {
  provider: string;
  providerLabel: string;
}

export type PlanningConnectionInfoMap = ReadonlyMap<
  string,
  PlanningConnectionInfo
>;

export async function loadPlanningConnectionInfo(userId: string) {
  const rows = await db
    .select({
      id: syncConnections.id,
      provider: syncConnections.provider,
      providerLabel: syncConnections.label,
    })
    .from(syncConnections)
    .where(eq(syncConnections.userId, userId));
  return new Map(rows.map(({ id, ...info }) => [id, info] as const));
}

export function managementOf(
  kind: PlanningResourceKind,
  row: ManagedRow,
  connections?: PlanningConnectionInfoMap,
) {
  const connection = row.sourceConnectionId
    ? connections?.get(row.sourceConnectionId)
    : undefined;
  return planningManagement(kind, {
    ...row,
    provider: connection?.provider ?? null,
    providerLabel: connection?.providerLabel ?? null,
  });
}

export function assertEditablePatch(
  kind: PlanningResourceKind,
  row: ManagedRow,
  patch: Record<string, unknown>,
) {
  const fields = Object.entries(patch)
    .filter(([, value]) => value !== undefined)
    .map(([field]) => field);
  const locked = lockedPlanningFields(kind, row, fields);
  if (locked.length > 0) {
    badRequest(
      `Provider-managed ${kind} fields are locked: ${locked.join(", ")}. Detach the item before editing them.`,
    );
  }
}

export function assertManaged(row: ManagedRow, label: string) {
  const management = planningManagement("event", row);
  if (management.mode !== "provider") {
    badRequest(`${label} is already user-managed`);
  }
  if (row.syncState === "dismissed") {
    badRequest(`${label} is already dismissed`);
  }
}

export function publicTask(
  row: typeof planningTasks.$inferSelect,
  connections?: PlanningConnectionInfoMap,
) {
  const { userId: _userId, ...visible } = row;
  return { ...visible, management: managementOf("task", row, connections) };
}

export function publicAssignment(
  row: typeof academicAssignments.$inferSelect,
  connections?: PlanningConnectionInfoMap,
) {
  const { userId: _userId, ...visible } = row;
  return {
    ...visible,
    completed: row.completedAt !== null,
    management: managementOf("assignment", row, connections),
  };
}

export function publicEvent(
  row: typeof calendarEvents.$inferSelect,
  connections?: PlanningConnectionInfoMap,
) {
  const { userId: _userId, ...visible } = row;
  return { ...visible, management: managementOf("event", row, connections) };
}

export function publicSeries(
  row: typeof timetableSeries.$inferSelect,
  connections?: PlanningConnectionInfoMap,
) {
  const {
    userId: _userId,
    recurrenceFrequency,
    recurrenceInterval,
    recurrenceWeekdays,
    ...visible
  } = row;
  return {
    ...visible,
    recurrence: {
      frequency: recurrenceFrequency,
      interval: recurrenceInterval,
      weekdays: recurrenceWeekdays,
    },
    management: managementOf("lesson", row, connections),
  };
}

export function publicOccurrence(
  row: typeof timetableOccurrences.$inferSelect,
  connections?: PlanningConnectionInfoMap,
) {
  const { userId: _userId, ...visible } = row;
  return { ...visible, management: managementOf("lesson", row, connections) };
}

export async function validatePlanningScope(input: {
  userId: string;
  yearId: string;
  subjectId: string | null;
}) {
  await requireYear(input.userId, input.yearId);
  if (!input.subjectId) return;
  const subject = await requireSubject(input.userId, input.subjectId);
  assertSameYear("Planning subject", input.yearId, subject.yearId);
}

export async function requirePlanningTask(
  userId: string,
  id: string,
  options: { includeTrashed?: boolean } = {},
) {
  const [row] = await db
    .select()
    .from(planningTasks)
    .where(
      and(
        eq(planningTasks.id, id),
        eq(planningTasks.userId, userId),
        options.includeTrashed ? undefined : isNull(planningTasks.trashedAt),
      ),
    )
    .limit(1);
  if (!row) notFound("Planning task");
  return row;
}

export async function requireAssignment(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(academicAssignments)
    .where(
      and(
        eq(academicAssignments.id, id),
        eq(academicAssignments.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Academic assignment");
  return row;
}

export async function requireCalendarEvent(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(calendarEvents)
    .where(and(eq(calendarEvents.id, id), eq(calendarEvents.userId, userId)))
    .limit(1);
  if (!row) notFound("Calendar event");
  return row;
}

export async function requireTimetableSeries(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(timetableSeries)
    .where(and(eq(timetableSeries.id, id), eq(timetableSeries.userId, userId)))
    .limit(1);
  if (!row) notFound("Timetable series");
  return row;
}

export async function requireTimetableOccurrence(userId: string, id: string) {
  const [row] = await db
    .select()
    .from(timetableOccurrences)
    .where(
      and(
        eq(timetableOccurrences.id, id),
        eq(timetableOccurrences.userId, userId),
      ),
    )
    .limit(1);
  if (!row) notFound("Timetable occurrence");
  return row;
}

export function assertWindow(startsAt: Date, endsAt: Date | null) {
  if (endsAt && endsAt < startsAt) {
    badRequest("The item cannot end before it starts");
  }
}

export function assertActive(row: ManagedRow, label: string) {
  if (row.syncState === "dismissed") badRequest(`${label} is dismissed`);
  if (row.syncState === "missing") badRequest(`${label} is missing upstream`);
}
