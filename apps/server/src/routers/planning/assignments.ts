import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { academicAssignments, planningTasks } from "../../db/schema";
import { badRequest, protectedProcedure } from "../../lib/orpc";
import {
  assertActive,
  assertEditablePatch,
  assertManaged,
  idSchema,
  localNoteSchema,
  loadPlanningConnectionInfo,
  managementOf,
  optionalTextSchema,
  publicAssignment,
  publicTask,
  requireAssignment,
  titleSchema,
  validatePlanningScope,
} from "./shared";

const assignmentFields = {
  title: titleSchema,
  instructions: optionalTextSchema,
  assignedAt: z.coerce.date().nullable(),
  startsAt: z.coerce.date().nullable(),
  dueAt: z.coerce.date().nullable(),
  localNote: localNoteSchema,
  subjectId: idSchema.nullable(),
};

const createInput = z.object({
  yearId: idSchema,
  title: assignmentFields.title,
  instructions: assignmentFields.instructions.default(null),
  assignedAt: assignmentFields.assignedAt.default(null),
  startsAt: assignmentFields.startsAt.default(null),
  dueAt: assignmentFields.dueAt.default(null),
  localNote: assignmentFields.localNote.default(null),
  subjectId: assignmentFields.subjectId.default(null),
});

const updateInput = z
  .object({
    assignmentId: idSchema,
    title: assignmentFields.title.optional(),
    instructions: assignmentFields.instructions.optional(),
    assignedAt: assignmentFields.assignedAt.optional(),
    startsAt: assignmentFields.startsAt.optional(),
    dueAt: assignmentFields.dueAt.optional(),
    localNote: assignmentFields.localNote.optional(),
    subjectId: assignmentFields.subjectId.optional(),
    completed: z.boolean().optional(),
  })
  .refine(
    ({ assignmentId: _assignmentId, ...patch }) =>
      Object.values(patch).some((value) => value !== undefined),
    "At least one assignment field must change",
  );

const listInput = z
  .object({
    yearId: idSchema,
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
    includeMissing: z.boolean().default(false),
  })
  .refine((input) => !input.from || !input.to || input.from <= input.to, {
    message: "The assignment window is inverted",
  });

function assertAssignmentDates(startsAt: Date | null, dueAt: Date | null) {
  if (startsAt && dueAt && dueAt < startsAt) {
    badRequest("An assignment cannot start after its due date");
  }
}

export const planningAssignmentsRouter = {
  list: protectedProcedure
    .input(listInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await validatePlanningScope({
        userId,
        yearId: input.yearId,
        subjectId: null,
      });
      const rows = await db
        .select()
        .from(academicAssignments)
        .where(
          and(
            eq(academicAssignments.userId, userId),
            eq(academicAssignments.yearId, input.yearId),
            input.from ? gte(academicAssignments.dueAt, input.from) : undefined,
            input.to ? lte(academicAssignments.dueAt, input.to) : undefined,
            input.includeMissing
              ? undefined
              : inArray(academicAssignments.syncState, ["managed", "detached"]),
          ),
        )
        .orderBy(
          asc(academicAssignments.dueAt),
          asc(academicAssignments.title),
        );
      const connections = await loadPlanningConnectionInfo(userId);
      return rows.map((row) => publicAssignment(row, connections));
    }),

  create: protectedProcedure
    .input(createInput)
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await validatePlanningScope({ userId, ...input });
      assertAssignmentDates(input.startsAt, input.dueAt);
      const [created] = await db
        .insert(academicAssignments)
        .values({
          ...input,
          userId,
          syncState: "detached",
        })
        .returning();
      return publicAssignment(created!);
    }),

  update: protectedProcedure
    .input(updateInput)
    .handler(async ({ context, input }) => {
      const { assignmentId, completed, ...patch } = input;
      const userId = context.session.user.id;
      const existing = await requireAssignment(userId, assignmentId);
      assertActive(existing, "Academic assignment");
      assertEditablePatch("assignment", existing, { ...patch, completed });
      const startsAt =
        patch.startsAt === undefined ? existing.startsAt : patch.startsAt;
      const dueAt = patch.dueAt === undefined ? existing.dueAt : patch.dueAt;
      assertAssignmentDates(startsAt, dueAt);
      const subjectId =
        patch.subjectId === undefined ? existing.subjectId : patch.subjectId;
      await validatePlanningScope({
        userId,
        yearId: existing.yearId,
        subjectId,
      });
      const [updated] = await db
        .update(academicAssignments)
        .set({
          ...patch,
          ...(completed === undefined
            ? {}
            : {
                completedAt: completed
                  ? (existing.completedAt ?? new Date())
                  : null,
              }),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(academicAssignments.id, assignmentId),
            eq(academicAssignments.userId, userId),
          ),
        )
        .returning();
      return publicAssignment(updated!);
    }),

  delete: protectedProcedure
    .input(z.object({ assignmentId: idSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireAssignment(userId, input.assignmentId);
      if (managementOf("assignment", existing).mode === "provider") {
        badRequest(
          "Dismiss or detach a provider-managed assignment instead of deleting it",
        );
      }
      await db
        .delete(academicAssignments)
        .where(
          and(
            eq(academicAssignments.id, input.assignmentId),
            eq(academicAssignments.userId, userId),
          ),
        );
      return { ok: true };
    }),

  updateLocal: protectedProcedure
    .input(z.object({ assignmentId: idSchema, localNote: localNoteSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireAssignment(userId, input.assignmentId);
      assertActive(existing, "Academic assignment");
      assertEditablePatch("assignment", existing, {
        localNote: input.localNote,
      });
      const [updated] = await db
        .update(academicAssignments)
        .set({ localNote: input.localNote, updatedAt: new Date() })
        .where(
          and(
            eq(academicAssignments.id, input.assignmentId),
            eq(academicAssignments.userId, userId),
          ),
        )
        .returning();
      return publicAssignment(updated!);
    }),

  setCompleted: protectedProcedure
    .input(z.object({ assignmentId: idSchema, completed: z.boolean() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireAssignment(userId, input.assignmentId);
      assertActive(existing, "Academic assignment");
      assertEditablePatch("assignment", existing, {
        completed: input.completed,
      });
      const [updated] = await db
        .update(academicAssignments)
        .set({
          completedAt: input.completed
            ? (existing.completedAt ?? new Date())
            : null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(academicAssignments.id, input.assignmentId),
            eq(academicAssignments.userId, userId),
          ),
        )
        .returning();
      return publicAssignment(updated!);
    }),

  dismiss: protectedProcedure
    .input(z.object({ assignmentId: idSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireAssignment(userId, input.assignmentId);
      assertManaged(existing, "Academic assignment");
      const [updated] = await db
        .update(academicAssignments)
        .set({ syncState: "dismissed", updatedAt: new Date() })
        .where(
          and(
            eq(academicAssignments.id, input.assignmentId),
            eq(academicAssignments.userId, userId),
          ),
        )
        .returning();
      return publicAssignment(updated!);
    }),

  detach: protectedProcedure
    .input(z.object({ assignmentId: idSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const existing = await requireAssignment(userId, input.assignmentId);
      assertManaged(existing, "Academic assignment");
      const now = new Date();
      return db.transaction(async (tx) => {
        const [created] = await tx
          .insert(planningTasks)
          .values({
            title: existing.title,
            notes: existing.instructions,
            localNote: existing.localNote,
            startsAt: existing.startsAt,
            dueAt: existing.dueAt,
            status: existing.completedAt ? "done" : "todo",
            completedAt: existing.completedAt,
            subjectId: existing.subjectId,
            yearId: existing.yearId,
            userId,
            syncState: "detached",
          })
          .returning();
        await tx
          .update(academicAssignments)
          .set({ syncState: "dismissed", updatedAt: now })
          .where(
            and(
              eq(academicAssignments.id, input.assignmentId),
              eq(academicAssignments.userId, userId),
            ),
          );
        return publicTask(created!);
      });
    }),
};
