import {
  and,
  asc,
  eq,
  gte,
  isNotNull,
  isNull,
  lte,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  goals,
  grades,
  periods,
  plannerItems,
} from "../db/schema";
import { assertSameYear } from "../lib/domain-integrity";
import { badRequest, protectedProcedure } from "../lib/orpc";
import {
  requirePlannerItem,
  requireSubject,
  requireYear,
} from "../lib/ownership";

const kindSchema = z.enum(["task", "event"]);
const statusSchema = z.enum(["todo", "doing", "done"]);
const itemFields = {
  kind: kindSchema,
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(2_000).nullable(),
  startsAt: z.coerce.date().nullable(),
  endsAt: z.coerce.date().nullable(),
  allDay: z.boolean(),
  subjectId: z.string().min(1).nullable(),
};
const plannerItemCreateInput = z.object({
  kind: itemFields.kind.default("task"),
  title: itemFields.title,
  notes: itemFields.notes.default(null),
  startsAt: itemFields.startsAt.default(null),
  endsAt: itemFields.endsAt.default(null),
  allDay: itemFields.allDay.default(true),
  subjectId: itemFields.subjectId.default(null),
  yearId: z.string().min(1),
});
const plannerItemPatchInput = z
  .object({
    itemId: z.string().min(1),
    kind: itemFields.kind.optional(),
    title: itemFields.title.optional(),
    notes: itemFields.notes.optional(),
    startsAt: itemFields.startsAt.optional(),
    endsAt: itemFields.endsAt.optional(),
    allDay: itemFields.allDay.optional(),
    subjectId: itemFields.subjectId.optional(),
  })
  .refine(
    ({ itemId: _itemId, ...patch }) =>
      Object.values(patch).some((value) => value !== undefined),
    { message: "At least one planner field must change" },
  );

const listInput = z
  .object({
    yearId: z.string().min(1),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    includeCompleted: z.boolean().default(false),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "The planner window must end after it starts",
  });

async function validatePlannerScope(input: {
  userId: string;
  yearId: string;
  kind: "task" | "event";
  startsAt: Date | null;
  endsAt: Date | null;
  subjectId: string | null;
}) {
  if (input.kind === "task" && input.endsAt) {
    badRequest("A task cannot have an end date");
  }
  if (input.kind === "event" && !input.startsAt) {
    badRequest("An event requires a start date");
  }
  if (
    input.startsAt &&
    input.endsAt &&
    input.endsAt.getTime() < input.startsAt.getTime()
  ) {
    badRequest("An event cannot end before it starts");
  }
  if (input.subjectId) {
    const subject = await requireSubject(input.userId, input.subjectId);
    assertSameYear("Planner subject", input.yearId, subject.yearId);
  }
}

function plannerWindowConditions(from?: Date, to?: Date) {
  if (!from && !to) return undefined;
  return and(
    isNotNull(plannerItems.startsAt),
    to ? lte(plannerItems.startsAt, to) : undefined,
    from
      ? or(
          gte(plannerItems.endsAt, from),
          and(isNull(plannerItems.endsAt), gte(plannerItems.startsAt, from)),
        )
      : undefined,
  );
}

export const plannerRouter = {
  list: protectedProcedure
    .input(listInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      return db
        .select()
        .from(plannerItems)
        .where(
          and(
            eq(plannerItems.userId, userId),
            eq(plannerItems.yearId, input.yearId),
            input.includeCompleted
              ? undefined
              : ne(plannerItems.status, "done"),
            plannerWindowConditions(input.from, input.to),
          ),
        )
        .orderBy(
          sql`${plannerItems.startsAt} is null`,
          asc(plannerItems.startsAt),
          asc(plannerItems.sortOrder),
          asc(plannerItems.createdAt),
        );
    }),

  create: protectedProcedure
    .input(plannerItemCreateInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      await validatePlannerScope({ userId, ...input });
      const existing = await db
        .select({ sortOrder: plannerItems.sortOrder })
        .from(plannerItems)
        .where(
          and(
            eq(plannerItems.userId, userId),
            eq(plannerItems.yearId, input.yearId),
            eq(plannerItems.status, "todo"),
          ),
        );
      const [created] = await db
        .insert(plannerItems)
        .values({
          ...input,
          status: "todo",
          completedAt: null,
          sortOrder: existing.reduce(
            (maximum, item) => Math.max(maximum, item.sortOrder + 1),
            0,
          ),
          userId,
        })
        .returning();
      return created;
    }),

  update: protectedProcedure
    .input(plannerItemPatchInput)
    .handler(async ({ context, input }) => {
      const { itemId, ...patch } = input;
      const userId = context.session.user.id;
      const existing = await requirePlannerItem(userId, itemId);
      const next = {
        kind: patch.kind ?? existing.kind,
        startsAt:
          patch.startsAt !== undefined ? patch.startsAt : existing.startsAt,
        endsAt: patch.endsAt !== undefined ? patch.endsAt : existing.endsAt,
        subjectId:
          patch.subjectId !== undefined
            ? patch.subjectId
            : existing.subjectId,
      };
      await validatePlannerScope({
        userId,
        yearId: existing.yearId,
        ...next,
      });
      const normalizeEvent = next.kind === "event";
      const [updated] = await db
        .update(plannerItems)
        .set({
          ...patch,
          ...(normalizeEvent ? { status: "todo" as const } : {}),
          ...(normalizeEvent ? { completedAt: null } : {}),
          updatedAt: new Date(),
        })
        .where(eq(plannerItems.id, itemId))
        .returning();
      return updated;
    }),

  setStatus: protectedProcedure
    .input(z.object({ itemId: z.string().min(1), status: statusSchema }))
    .handler(async ({ context, input }) => {
      const existing = await requirePlannerItem(
        context.session.user.id,
        input.itemId,
      );
      if (existing.kind !== "task") {
        badRequest("An event cannot move through task statuses");
      }
      if (existing.status === input.status) return existing;
      const [updated] = await db
        .update(plannerItems)
        .set({
          status: input.status,
          completedAt:
            input.status === "done"
              ? existing.completedAt ?? new Date()
              : null,
          updatedAt: new Date(),
        })
        .where(eq(plannerItems.id, input.itemId))
        .returning();
      return updated;
    }),

  moveInBoard: protectedProcedure
    .input(
      z.object({
        itemId: z.string().min(1),
        status: statusSchema,
        beforeId: z.string().min(1).nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requirePlannerItem(userId, input.itemId);
      if (existing.kind !== "task") {
        badRequest("Only tasks can move on the board");
      }
      if (input.beforeId === input.itemId) {
        badRequest("A task cannot be placed before itself");
      }

      const targetRows = await db
        .select({ id: plannerItems.id })
        .from(plannerItems)
        .where(
          and(
            eq(plannerItems.userId, userId),
            eq(plannerItems.yearId, existing.yearId),
            eq(plannerItems.kind, "task"),
            eq(plannerItems.status, input.status),
          ),
        )
        .orderBy(asc(plannerItems.sortOrder), asc(plannerItems.createdAt));
      const targetIds = targetRows
        .map((row) => row.id)
        .filter((id) => id !== existing.id);
      const beforeIndex = input.beforeId
        ? targetIds.indexOf(input.beforeId)
        : targetIds.length;
      if (input.beforeId && beforeIndex < 0) {
        badRequest("The target task must be in the destination lane");
      }
      targetIds.splice(beforeIndex, 0, existing.id);

      const sourceRows =
        existing.status === input.status
          ? []
          : await db
              .select({ id: plannerItems.id })
              .from(plannerItems)
              .where(
                and(
                  eq(plannerItems.userId, userId),
                  eq(plannerItems.yearId, existing.yearId),
                  eq(plannerItems.kind, "task"),
                  eq(plannerItems.status, existing.status),
                  ne(plannerItems.id, existing.id),
                ),
              )
              .orderBy(
                asc(plannerItems.sortOrder),
                asc(plannerItems.createdAt),
              );
      const now = new Date();
      const statements = [
        ...targetIds.map((id, sortOrder) =>
          db
            .update(plannerItems)
            .set({
              sortOrder,
              ...(id === existing.id
                ? {
                    status: input.status,
                    completedAt:
                      input.status === "done"
                        ? existing.completedAt ?? now
                        : null,
                  }
                : {}),
              updatedAt: now,
            })
            .where(eq(plannerItems.id, id)),
        ),
        ...sourceRows.map((row, sortOrder) =>
          db
            .update(plannerItems)
            .set({ sortOrder, updatedAt: now })
            .where(eq(plannerItems.id, row.id)),
        ),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      return requirePlannerItem(userId, existing.id);
    }),

  delete: protectedProcedure
    .input(z.object({ itemId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      await requirePlannerItem(context.session.user.id, input.itemId);
      await db.delete(plannerItems).where(eq(plannerItems.id, input.itemId));
      return { ok: true };
    }),

  agenda: protectedProcedure
    .input(
      z.object({
        yearId: z.string().min(1),
        from: z.coerce.date(),
        to: z.coerce.date(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      const windowMs = input.to.getTime() - input.from.getTime();
      if (windowMs < 0) badRequest("The agenda window is inverted");
      if (windowMs > 62 * 86_400_000) {
        badRequest("The agenda window cannot exceed 62 days");
      }

      const [authored, goalRows, gradeRows, periodRows] = await Promise.all([
        db
          .select()
          .from(plannerItems)
          .where(
            and(
              eq(plannerItems.userId, userId),
              eq(plannerItems.yearId, input.yearId),
              isNotNull(plannerItems.startsAt),
              lte(plannerItems.startsAt, input.to),
              or(
                gte(plannerItems.endsAt, input.from),
                and(
                  isNull(plannerItems.endsAt),
                  gte(plannerItems.startsAt, input.from),
                ),
              ),
            ),
          ),
        db
          .select()
          .from(goals)
          .where(
            and(
              eq(goals.userId, userId),
              eq(goals.yearId, input.yearId),
              isNotNull(goals.dueAt),
              gte(goals.dueAt, input.from),
              lte(goals.dueAt, input.to),
            ),
          ),
        db
          .select()
          .from(grades)
          .where(
            and(
              eq(grades.userId, userId),
              eq(grades.yearId, input.yearId),
              gte(grades.passedAt, input.from),
              lte(grades.passedAt, input.to),
            ),
          ),
        db
          .select()
          .from(periods)
          .where(
            and(
              eq(periods.userId, userId),
              eq(periods.yearId, input.yearId),
              lte(periods.startAt, input.to),
              gte(periods.endAt, input.from),
            ),
          ),
      ]);

      return [
        ...authored.map((item) => ({
          id: item.id,
          source: "planner" as const,
          kind: item.kind,
          title: item.title,
          startsAt: item.startsAt as Date,
          endsAt: item.endsAt,
          allDay: item.allDay,
          ...(item.kind === "task" ? { status: item.status } : {}),
          completed: item.kind === "task" && item.completedAt !== null,
          subjectId: item.subjectId,
          referenceId: item.id,
          href: `/agenda/${item.id}/edit`,
        })),
        ...goalRows.map((goal) => ({
          id: goal.id,
          source: "goal" as const,
          kind: "goal" as const,
          title: goal.name,
          startsAt: goal.dueAt as Date,
          endsAt: null,
          allDay: true,
          completed: goal.achievedAt !== null,
          subjectId: goal.kind === "subject" ? goal.referenceId : null,
          referenceId: goal.id,
          href: "/goals",
        })),
        ...gradeRows.map((grade) => ({
          id: grade.id,
          source: "grade" as const,
          kind: "grade" as const,
          title: grade.name,
          startsAt: grade.passedAt,
          endsAt: null,
          allDay: true,
          completed: true,
          subjectId: grade.subjectId,
          referenceId: grade.id,
          href: `/grades/${grade.id}`,
        })),
        ...periodRows.map((period) => ({
          id: period.id,
          source: "period" as const,
          kind: "period" as const,
          title: period.name,
          startsAt: period.startAt,
          endsAt: period.endAt,
          allDay: true,
          completed: period.endAt.getTime() < Date.now(),
          subjectId: null,
          referenceId: period.id,
          href: "/settings/year",
        })),
      ].sort(
        (left, right) =>
          left.startsAt.getTime() - right.startsAt.getTime() ||
          left.source.localeCompare(right.source) ||
          left.id.localeCompare(right.id),
      );
    }),
};
