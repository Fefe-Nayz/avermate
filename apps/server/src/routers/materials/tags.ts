import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  lectureRecordings,
  materialDocuments,
  materialFolders,
  materialTagLinks,
  materialTags,
  studyDocuments,
  type MaterialTargetKind,
} from "../../db/schema";
import { assertSameYear } from "../../lib/domain-integrity";
import { badRequest, notFound, protectedProcedure } from "../../lib/orpc";
import { requireSubject, requireYear } from "../../lib/ownership";

const tagNameSchema = z.string().trim().min(1).max(80);
const tagColorSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[a-z][a-z0-9-]*$/i, "A tag color must be a token name")
  .nullable();
const targetKindSchema = z.enum(["folder", "document", "study", "recording"]);
const targetSchema = z
  .object({ kind: targetKindSchema, id: z.string().min(1) })
  .strict();
const LINK_QUERY_CHUNK_SIZE = 400;
const LINK_WRITE_CHUNK_SIZE = 100;

type MaterialTarget = z.infer<typeof targetSchema>;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function uniqueTargets(targets: readonly MaterialTarget[]): MaterialTarget[] {
  const seen = new Set<string>();
  const result: MaterialTarget[] = [];
  for (const target of targets) {
    const key = `${target.kind}:${target.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(target);
  }
  return result;
}

async function requireMaterialTag(userId: string, tagId: string) {
  const [tag] = await db
    .select()
    .from(materialTags)
    .where(and(eq(materialTags.id, tagId), eq(materialTags.userId, userId)))
    .limit(1);
  if (!tag) notFound("Material tag");
  return tag;
}

async function validateTagSubject(
  userId: string,
  yearId: string,
  subjectId: string | null,
) {
  if (!subjectId) return;
  const subject = await requireSubject(userId, subjectId);
  assertSameYear("Material tag subject", yearId, subject.yearId);
}

async function targetRows(
  userId: string,
  kind: MaterialTargetKind,
  ids: readonly string[],
) {
  switch (kind) {
    case "folder":
      return db
        .select({ id: materialFolders.id, yearId: materialFolders.yearId })
        .from(materialFolders)
        .where(
          and(
            eq(materialFolders.userId, userId),
            inArray(materialFolders.id, [...ids]),
          ),
        );
    case "document":
      return db
        .select({ id: materialDocuments.id, yearId: materialDocuments.yearId })
        .from(materialDocuments)
        .where(
          and(
            eq(materialDocuments.userId, userId),
            inArray(materialDocuments.id, [...ids]),
          ),
        );
    case "study":
      return db
        .select({ id: studyDocuments.id, yearId: studyDocuments.yearId })
        .from(studyDocuments)
        .where(
          and(
            eq(studyDocuments.userId, userId),
            inArray(studyDocuments.id, [...ids]),
          ),
        );
    case "recording":
      return db
        .select({ id: lectureRecordings.id, yearId: lectureRecordings.yearId })
        .from(lectureRecordings)
        .where(
          and(
            eq(lectureRecordings.userId, userId),
            inArray(lectureRecordings.id, [...ids]),
          ),
        );
  }
}

async function requireTargetYears(
  userId: string,
  targets: readonly MaterialTarget[],
) {
  const years = new Map<string, string>();
  for (const kind of targetKindSchema.options) {
    const ids = targets
      .filter((target) => target.kind === kind)
      .map((target) => target.id);
    for (const batch of chunks(ids, LINK_QUERY_CHUNK_SIZE)) {
      if (batch.length === 0) continue;
      for (const row of await targetRows(userId, kind, batch)) {
        years.set(`${kind}:${row.id}`, row.yearId);
      }
    }
  }
  if (targets.some((target) => !years.has(`${target.kind}:${target.id}`))) {
    notFound("Material target");
  }
  return years;
}

/**
 * Resolve tags for one list projection in bounded batches. The join through
 * material_tags is an authorization boundary as well as a year filter: links
 * are polymorphic and intentionally carry no duplicated owner column.
 */
export async function materialTagIdsByTarget(input: {
  userId: string;
  yearId: string;
  targetKind: MaterialTargetKind;
  targetIds: readonly string[];
}) {
  const result = new Map<string, string[]>();
  const targetIds = [...new Set(input.targetIds)];
  for (const targetId of targetIds) result.set(targetId, []);
  for (const batch of chunks(targetIds, LINK_QUERY_CHUNK_SIZE)) {
    if (batch.length === 0) continue;
    const links = await db
      .select({
        targetId: materialTagLinks.targetId,
        tagId: materialTagLinks.tagId,
      })
      .from(materialTagLinks)
      .innerJoin(materialTags, eq(materialTags.id, materialTagLinks.tagId))
      .where(
        and(
          eq(materialTags.userId, input.userId),
          eq(materialTags.yearId, input.yearId),
          eq(materialTagLinks.targetKind, input.targetKind),
          inArray(materialTagLinks.targetId, batch),
        ),
      )
      .orderBy(asc(materialTags.name), asc(materialTags.id));
    for (const link of links) result.get(link.targetId)?.push(link.tagId);
  }
  return result;
}

export const materialTagsRouter = {
  list: protectedProcedure
    .input(z.object({ yearId: z.string().min(1) }).strict())
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      return db
        .select()
        .from(materialTags)
        .where(
          and(
            eq(materialTags.userId, userId),
            eq(materialTags.yearId, input.yearId),
          ),
        )
        .orderBy(asc(materialTags.name), asc(materialTags.createdAt));
    }),

  create: protectedProcedure
    .input(
      z
        .object({
          yearId: z.string().min(1),
          name: tagNameSchema,
          color: tagColorSchema.optional().default(null),
          subjectId: z.string().min(1).nullable().optional().default(null),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      await validateTagSubject(userId, input.yearId, input.subjectId);
      const [created] = await db
        .insert(materialTags)
        .values({ ...input, userId })
        .returning();
      if (!created) throw new Error("The material tag was not returned");
      return created;
    }),

  update: protectedProcedure
    .input(
      z
        .object({
          tagId: z.string().min(1),
          name: tagNameSchema.optional(),
          color: tagColorSchema.optional(),
          subjectId: z.string().min(1).nullable().optional(),
        })
        .strict()
        .refine(
          (input) =>
            input.name !== undefined ||
            input.color !== undefined ||
            input.subjectId !== undefined,
          "At least one tag field must change",
        ),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const tag = await requireMaterialTag(userId, input.tagId);
      if (input.subjectId !== undefined) {
        await validateTagSubject(userId, tag.yearId, input.subjectId);
      }
      const [updated] = await db
        .update(materialTags)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.color !== undefined ? { color: input.color } : {}),
          ...(input.subjectId !== undefined
            ? { subjectId: input.subjectId }
            : {}),
          updatedAt: new Date(),
        })
        .where(
          and(eq(materialTags.id, tag.id), eq(materialTags.userId, userId)),
        )
        .returning();
      if (!updated) throw new Error("The material tag was not returned");
      return updated;
    }),

  delete: protectedProcedure
    .input(z.object({ tagId: z.string().min(1) }).strict())
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const tag = await requireMaterialTag(userId, input.tagId);
      await db
        .delete(materialTags)
        .where(
          and(eq(materialTags.id, tag.id), eq(materialTags.userId, userId)),
        );
      return { ok: true as const };
    }),

  assign: protectedProcedure
    .input(
      z
        .object({
          tagId: z.string().min(1),
          targets: z.array(targetSchema).min(1).max(1_000),
          assigned: z.boolean(),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const tag = await requireMaterialTag(userId, input.tagId);
      const targets = uniqueTargets(input.targets);
      const targetYears = await requireTargetYears(userId, targets);
      if (
        targets.some(
          (target) =>
            targetYears.get(`${target.kind}:${target.id}`) !== tag.yearId,
        )
      ) {
        badRequest("A material tag and every target must share the same year");
      }

      if (input.assigned) {
        let count = 0;
        for (const batch of chunks(targets, LINK_WRITE_CHUNK_SIZE)) {
          const inserted = await db
            .insert(materialTagLinks)
            .values(
              batch.map((target) => ({
                tagId: tag.id,
                targetKind: target.kind,
                targetId: target.id,
              })),
            )
            .onConflictDoUpdate({
              target: [
                materialTagLinks.tagId,
                materialTagLinks.targetKind,
                materialTagLinks.targetId,
              ],
              // Explicit interaction owns the association from now on; a
              // later front-matter refresh must not silently remove it.
              set: { origin: "manual", updatedAt: new Date() },
              // A repeated explicit assignment is idempotent. Only promote a
              // front-matter-owned association to manual ownership.
              setWhere: eq(materialTagLinks.origin, "frontmatter"),
            })
            .returning({ targetId: materialTagLinks.targetId });
          count += inserted.length;
        }
        return { count };
      }

      let count = 0;
      for (const kind of targetKindSchema.options) {
        const ids = targets
          .filter((target) => target.kind === kind)
          .map((target) => target.id);
        for (const batch of chunks(ids, LINK_QUERY_CHUNK_SIZE)) {
          if (batch.length === 0) continue;
          const deleted = await db
            .delete(materialTagLinks)
            .where(
              and(
                eq(materialTagLinks.tagId, tag.id),
                eq(materialTagLinks.targetKind, kind),
                inArray(materialTagLinks.targetId, batch),
              ),
            )
            .returning({ targetId: materialTagLinks.targetId });
          count += deleted.length;
        }
      }
      return { count };
    }),
};
