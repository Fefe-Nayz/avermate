import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import { grades, subjects } from "../db/schema";
import { assertSameYear, collectDescendantIds } from "../lib/domain-integrity";
import { newId } from "../lib/id";
import { badRequest, protectedProcedure } from "../lib/orpc";
import { requireSubject, requireYear } from "../lib/ownership";
import { detachYearPresetStatement } from "../lib/preset-membership";

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
    if (cursor === subjectId)
      badRequest("That would nest a subject inside itself");
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
      if (input.parentId) {
        const parent = await requireSubject(userId, input.parentId);
        assertSameYear("Parent subject", input.yearId, parent.yearId);
      }

      const id = newId("sub");
      const insertSubject = db.insert(subjects).values({
          id,
          ...input,
          sortOrder: await nextSortOrder(input.yearId, input.parentId),
          userId,
        });
      await db.batch([
        insertSubject,
        detachYearPresetStatement(userId, input.yearId, "subject_created"),
      ]);
      const [created] = await db
        .select()
        .from(subjects)
        .where(eq(subjects.id, id))
        .limit(1);
      return created;
    }),

  update: protectedProcedure
    .input(subjectInput.partial().extend({ subjectId: z.string() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const { subjectId, ...patch } = input;
      const existing = await requireSubject(userId, subjectId);

      if (patch.parentId !== undefined) {
        if (patch.parentId) {
          const parent = await requireSubject(userId, patch.parentId);
          assertSameYear("Parent subject", existing.yearId, parent.yearId);
        }
        await assertNoCycle(userId, subjectId, patch.parentId);
      }

      if (patch.kind === "category" && existing.kind !== "category") {
        const [grade] = await db
          .select({ id: grades.id })
          .from(grades)
          .where(
            and(eq(grades.subjectId, subjectId), eq(grades.userId, userId)),
          )
          .limit(1);
        if (grade) {
          badRequest("A subject with grades cannot become a category");
        }
      }

      const updateSubject = db
        .update(subjects)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(subjects.id, subjectId));
      await db.batch([
        updateSubject,
        detachYearPresetStatement(userId, existing.yearId, "subject_updated"),
      ]);
      const [updated] = await db
        .select()
        .from(subjects)
        .where(eq(subjects.id, subjectId))
        .limit(1);
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
      const subject = await requireSubject(userId, input.subjectId);
      if (input.parentId) {
        const parent = await requireSubject(userId, input.parentId);
        assertSameYear("Parent subject", subject.yearId, parent.yearId);
      }
      await assertNoCycle(userId, input.subjectId, input.parentId);

      if (new Set(input.siblingIds).size !== input.siblingIds.length) {
        badRequest("A subject can only appear once in its sibling order");
      }
      const siblings = await Promise.all(
        input.siblingIds.map((id) => requireSubject(userId, id)),
      );
      for (const sibling of siblings) {
        assertSameYear("Sibling subject", subject.yearId, sibling.yearId);
        if (sibling.id !== subject.id && sibling.parentId !== input.parentId) {
          badRequest("Every reordered subject must share the same parent");
        }
      }

      const statements = [
        db
          .update(subjects)
          .set({ parentId: input.parentId, updatedAt: new Date() })
          .where(eq(subjects.id, input.subjectId)),
        ...input.siblingIds.map((id, index) =>
          db
            .update(subjects)
            .set({ sortOrder: index, updatedAt: new Date() })
            .where(and(eq(subjects.id, id), eq(subjects.userId, userId))),
        ),
        detachYearPresetStatement(userId, subject.yearId, "subject_moved"),
      ];
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
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
        await db.batch([
          db
            .update(subjects)
            .set({ parentId: subject.parentId, updatedAt: new Date() })
            .where(
              and(eq(subjects.parentId, subject.id), eq(subjects.userId, userId)),
            ),
          db.delete(subjects).where(eq(subjects.id, subject.id)),
          detachYearPresetStatement(userId, subject.yearId, "subject_deleted"),
        ]);
      } else {
        const rows = await db
          .select({ id: subjects.id, parentId: subjects.parentId })
          .from(subjects)
          .where(
            and(
              eq(subjects.yearId, subject.yearId),
              eq(subjects.userId, userId),
            ),
          );
        const subtree = [subject.id, ...collectDescendantIds(rows, subject.id)];
        await db.batch([
          db.delete(subjects).where(
            and(inArray(subjects.id, subtree), eq(subjects.userId, userId)),
          ),
          detachYearPresetStatement(userId, subject.yearId, "subject_deleted"),
        ]);
        return { ok: true, deleted: subtree.length };
      }
      return { ok: true, deleted: 1 };
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

      const descendants = collectDescendantIds(rows, subject.id);

      const affected = await db
        .select({ id: grades.id })
        .from(grades)
        .where(
          and(
            inArray(grades.subjectId, [subject.id, ...descendants]),
            eq(grades.userId, userId),
          ),
        );

      return { descendants: descendants.length, grades: affected.length };
    }),
};
