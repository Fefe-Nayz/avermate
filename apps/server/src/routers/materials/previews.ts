import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import { files, materialDocuments } from "../../db/schema";
import { badRequest, protectedProcedure } from "../../lib/orpc";
import { fileAccessUrl } from "../../lib/storage";

const documentIdsSchema = z
  .array(z.string().min(1))
  .min(1)
  .max(200)
  .superRefine((ids, context) => {
    if (new Set(ids).size !== ids.length) {
      context.addIssue({
        code: "custom",
        message: "A document can only be requested once",
      });
    }
  });

export interface MaterialPreviewRouterDependencies {
  fileAccessUrl?: typeof fileAccessUrl;
}

/** Batched, ownership-checked preview URL resolution for virtualised grids. */
export function createMaterialPreviewRouter(
  dependencies: MaterialPreviewRouterDependencies = {},
) {
  const resolveAccessUrl = dependencies.fileAccessUrl ?? fileAccessUrl;
  return {
    previewUrls: protectedProcedure
      .input(z.object({ documentIds: documentIdsSchema }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        const documents = await db
          .select({
            documentId: materialDocuments.id,
            fileId: materialDocuments.fileId,
          })
          .from(materialDocuments)
          .where(
            and(
              eq(materialDocuments.userId, userId),
              inArray(materialDocuments.id, input.documentIds),
              isNull(materialDocuments.deletedAt),
            ),
          );
        if (documents.length !== input.documentIds.length) {
          badRequest("One or more material documents are unavailable");
        }

        const sourceIds = documents.flatMap((document) =>
          document.fileId ? [document.fileId] : [],
        );
        if (sourceIds.length === 0) return [];
        const sources = await db
          .select({ id: files.id, previewFileId: files.previewFileId })
          .from(files)
          .where(
            and(
              eq(files.userId, userId),
              eq(files.status, "stored"),
              inArray(files.id, sourceIds),
            ),
          );
        const previewIds = [
          ...new Set(
            sources.flatMap((source) =>
              source.previewFileId ? [source.previewFileId] : [],
            ),
          ),
        ];
        if (previewIds.length === 0) return [];
        const previews = await db
          .select({
            id: files.id,
            provider: files.provider,
            storageKey: files.storageKey,
            url: files.url,
          })
          .from(files)
          .where(
            and(
              eq(files.userId, userId),
              eq(files.status, "stored"),
              eq(files.purpose, "preview"),
              inArray(files.id, previewIds),
            ),
          );
        const previewById = new Map(previews.map((file) => [file.id, file]));
        const sourceById = new Map(sources.map((file) => [file.id, file]));

        return Promise.all(
          documents.flatMap((document) => {
            const previewId = document.fileId
              ? sourceById.get(document.fileId)?.previewFileId
              : null;
            const preview = previewId ? previewById.get(previewId) : null;
            return preview
              ? [
                  resolveAccessUrl(preview, { expiresIn: "1h" }).then(
                    (url) => ({ documentId: document.documentId, url }),
                  ),
                ]
              : [];
          }),
        );
      }),
  };
}

export const materialPreviewRouter = createMaterialPreviewRouter();
