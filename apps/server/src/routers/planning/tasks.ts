import { planningManagement } from "@avermate/core/planning";
import { and, asc, desc, eq, inArray, ne, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { planningTasks } from "../../db/schema";
import { badRequest, protectedProcedure } from "../../lib/orpc";
import {
  assertActive,
  assertEditablePatch,
  assertManaged,
  idSchema,
  localNoteSchema,
  loadPlanningConnectionInfo,
  optionalTextSchema,
  publicTask,
  requirePlanningTask,
  taskStatusSchema,
  titleSchema,
  validatePlanningScope,
} from "./shared";

const taskFields = {
  title: titleSchema,
  notes: optionalTextSchema,
  localNote: localNoteSchema,
  startsAt: z.coerce.date().nullable(),
  scheduledAt: z.coerce.date().nullable(),
  dueAt: z.coerce.date().nullable(),
  subjectId: idSchema.nullable(),
};

const createInput = z.object({
  yearId: idSchema,
  title: taskFields.title,
  notes: taskFields.notes.default(null),
  localNote: taskFields.localNote.default(null),
  startsAt: taskFields.startsAt.default(null),
  scheduledAt: taskFields.scheduledAt.default(null),
  dueAt: taskFields.dueAt.default(null),
  subjectId: taskFields.subjectId.default(null),
});

const updateInput = z
  .object({
    taskId: idSchema,
    title: taskFields.title.optional(),
    notes: taskFields.notes.optional(),
    localNote: taskFields.localNote.optional(),
    startsAt: taskFields.startsAt.optional(),
    scheduledAt: taskFields.scheduledAt.optional(),
    dueAt: taskFields.dueAt.optional(),
    subjectId: taskFields.subjectId.optional(),
  })
  .refine(
    ({ taskId: _taskId, ...patch }) =>
      Object.values(patch).some((value) => value !== undefined),
    "At least one task field must change",
  );

function assertTaskDates(
  startsAt: Date | null,
  scheduledAt: Date | null,
  dueAt: Date | null,
) {
  if (startsAt && dueAt && dueAt < startsAt) {
    badRequest("A task cannot start after its due date");
  }
  if (scheduledAt && dueAt && dueAt < scheduledAt) {
    badRequest("A task cannot be due before its scheduled time");
  }
}

export const planningTasksRouter = {
  list: protectedProcedure
    .input(
      z.object({
        yearId: idSchema,
        includeCompleted: z.boolean().default(false),
        includeMissing: z.boolean().default(false),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await validatePlanningScope({
        userId,
        yearId: input.yearId,
        subjectId: null,
      });
      const rows = await db
        .select()
        .from(planningTasks)
        .where(
          and(
            eq(planningTasks.userId, userId),
            eq(planningTasks.yearId, input.yearId),
            input.includeCompleted
              ? undefined
              : ne(planningTasks.status, "done"),
            input.includeMissing
              ? ne(planningTasks.syncState, "dismissed")
              : inArray(planningTasks.syncState, ["managed", "detached"]),
          ),
        )
        .orderBy(
          asc(planningTasks.status),
          asc(planningTasks.sortOrder),
          asc(planningTasks.createdAt),
        );
      const connections = await loadPlanningConnectionInfo(userId);
      return rows.map((row) => publicTask(row, connections));
    }),

  create: protectedProcedure
    .input(createInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await validatePlanningScope({ userId, ...input });
      assertTaskDates(input.startsAt, input.scheduledAt, input.dueAt);
      const [last] = await db
        .select({ sortOrder: planningTasks.sortOrder })
        .from(planningTasks)
        .where(
          and(
            eq(planningTasks.userId, userId),
            eq(planningTasks.yearId, input.yearId),
            eq(planningTasks.status, "todo"),
          ),
        )
        .orderBy(desc(planningTasks.sortOrder))
        .limit(1);
      const [created] = await db
        .insert(planningTasks)
        .values({
          ...input,
          sortOrder: (last?.sortOrder ?? -1) + 1,
          syncState: "detached",
          userId,
        })
        .returning();
      return publicTask(created!);
    }),

  update: protectedProcedure
    .input(updateInput)
    .handler(async ({ context, input }) => {
      const { taskId, ...patch } = input;
      const userId = context.session.user.id;
      const existing = await requirePlanningTask(userId, taskId);
      assertActive(existing, "Planning task");
      assertEditablePatch("task", existing, patch);
      const scheduledAt =
        patch.scheduledAt === undefined
          ? existing.scheduledAt
          : patch.scheduledAt;
      const startsAt =
        patch.startsAt === undefined ? existing.startsAt : patch.startsAt;
      const dueAt = patch.dueAt === undefined ? existing.dueAt : patch.dueAt;
      assertTaskDates(startsAt, scheduledAt, dueAt);
      const subjectId =
        patch.subjectId === undefined ? existing.subjectId : patch.subjectId;
      await validatePlanningScope({
        userId,
        yearId: existing.yearId,
        subjectId,
      });
      const [updated] = await db
        .update(planningTasks)
        .set({ ...patch, updatedAt: new Date() })
        .where(
          and(eq(planningTasks.id, taskId), eq(planningTasks.userId, userId)),
        )
        .returning();
      return publicTask(updated!);
    }),

  setStatus: protectedProcedure
    .input(z.object({ taskId: idSchema, status: taskStatusSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requirePlanningTask(userId, input.taskId);
      assertActive(existing, "Planning task");
      assertEditablePatch("task", existing, { status: input.status });
      if (existing.status === input.status) return publicTask(existing);
      const [updated] = await db
        .update(planningTasks)
        .set({
          status: input.status,
          completedAt:
            input.status === "done"
              ? (existing.completedAt ?? new Date())
              : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(planningTasks.id, input.taskId),
            eq(planningTasks.userId, userId),
          ),
        )
        .returning();
      return publicTask(updated!);
    }),

  move: protectedProcedure
    .input(
      z.object({
        taskId: idSchema,
        status: taskStatusSchema,
        beforeId: idSchema.nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requirePlanningTask(userId, input.taskId);
      assertActive(existing, "Planning task");
      assertEditablePatch("task", existing, { status: input.status });
      if (input.beforeId === input.taskId) {
        badRequest("A task cannot be placed before itself");
      }
      const rows = await db
        .select({ id: planningTasks.id })
        .from(planningTasks)
        .where(
          and(
            eq(planningTasks.userId, userId),
            eq(planningTasks.yearId, existing.yearId),
            eq(planningTasks.status, input.status),
            inArray(planningTasks.syncState, ["managed", "detached"]),
          ),
        )
        .orderBy(asc(planningTasks.sortOrder), asc(planningTasks.createdAt));
      const ordered = rows
        .map((row) => row.id)
        .filter((id) => id !== input.taskId);
      const index = input.beforeId
        ? ordered.indexOf(input.beforeId)
        : ordered.length;
      if (input.beforeId && index < 0) {
        badRequest("The target task must be in the destination lane");
      }
      ordered.splice(index, 0, input.taskId);
      const previousLane =
        existing.status === input.status
          ? []
          : await db
              .select({ id: planningTasks.id })
              .from(planningTasks)
              .where(
                and(
                  eq(planningTasks.userId, userId),
                  eq(planningTasks.yearId, existing.yearId),
                  eq(planningTasks.status, existing.status),
                  ne(planningTasks.id, existing.id),
                  inArray(planningTasks.syncState, ["managed", "detached"]),
                ),
              )
              .orderBy(
                asc(planningTasks.sortOrder),
                asc(planningTasks.createdAt),
              );
      const now = new Date();
      await db.transaction(async (tx) => {
        for (const [sortOrder, id] of ordered.entries()) {
          await tx
            .update(planningTasks)
            .set({
              sortOrder,
              ...(id === input.taskId
                ? {
                    status: input.status,
                    completedAt:
                      input.status === "done"
                        ? (existing.completedAt ?? now)
                        : null,
                  }
                : {}),
              updatedAt: now,
            })
            .where(
              and(eq(planningTasks.id, id), eq(planningTasks.userId, userId)),
            );
        }
        for (const [sortOrder, row] of previousLane.entries()) {
          await tx
            .update(planningTasks)
            .set({ sortOrder, updatedAt: now })
            .where(
              and(
                eq(planningTasks.id, row.id),
                eq(planningTasks.userId, userId),
              ),
            );
        }
      });
      return publicTask(await requirePlanningTask(userId, input.taskId));
    }),

  delete: protectedProcedure
    .input(z.object({ taskId: idSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requirePlanningTask(userId, input.taskId);
      if (planningManagement("task", existing).mode === "provider") {
        badRequest(
          "Dismiss or detach a provider-managed task instead of deleting it",
        );
      }
      await db
        .delete(planningTasks)
        .where(
          and(
            eq(planningTasks.id, input.taskId),
            eq(planningTasks.userId, userId),
          ),
        );
      return { ok: true };
    }),

  dismiss: protectedProcedure
    .input(z.object({ taskId: idSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requirePlanningTask(userId, input.taskId);
      assertManaged(existing, "Planning task");
      const [updated] = await db
        .update(planningTasks)
        .set({ syncState: "dismissed", updatedAt: new Date() })
        .where(
          and(
            eq(planningTasks.id, input.taskId),
            eq(planningTasks.userId, userId),
          ),
        )
        .returning();
      return publicTask(updated!);
    }),

  detach: protectedProcedure
    .input(z.object({ taskId: idSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requirePlanningTask(userId, input.taskId);
      assertManaged(existing, "Planning task");
      const now = new Date();
      const detached = await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(planningTasks)
          .values({
            title: existing.title,
            notes: existing.notes,
            localNote: existing.localNote,
            startsAt: existing.startsAt,
            scheduledAt: existing.scheduledAt,
            dueAt: existing.dueAt,
            status: existing.status,
            completedAt: existing.completedAt,
            subjectId: existing.subjectId,
            sortOrder: existing.sortOrder,
            yearId: existing.yearId,
            userId,
            syncState: "detached",
          })
          .returning();
        await tx
          .update(planningTasks)
          .set({ syncState: "dismissed", updatedAt: now })
          .where(
            and(
              eq(planningTasks.id, input.taskId),
              eq(planningTasks.userId, userId),
            ),
          );
        return created!;
      });
      return publicTask(detached);
    }),
};
