import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { grades, subjects } from "../db/schema";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireSubject, requireYear } from "../lib/ownership";

const subjectInput = z.object({
  name: z.string().trim().min(1).max(96),
  shortName: z.string().trim().max(24).nullable().default(null),
  parentId: z.string().nullable().default(null),
  coefficient: z.number().min(0).max(1000).default(1),
  kind: z.enum(["subject", "category"]).default("subject"),
  isMain: z.boolean().default(false),
});

/**
 * Refuse a parent change that would put a subject inside its own sub-tree.
 * Nothing downstream would crash — the engine guards against cycles — but the
 * user would be left with a branch that has quietly detached from their year.
 */
async function assertNoCycle(
  userId: string,
  subjectId: string,
  parentId: string | null,
) {
  if (!parentId) return;
  if (parentId === subjectId) badRequest("A subject cannot be its own parent");

  const rows = await db
    .select({ id: subjects.id, parentId: subjects.parentId })
    .from(subjects)
    .where(eq(subjects.userId, userId));

  const parents = new Map(rows.map((row) => [row.id, row.parentId]));
  let cursor: string | null | undefined = parentId;
  const seen = new Set<string>();
  while (cursor) {
    if (cursor === subjectId) badRequest("That would nest a subject inside itself");
    if (seen.has(cursor)) break;
    seen.add(cursor);
    cursor = parents.get(cursor) ?? null;
  }
}

async function nextSortOrder(yearId: string, parentId: string | null) {
  const siblings = await db
    .select({ sortOrder: subjects.sortOrder })
    .from(subjects)
    .where(
      parentId
        ? and(eq(subjects.yearId, yearId), eq(subjects.parentId, parentId))
        : eq(subjects.yearId, yearId),
    );
  return siblings.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
}

export const subjectsRouter = {
  list: protectedProcedure
    .input(z.object({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      await requireYear(context.session.user.id, input.yearId);
      return db
        .select()
        .from(subjects)
        .where(eq(subjects.yearId, input.yearId))
        .orderBy(asc(subjects.sortOrder), asc(subjects.name));
    }),

  get: protectedProcedure
    .input(z.object({ subjectId: z.string() }))
    .handler(({ context, input }) =>
      requireSubject(context.session.user.id, input.subjectId),
    ),

  create: protectedProcedure
    .input(subjectInput.extend({ yearId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      if (input.parentId) await requireSubject(userId, input.parentId);

      const [created] = await db
        .insert(subjects)
        .values({
          ...input,
          sortOrder: await nextSortOrder(input.yearId, input.parentId),
          userId,
        })
        .returning();
      return created;
    }),

  update: protectedProcedure
    .input(subjectInput.partial().extend({ subjectId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { subjectId, ...patch } = input;
      await requireSubject(userId, subjectId);

      if (patch.parentId !== undefined) {
        if (patch.parentId) await requireSubject(userId, patch.parentId);
        await assertNoCycle(userId, subjectId, patch.parentId);
      }

      const [updated] = await db
        .update(subjects)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(subjects.id, subjectId))
        .returning();
      return updated;
    }),

  /** Drag-and-drop reordering, and re-parenting in the same gesture. */
  move: protectedProcedure
    .input(
      z.object({
        subjectId: z.string(),
        parentId: z.string().nullable(),
        siblingIds: z.array(z.string()),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireSubject(userId, input.subjectId);
      if (input.parentId) await requireSubject(userId, input.parentId);
      await assertNoCycle(userId, input.subjectId, input.parentId);

      await db
        .update(subjects)
        .set({ parentId: input.parentId, updatedAt: new Date() })
        .where(eq(subjects.id, input.subjectId));

      await Promise.all(
        input.siblingIds.map((id, index) =>
          db
            .update(subjects)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(and(eq(subjects.id, id), eq(subjects.userId, userId))),
        ),
      );

      return { ok: true };
    }),

  delete: protectedProcedure
    .input(
      z.object({
        subjectId: z.string(),
        /** Keep the children by attaching them to the deleted subject's parent. */
        promoteChildren: z.boolean().default(false),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const subject = await requireSubject(userId, input.subjectId);

      if (input.promoteChildren) {
        await db
          .update(subjects)
          .set({ parentId: subject.parentId, updatedAt: new Date() })
          .where(
            and(
              eq(subjects.parentId, subject.id),
              eq(subjects.userId, userId),
            ),
          );
      }

      await db.delete(subjects).where(eq(subjects.id, subject.id));
      return { ok: true };
    }),

  /** What a delete would take with it, so the confirmation can be specific. */
  impact: protectedProcedure
    .input(z.object({ subjectId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const subject = await requireSubject(userId, input.subjectId);

      const rows = await db
        .select({ id: subjects.id, parentId: subjects.parentId })
        .from(subjects)
        .where(eq(subjects.yearId, subject.yearId));

      const childrenOf = new Map<string, string[]>();
      for (const row of rows) {
        if (!row.parentId) continue;
        const list = childrenOf.get(row.parentId);
        if (list) list.push(row.id);
        else childrenOf.set(row.parentId, [row.id]);
      }

      const descendants: string[] = [];
      const stack = [...(childrenOf.get(subject.id) ?? [])];
      while (stack.length > 0) {
        const id = stack.pop() as string;
        descendants.push(id);
        stack.push(...(childrenOf.get(id) ?? []));
      }

      const affected = await db
        .select({ id: grades.id })
        .from(grades)
        .where(inArray(grades.subjectId, [subject.id, ...descendants]));

      return { descendants: descendants.length, grades: affected.length };
    }),
};
