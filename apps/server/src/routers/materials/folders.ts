import { and, asc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { materialDocuments, materialFolders } from "../../db/schema";
import { assertSameYear } from "../../lib/domain-integrity";
import { badRequest, protectedProcedure } from "../../lib/orpc";
import {
  requireLiveMaterialFolder,
  requireMaterialFolder,
  requireSubject,
  requireYear,
} from "../../lib/ownership";
import {
  collectMaterialFolderDescendantIds,
  materialFolderMoveIssue,
} from "./shared";
import { materialTagIdsByTarget } from "./tags";
import { purgeMaterialTarget, trashMaterialTarget } from "./operations";

const nameSchema = z.string().trim().min(1).max(160);

async function nextFolderSortOrder(
  userId: string,
  yearId: string,
  parentId: string | null,
) {
  const siblings = await db
    .select({ sortOrder: materialFolders.sortOrder })
    .from(materialFolders)
    .where(
      and(
        eq(materialFolders.userId, userId),
        eq(materialFolders.yearId, yearId),
        parentId
          ? eq(materialFolders.parentId, parentId)
          : isNull(materialFolders.parentId),
        isNull(materialFolders.deletedAt),
      ),
    );
  return siblings.reduce((max, row) => Math.max(max, row.sortOrder + 1), 0);
}

async function validateFolderParent(
  userId: string,
  yearId: string,
  parentId: string | null,
) {
  if (!parentId) return;
  const parent = await requireLiveMaterialFolder(userId, parentId);
  assertSameYear("Material folder parent", yearId, parent.yearId);
}

async function validateFolderSubject(
  userId: string,
  yearId: string,
  subjectId: string | null,
) {
  if (!subjectId) return;
  const subject = await requireSubject(userId, subjectId);
  assertSameYear("Material folder subject", yearId, subject.yearId);
}

export const materialFoldersRouter = {
  list: protectedProcedure
    .input(
      z
        .object({
          yearId: z.string().min(1),
          include: z.enum(["live", "trashed"]).default("live"),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      const rows = await db
        .select()
        .from(materialFolders)
        .where(
          and(
            eq(materialFolders.userId, userId),
            eq(materialFolders.yearId, input.yearId),
            input.include === "trashed"
              ? isNotNull(materialFolders.deletedAt)
              : isNull(materialFolders.deletedAt),
          ),
        )
        .orderBy(asc(materialFolders.sortOrder), asc(materialFolders.name));
      const tagIds = await materialTagIdsByTarget({
        userId,
        yearId: input.yearId,
        targetKind: "folder",
        targetIds: rows.map((row) => row.id),
      });
      return rows.map((row) => ({
        ...row,
        tagIds: tagIds.get(row.id) ?? [],
      }));
    }),

  create: protectedProcedure
    .input(
      z.object({
        yearId: z.string().min(1),
        name: nameSchema,
        parentId: z.string().nullable().default(null),
        subjectId: z.string().nullable().default(null),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await requireYear(userId, input.yearId);
      await validateFolderParent(userId, input.yearId, input.parentId);
      await validateFolderSubject(userId, input.yearId, input.subjectId);

      const [created] = await db
        .insert(materialFolders)
        .values({
          ...input,
          origin: "manual",
          sortOrder: await nextFolderSortOrder(
            userId,
            input.yearId,
            input.parentId,
          ),
          userId,
        })
        .returning();
      return created;
    }),

  rename: protectedProcedure
    .input(z.object({ folderId: z.string().min(1), name: nameSchema }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const folder = await requireLiveMaterialFolder(userId, input.folderId);
      if (folder.origin !== "manual") {
        badRequest("Synchronized material folders cannot be renamed locally");
      }
      const [updated] = await db
        .update(materialFolders)
        .set({ name: input.name, updatedAt: new Date() })
        .where(
          and(
            eq(materialFolders.id, input.folderId),
            eq(materialFolders.userId, userId),
          ),
        )
        .returning();
      return updated;
    }),

  move: protectedProcedure
    .input(
      z.object({
        folderId: z.string().min(1),
        parentId: z.string().nullable(),
        subjectId: z.string().nullable().optional(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const folder = await requireLiveMaterialFolder(userId, input.folderId);
      if (folder.origin !== "manual") {
        badRequest("Synchronized material folders cannot be moved locally");
      }
      await validateFolderParent(userId, folder.yearId, input.parentId);
      if (input.subjectId !== undefined) {
        await validateFolderSubject(userId, folder.yearId, input.subjectId);
      }

      const rows = await db
        .select({ id: materialFolders.id, parentId: materialFolders.parentId })
        .from(materialFolders)
        .where(
          and(
            eq(materialFolders.userId, userId),
            eq(materialFolders.yearId, folder.yearId),
          ),
        );
      const cycleIssue = materialFolderMoveIssue(
        rows,
        folder.id,
        input.parentId,
      );
      if (cycleIssue) badRequest(cycleIssue);

      const [updated] = await db
        .update(materialFolders)
        .set({
          parentId: input.parentId,
          ...(input.subjectId !== undefined
            ? { subjectId: input.subjectId }
            : {}),
          sortOrder: await nextFolderSortOrder(
            userId,
            folder.yearId,
            input.parentId,
          ),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(materialFolders.id, folder.id),
            eq(materialFolders.userId, userId),
          ),
        )
        .returning();
      return updated;
    }),

  reorder: protectedProcedure
    .input(z.object({ folderIds: z.array(z.string().min(1)).min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (new Set(input.folderIds).size !== input.folderIds.length) {
        badRequest("A material folder can only appear once in its order");
      }
      const folders = await Promise.all(
        input.folderIds.map((id) => requireLiveMaterialFolder(userId, id)),
      );
      const first = folders[0];
      if (!first) badRequest("At least one material folder is required");
      if (
        folders.some(
          (folder) =>
            folder.yearId !== first.yearId ||
            folder.parentId !== first.parentId,
        )
      ) {
        badRequest("Every reordered folder must share a year and parent");
      }

      const siblings = await db
        .select({ id: materialFolders.id })
        .from(materialFolders)
        .where(
          and(
            eq(materialFolders.userId, userId),
            eq(materialFolders.yearId, first.yearId),
            first.parentId
              ? eq(materialFolders.parentId, first.parentId)
              : isNull(materialFolders.parentId),
            isNull(materialFolders.deletedAt),
          ),
        );
      const expected = new Set(siblings.map((folder) => folder.id));
      if (
        expected.size !== input.folderIds.length ||
        input.folderIds.some((id) => !expected.has(id))
      ) {
        badRequest("Folder order must include every sibling exactly once");
      }

      const statements = input.folderIds.map((id, index) =>
        db
          .update(materialFolders)
          .set({ sortOrder: index, updatedAt: new Date() })
          .where(
            and(eq(materialFolders.id, id), eq(materialFolders.userId, userId)),
          ),
      );
      await db.batch(
        statements as [
          (typeof statements)[number],
          ...(typeof statements)[number][],
        ],
      );
      return { ok: true };
    }),

  delete: protectedProcedure
    .input(z.object({ folderId: z.string().min(1) }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const folder = await requireMaterialFolder(userId, input.folderId);
      const rows = await db
        .select({ id: materialFolders.id, parentId: materialFolders.parentId })
        .from(materialFolders)
        .where(
          and(
            eq(materialFolders.userId, userId),
            eq(materialFolders.yearId, folder.yearId),
          ),
        );
      const folderIds = [
        folder.id,
        ...collectMaterialFolderDescendantIds(rows, folder.id),
      ];
      const documents = await db
        .select({ id: materialDocuments.id, fileId: materialDocuments.fileId })
        .from(materialDocuments)
        .where(
          and(
            eq(materialDocuments.userId, userId),
            inArray(materialDocuments.folderId, folderIds),
          ),
        );

      if (!folder.deletedAt) {
        await trashMaterialTarget(userId, "folder", folder.id);
        return {
          ok: true as const,
          deletedFolders: folderIds.length,
          deletedDocuments: documents.length,
        };
      }
      await purgeMaterialTarget(userId, "folder", folder.id);
      return {
        ok: true,
        deletedFolders: folderIds.length,
        deletedDocuments: documents.length,
      };
    }),
};
