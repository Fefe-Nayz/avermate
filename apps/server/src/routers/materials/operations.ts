import { and, asc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../../db";
import {
  documentArtifacts,
  jobs,
  lectureRecordings,
  materialDocuments,
  materialFolders,
  materialTagLinks,
  recordingSegments,
  studyDocumentBuilds,
  studyDocumentExports,
  studyDocuments,
  type MaterialTargetKind,
} from "../../db/schema";
import { CLEANUP_UNOWNED_FILE_JOB_KIND } from "../../jobs/ingest-link";
import { purgeRecordingTranscriptionJobs } from "../../jobs/transcription";
import { newId } from "../../lib/id";
import { enqueueJob } from "../../lib/jobs";
import { badRequest, protectedProcedure } from "../../lib/orpc";
import {
  requireMaterialDocument,
  requireMaterialFolder,
  requireRecording,
  requireStudyDocument,
  requireYear,
} from "../../lib/ownership";
import { deleteFile, deleteFilePreview } from "../../lib/storage";
import { collectMaterialFolderDescendantIds } from "./shared";

export const materialTargetKindSchema = z.enum([
  "folder",
  "document",
  "study",
  "recording",
]);

type TargetKind = z.infer<typeof materialTargetKindSchema>;
type RemoveFile = typeof deleteFile;
type RemovePreview = typeof deleteFilePreview;
type QueueJob = typeof enqueueJob;

const synchronizedDeletionError =
  "Synchronized materials cannot be deleted locally";

function assertLocallyDeletableOrigin(origin: string | null | undefined) {
  if (origin && origin !== "manual") badRequest(synchronizedDeletionError);
}

function isSynchronizedProviderTombstone(target: {
  origin?: string | null;
  deletedAt?: Date | null;
  deletedBy?: string | null;
}) {
  return (
    !!target.origin &&
    target.origin !== "manual" &&
    !!target.deletedAt &&
    target.deletedBy === "provider"
  );
}

export const MATERIAL_TRASH_PURGE_BATCH_SIZE = 25;
const MATERIAL_TRASH_PURGE_MAX_BATCH_SIZE = 100;
const materialTrashPurgeKinds = [
  "folder",
  "document",
  "study",
  "recording",
] as const satisfies readonly TargetKind[];

export const materialTrashPurgeCursorSchema = z
  .object({
    kind: materialTargetKindSchema,
    deletedAt: z.string().datetime(),
    id: z.string().min(1),
  })
  .strict();

export type MaterialTrashPurgeCursor = z.infer<
  typeof materialTrashPurgeCursorSchema
>;

async function requireTarget(userId: string, kind: TargetKind, id: string) {
  switch (kind) {
    case "folder":
      return requireMaterialFolder(userId, id);
    case "document":
      return requireMaterialDocument(userId, id);
    case "study":
      return requireStudyDocument(userId, id);
    case "recording":
      return requireRecording(userId, id);
  }
}

export async function deleteMaterialTargetTagLinks(
  kind: MaterialTargetKind,
  targetIds: readonly string[],
) {
  const ids = [...new Set(targetIds)];
  if (ids.length === 0) return 0;
  const deleted = await db
    .delete(materialTagLinks)
    .where(
      and(
        eq(materialTagLinks.targetKind, kind),
        inArray(materialTagLinks.targetId, ids),
      ),
    )
    .returning({ targetId: materialTagLinks.targetId });
  return deleted.length;
}

async function liveRestoreFolder(
  userId: string,
  yearId: string,
  folderId: string | null,
) {
  if (!folderId) return null;
  const [folder] = await db
    .select({ id: materialFolders.id })
    .from(materialFolders)
    .where(
      and(
        eq(materialFolders.id, folderId),
        eq(materialFolders.userId, userId),
        eq(materialFolders.yearId, yearId),
        isNull(materialFolders.deletedAt),
      ),
    )
    .limit(1);
  return folder?.id ?? null;
}

async function starTarget(
  userId: string,
  kind: TargetKind,
  id: string,
  starred: boolean,
) {
  await requireTarget(userId, kind, id);
  const starredAt = starred ? new Date() : null;
  const whereOwner = (
    columnId: typeof materialFolders.id,
    userColumn: typeof materialFolders.userId,
  ) => and(eq(columnId, id), eq(userColumn, userId));
  switch (kind) {
    case "folder":
      await db
        .update(materialFolders)
        .set({ starredAt, updatedAt: new Date() })
        .where(whereOwner(materialFolders.id, materialFolders.userId));
      break;
    case "document":
      await db
        .update(materialDocuments)
        .set({ starredAt, updatedAt: new Date() })
        .where(
          and(
            eq(materialDocuments.id, id),
            eq(materialDocuments.userId, userId),
          ),
        );
      break;
    case "study":
      await db
        .update(studyDocuments)
        .set({ starredAt, updatedAt: new Date() })
        .where(
          and(eq(studyDocuments.id, id), eq(studyDocuments.userId, userId)),
        );
      break;
    case "recording":
      await db
        .update(lectureRecordings)
        .set({ starredAt, updatedAt: new Date() })
        .where(
          and(
            eq(lectureRecordings.id, id),
            eq(lectureRecordings.userId, userId),
          ),
        );
      break;
  }
  return { starredAt };
}

async function trashFolder(userId: string, folderId: string) {
  const folder = await requireMaterialFolder(userId, folderId);
  assertLocallyDeletableOrigin(folder.origin);
  if (folder.deletedAt) return { deletedAt: folder.deletedAt };
  const folderRows = await db
    .select({
      id: materialFolders.id,
      parentId: materialFolders.parentId,
      origin: materialFolders.origin,
    })
    .from(materialFolders)
    .where(
      and(
        eq(materialFolders.userId, userId),
        eq(materialFolders.yearId, folder.yearId),
      ),
    );
  const folderIds = [
    folder.id,
    ...collectMaterialFolderDescendantIds(folderRows, folder.id),
  ];
  if (
    folderRows.some(
      (row) => folderIds.includes(row.id) && row.origin !== "manual",
    )
  ) {
    badRequest(synchronizedDeletionError);
  }
  const [synchronizedDocument] = await db
    .select({ id: materialDocuments.id })
    .from(materialDocuments)
    .where(
      and(
        eq(materialDocuments.userId, userId),
        inArray(materialDocuments.folderId, folderIds),
        sql`${materialDocuments.origin} <> 'manual'`,
      ),
    )
    .limit(1);
  if (synchronizedDocument) badRequest(synchronizedDeletionError);
  const deletedAt = new Date();
  const deletedBatchId = newId("trash");
  await db.batch([
    db
      .update(materialFolders)
      .set({
        deletedAt,
        deletedFrom: sql`${materialFolders.parentId}`,
        deletedBy: "user",
        deletedBatchId,
        updatedAt: deletedAt,
      })
      .where(
        and(
          eq(materialFolders.userId, userId),
          inArray(materialFolders.id, folderIds),
          isNull(materialFolders.deletedAt),
        ),
      ),
    db
      .update(materialDocuments)
      .set({
        deletedAt,
        deletedFrom: sql`${materialDocuments.folderId}`,
        deletedBy: "user",
        deletedBatchId,
        updatedAt: deletedAt,
      })
      .where(
        and(
          eq(materialDocuments.userId, userId),
          inArray(materialDocuments.folderId, folderIds),
          isNull(materialDocuments.deletedAt),
        ),
      ),
    db
      .update(studyDocuments)
      .set({
        deletedAt,
        deletedFrom: sql`${studyDocuments.folderId}`,
        deletedBy: "user",
        deletedBatchId,
        updatedAt: deletedAt,
      })
      .where(
        and(
          eq(studyDocuments.userId, userId),
          inArray(studyDocuments.folderId, folderIds),
          isNull(studyDocuments.deletedAt),
        ),
      ),
    db
      .update(lectureRecordings)
      .set({
        deletedAt,
        deletedFrom: sql`${lectureRecordings.folderId}`,
        deletedBy: "user",
        deletedBatchId,
        updatedAt: deletedAt,
      })
      .where(
        and(
          eq(lectureRecordings.userId, userId),
          inArray(lectureRecordings.folderId, folderIds),
          isNull(lectureRecordings.deletedAt),
        ),
      ),
  ]);
  return { deletedAt };
}

export async function trashMaterialTarget(
  userId: string,
  kind: TargetKind,
  id: string,
) {
  if (kind === "folder") return trashFolder(userId, id);
  const target = (await requireTarget(userId, kind, id)) as {
    deletedAt: Date | null;
    folderId: string | null;
    origin?: string | null;
  };
  if (kind === "document") assertLocallyDeletableOrigin(target.origin);
  if (target.deletedAt) return { deletedAt: target.deletedAt };
  const deletedAt = new Date();
  const deletedBatchId = newId("trash");
  switch (kind) {
    case "document":
      await db
        .update(materialDocuments)
        .set({
          deletedAt,
          deletedFrom: target.folderId,
          deletedBy: "user",
          deletedBatchId,
          updatedAt: deletedAt,
        })
        .where(
          and(
            eq(materialDocuments.id, id),
            eq(materialDocuments.userId, userId),
            isNull(materialDocuments.deletedAt),
          ),
        );
      break;
    case "study":
      await db
        .update(studyDocuments)
        .set({
          deletedAt,
          deletedFrom: target.folderId,
          deletedBy: "user",
          deletedBatchId,
          updatedAt: deletedAt,
        })
        .where(
          and(
            eq(studyDocuments.id, id),
            eq(studyDocuments.userId, userId),
            isNull(studyDocuments.deletedAt),
          ),
        );
      break;
    case "recording":
      await db
        .update(lectureRecordings)
        .set({
          deletedAt,
          deletedFrom: target.folderId,
          deletedBy: "user",
          deletedBatchId,
          updatedAt: deletedAt,
        })
        .where(
          and(
            eq(lectureRecordings.id, id),
            eq(lectureRecordings.userId, userId),
            isNull(lectureRecordings.deletedAt),
          ),
        );
      break;
  }
  return { deletedAt };
}

async function restoreFolder(userId: string, folderId: string) {
  const folder = await requireMaterialFolder(userId, folderId);
  assertLocallyDeletableOrigin(folder.origin);
  if (!folder.deletedAt) return { folderId: folder.parentId };
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
  const destination = await liveRestoreFolder(
    userId,
    folder.yearId,
    folder.deletedFrom,
  );
  const restoredAt = new Date();
  const folderBatch = folder.deletedBatchId
    ? eq(materialFolders.deletedBatchId, folder.deletedBatchId)
    : and(
        eq(materialFolders.deletedAt, folder.deletedAt),
        isNull(materialFolders.deletedBatchId),
      );
  const documentBatch = folder.deletedBatchId
    ? eq(materialDocuments.deletedBatchId, folder.deletedBatchId)
    : and(
        eq(materialDocuments.deletedAt, folder.deletedAt),
        isNull(materialDocuments.deletedBatchId),
      );
  const studyBatch = folder.deletedBatchId
    ? eq(studyDocuments.deletedBatchId, folder.deletedBatchId)
    : and(
        eq(studyDocuments.deletedAt, folder.deletedAt),
        isNull(studyDocuments.deletedBatchId),
      );
  const recordingBatch = folder.deletedBatchId
    ? eq(lectureRecordings.deletedBatchId, folder.deletedBatchId)
    : and(
        eq(lectureRecordings.deletedAt, folder.deletedAt),
        isNull(lectureRecordings.deletedBatchId),
      );
  await db.batch([
    db
      .update(materialFolders)
      .set({
        deletedAt: null,
        deletedFrom: null,
        deletedBy: null,
        deletedBatchId: null,
        updatedAt: restoredAt,
      })
      .where(
        and(
          eq(materialFolders.userId, userId),
          inArray(materialFolders.id, folderIds),
          folderBatch,
        ),
      ),
    db
      .update(materialDocuments)
      .set({
        deletedAt: null,
        deletedFrom: null,
        deletedBy: null,
        deletedBatchId: null,
        updatedAt: restoredAt,
      })
      .where(
        and(
          eq(materialDocuments.userId, userId),
          inArray(materialDocuments.folderId, folderIds),
          documentBatch,
        ),
      ),
    db
      .update(studyDocuments)
      .set({
        deletedAt: null,
        deletedFrom: null,
        deletedBy: null,
        deletedBatchId: null,
        updatedAt: restoredAt,
      })
      .where(
        and(
          eq(studyDocuments.userId, userId),
          inArray(studyDocuments.folderId, folderIds),
          studyBatch,
        ),
      ),
    db
      .update(lectureRecordings)
      .set({
        deletedAt: null,
        deletedFrom: null,
        deletedBy: null,
        deletedBatchId: null,
        updatedAt: restoredAt,
      })
      .where(
        and(
          eq(lectureRecordings.userId, userId),
          inArray(lectureRecordings.folderId, folderIds),
          recordingBatch,
        ),
      ),
  ]);
  if (folder.parentId !== destination) {
    await db
      .update(materialFolders)
      .set({ parentId: destination, updatedAt: restoredAt })
      .where(
        and(
          eq(materialFolders.id, folder.id),
          eq(materialFolders.userId, userId),
        ),
      );
  }
  return { folderId: destination };
}

async function restoreTarget(userId: string, kind: TargetKind, id: string) {
  if (kind === "folder") return restoreFolder(userId, id);
  const target = (await requireTarget(userId, kind, id)) as {
    deletedAt: Date | null;
    deletedFrom: string | null;
    folderId: string | null;
    yearId: string;
    origin?: string | null;
  };
  if (kind === "document") assertLocallyDeletableOrigin(target.origin);
  if (!target.deletedAt) return { folderId: target.folderId };
  const folderId = await liveRestoreFolder(
    userId,
    target.yearId,
    target.deletedFrom,
  );
  switch (kind) {
    case "document":
      await db
        .update(materialDocuments)
        .set({
          folderId,
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(materialDocuments.id, id),
            eq(materialDocuments.userId, userId),
          ),
        );
      break;
    case "study":
      await db
        .update(studyDocuments)
        .set({
          folderId,
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          updatedAt: new Date(),
        })
        .where(
          and(eq(studyDocuments.id, id), eq(studyDocuments.userId, userId)),
        );
      break;
    case "recording":
      await db
        .update(lectureRecordings)
        .set({
          folderId,
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(lectureRecordings.id, id),
            eq(lectureRecordings.userId, userId),
          ),
        );
      break;
  }
  return { folderId };
}

async function purgeDocument(
  userId: string,
  documentId: string,
  removeFile: RemoveFile,
  removePreview: RemovePreview,
) {
  const document = await requireMaterialDocument(userId, documentId);
  if (document.fileId) {
    // Detach the derivative before removing the source. Provider failures use
    // deleteFile's durable cleanup ledger; an enqueue failure is surfaced so
    // the hourly reaper remains a fallback instead of silently orphaning it.
    await removePreview(userId, document.fileId);
  }
  await db.batch([
    db
      .delete(jobs)
      .where(
        and(
          eq(jobs.userId, userId),
          sql`json_extract(${jobs.payload}, '$.documentId') = ${document.id}`,
        ),
      ),
    db
      .delete(materialTagLinks)
      .where(
        and(
          eq(materialTagLinks.targetKind, "document"),
          eq(materialTagLinks.targetId, document.id),
        ),
      ),
    db
      .delete(materialDocuments)
      .where(
        and(
          eq(materialDocuments.id, document.id),
          eq(materialDocuments.userId, userId),
        ),
      ),
  ]);
  if (document.fileId) {
    // The owner edge is gone before the cleanup job can observe the source.
    await removeFile(userId, document.fileId);
  }
}

async function purgeStudy(
  userId: string,
  documentId: string,
  removeFile: RemoveFile,
) {
  const document = await requireStudyDocument(userId, documentId);
  const [exports, builds, artifacts] = await Promise.all([
    db
      .select({ fileId: studyDocumentExports.fileId })
      .from(studyDocumentExports)
      .where(
        and(
          eq(studyDocumentExports.documentId, document.id),
          eq(studyDocumentExports.userId, userId),
        ),
      ),
    db
      .select({
        id: studyDocumentBuilds.id,
        fileId: studyDocumentBuilds.pdfFileId,
      })
      .from(studyDocumentBuilds)
      .where(
        and(
          eq(studyDocumentBuilds.documentId, document.id),
          eq(studyDocumentBuilds.userId, userId),
        ),
      ),
    db
      .select({ id: documentArtifacts.id, fileId: documentArtifacts.fileId })
      .from(documentArtifacts)
      .where(
        and(
          eq(documentArtifacts.documentId, document.id),
          eq(documentArtifacts.userId, userId),
        ),
      ),
  ]);
  await db.batch([
    db.delete(jobs).where(
      and(
        eq(jobs.userId, userId),
        or(
          sql`json_extract(${jobs.payload}, '$.documentId') = ${document.id}`,
          builds.length > 0
            ? and(
                eq(jobs.kind, "build.documentLatex"),
                inArray(
                  sql<string>`json_extract(${jobs.payload}, '$.buildId')`,
                  builds.map((build) => build.id),
                ),
              )
            : undefined,
          artifacts.length > 0
            ? inArray(
                sql<string>`json_extract(${jobs.payload}, '$.artifactId')`,
                artifacts.map((artifact) => artifact.id),
              )
            : undefined,
        ),
      ),
    ),
    db
      .delete(materialTagLinks)
      .where(
        and(
          eq(materialTagLinks.targetKind, "study"),
          eq(materialTagLinks.targetId, document.id),
        ),
      ),
    db
      .delete(studyDocuments)
      .where(
        and(
          eq(studyDocuments.id, document.id),
          eq(studyDocuments.userId, userId),
        ),
      ),
  ]);
  const fileIds = [
    ...new Set([
      ...exports.map((entry) => entry.fileId),
      ...builds.flatMap((entry) => (entry.fileId ? [entry.fileId] : [])),
      ...artifacts.flatMap((entry) => (entry.fileId ? [entry.fileId] : [])),
    ]),
  ];
  await Promise.all(fileIds.map((fileId) => removeFile(userId, fileId)));
}

async function purgeRecording(
  userId: string,
  recordingId: string,
  removeFile: RemoveFile,
  queueJob: QueueJob,
) {
  const recording = await requireRecording(userId, recordingId);
  const [fenced] = await db
    .update(lectureRecordings)
    .set({ status: "deleting", error: null, updatedAt: new Date() })
    .where(
      and(
        eq(lectureRecordings.id, recording.id),
        eq(lectureRecordings.userId, userId),
      ),
    )
    .returning({ id: lectureRecordings.id });
  if (!fenced) badRequest("The lecture recording changed before purge");
  const segments = await db
    .select({ id: recordingSegments.id, fileId: recordingSegments.fileId })
    .from(recordingSegments)
    .where(
      and(
        eq(recordingSegments.recordingId, recording.id),
        eq(recordingSegments.userId, userId),
      ),
    );
  const segmentIds = segments.map((segment) => segment.id);
  await purgeRecordingTranscriptionJobs({
    userId,
    recordingId: recording.id,
    segmentIds,
  });
  const cleanupBatchId = newId("cleanup");
  await Promise.all(
    segments.map((segment) =>
      queueJob({
        kind: CLEANUP_UNOWNED_FILE_JOB_KIND,
        payload: { userId, fileId: segment.fileId },
        userId,
        idempotencyKey: `${segment.fileId}:${cleanupBatchId}`,
        runAt: new Date(Date.now() + 60_000),
        maxAttempts: 6,
      }),
    ),
  );
  await db.batch([
    db
      .delete(materialTagLinks)
      .where(
        and(
          eq(materialTagLinks.targetKind, "recording"),
          eq(materialTagLinks.targetId, recording.id),
        ),
      ),
    db
      .delete(lectureRecordings)
      .where(
        and(
          eq(lectureRecordings.id, recording.id),
          eq(lectureRecordings.userId, userId),
        ),
      ),
  ]);
  await purgeRecordingTranscriptionJobs({
    userId,
    recordingId: recording.id,
    segmentIds,
  });
  await Promise.all(
    segments.map((segment) =>
      removeFile(userId, segment.fileId, {
        deferOnProviderFailure: false,
      }).catch(() => undefined),
    ),
  );
}

async function purgeFolder(
  userId: string,
  folderId: string,
  removeFile: RemoveFile,
  removePreview: RemovePreview,
  queueJob: QueueJob,
  allowSynchronized: boolean,
) {
  const folder = await requireMaterialFolder(userId, folderId);
  if (!allowSynchronized) assertLocallyDeletableOrigin(folder.origin);
  const rows = await db
    .select({
      id: materialFolders.id,
      parentId: materialFolders.parentId,
      origin: materialFolders.origin,
      deletedAt: materialFolders.deletedAt,
      deletedBy: materialFolders.deletedBy,
    })
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
  const [documents, studies, recordings] = await Promise.all([
    db
      .select({
        id: materialDocuments.id,
        origin: materialDocuments.origin,
        deletedAt: materialDocuments.deletedAt,
        deletedBy: materialDocuments.deletedBy,
      })
      .from(materialDocuments)
      .where(
        and(
          eq(materialDocuments.userId, userId),
          inArray(materialDocuments.folderId, folderIds),
        ),
      ),
    db
      .select({ id: studyDocuments.id })
      .from(studyDocuments)
      .where(
        and(
          eq(studyDocuments.userId, userId),
          inArray(studyDocuments.folderId, folderIds),
        ),
      ),
    db
      .select({ id: lectureRecordings.id })
      .from(lectureRecordings)
      .where(
        and(
          eq(lectureRecordings.userId, userId),
          inArray(lectureRecordings.folderId, folderIds),
        ),
      ),
  ]);
  const disallowedSynchronizedTarget = (
    target: Parameters<typeof isSynchronizedProviderTombstone>[0],
  ) =>
    target.origin !== "manual" &&
    (!allowSynchronized || !isSynchronizedProviderTombstone(target));
  if (
    rows.some(
      (row) => folderIds.includes(row.id) && disallowedSynchronizedTarget(row),
    ) ||
    documents.some(disallowedSynchronizedTarget)
  ) {
    badRequest(synchronizedDeletionError);
  }
  for (const recording of recordings) {
    await purgeRecording(userId, recording.id, removeFile, queueJob);
  }
  for (const study of studies) {
    await purgeStudy(userId, study.id, removeFile);
  }
  for (const document of documents) {
    await purgeDocument(userId, document.id, removeFile, removePreview);
  }
  await deleteMaterialTargetTagLinks("folder", folderIds);
  await db
    .delete(materialFolders)
    .where(
      and(
        eq(materialFolders.userId, userId),
        inArray(materialFolders.id, folderIds),
      ),
    );
}

async function purgeTarget(
  userId: string,
  kind: TargetKind,
  id: string,
  removeFile: RemoveFile,
  removePreview: RemovePreview,
  queueJob: QueueJob,
  allowSynchronized = false,
) {
  const target = (await requireTarget(userId, kind, id)) as Awaited<
    ReturnType<typeof requireTarget>
  > & {
    origin?: string | null;
    deletedBy?: string | null;
  };
  const providerTombstone = isSynchronizedProviderTombstone(target);
  if (
    (kind === "folder" || kind === "document") &&
    target.origin !== "manual" &&
    !providerTombstone
  ) {
    badRequest(synchronizedDeletionError);
  }
  if (!target.deletedAt) {
    badRequest("Only a trashed material can be permanently deleted");
  }
  switch (kind) {
    case "folder":
      await purgeFolder(
        userId,
        id,
        removeFile,
        removePreview,
        queueJob,
        allowSynchronized || providerTombstone,
      );
      break;
    case "document":
      await purgeDocument(userId, id, removeFile, removePreview);
      break;
    case "study":
      await purgeStudy(userId, id, removeFile);
      break;
    case "recording":
      await purgeRecording(userId, id, removeFile, queueJob);
      break;
  }
  return { ok: true as const };
}

/**
 * Shared permanent-delete boundary used by the explorer contract and by
 * legacy delete aliases after their first (trash) call.
 */
export function purgeMaterialTarget(
  userId: string,
  kind: TargetKind,
  id: string,
  dependencies: MaterialsOperationsRouterDependencies = {},
) {
  return purgeTarget(
    userId,
    kind,
    id,
    dependencies.deleteFile ?? deleteFile,
    dependencies.deleteFilePreview ?? deleteFilePreview,
    dependencies.enqueueJob ?? enqueueJob,
  );
}

async function emptyTrash(
  userId: string,
  yearId: string,
  removeFile: RemoveFile,
  removePreview: RemovePreview,
  queueJob: QueueJob,
) {
  const [folders, documents, studies, recordings] = await Promise.all([
    db
      .select({ id: materialFolders.id, parentId: materialFolders.parentId })
      .from(materialFolders)
      .where(
        and(
          eq(materialFolders.userId, userId),
          eq(materialFolders.yearId, yearId),
          sql`${materialFolders.deletedAt} is not null`,
        ),
      ),
    db
      .select({ id: materialDocuments.id })
      .from(materialDocuments)
      .where(
        and(
          eq(materialDocuments.userId, userId),
          eq(materialDocuments.yearId, yearId),
          sql`${materialDocuments.deletedAt} is not null`,
        ),
      ),
    db
      .select({ id: studyDocuments.id })
      .from(studyDocuments)
      .where(
        and(
          eq(studyDocuments.userId, userId),
          eq(studyDocuments.yearId, yearId),
          sql`${studyDocuments.deletedAt} is not null`,
        ),
      ),
    db
      .select({ id: lectureRecordings.id })
      .from(lectureRecordings)
      .where(
        and(
          eq(lectureRecordings.userId, userId),
          eq(lectureRecordings.yearId, yearId),
          sql`${lectureRecordings.deletedAt} is not null`,
        ),
      ),
  ]);
  const purged =
    folders.length + documents.length + studies.length + recordings.length;
  const trashedFolderIds = new Set(folders.map((folder) => folder.id));
  const roots = folders.filter(
    (folder) => !folder.parentId || !trashedFolderIds.has(folder.parentId),
  );
  for (const folder of roots) {
    await purgeFolder(
      userId,
      folder.id,
      removeFile,
      removePreview,
      queueJob,
      true,
    );
  }
  for (const kind of ["document", "study", "recording"] as const) {
    const table =
      kind === "document"
        ? materialDocuments
        : kind === "study"
          ? studyDocuments
          : lectureRecordings;
    const remaining = await db
      .select({ id: table.id })
      .from(table)
      .where(
        and(
          eq(table.userId, userId),
          eq(table.yearId, yearId),
          sql`${table.deletedAt} is not null`,
        ),
      );
    for (const target of remaining) {
      await purgeTarget(
        userId,
        kind,
        target.id,
        removeFile,
        removePreview,
        queueJob,
        true,
      );
    }
  }
  return { purged };
}

export interface MaterialsOperationsRouterDependencies {
  deleteFile?: RemoveFile;
  deleteFilePreview?: RemovePreview;
  enqueueJob?: QueueJob;
}

export function createMaterialsOperationsRouter(
  dependencies: MaterialsOperationsRouterDependencies = {},
) {
  const removeFile = dependencies.deleteFile ?? deleteFile;
  const removePreview = dependencies.deleteFilePreview ?? deleteFilePreview;
  const queueJob = dependencies.enqueueJob ?? enqueueJob;
  const targetInput = z
    .object({ kind: materialTargetKindSchema, id: z.string().min(1) })
    .strict();
  return {
    star: protectedProcedure
      .input(targetInput.extend({ starred: z.boolean() }))
      .handler(({ context, input }) =>
        starTarget(
          context.session.user.id,
          input.kind,
          input.id,
          input.starred,
        ),
      ),
    trash: protectedProcedure
      .input(targetInput)
      .handler(({ context, input }) =>
        trashMaterialTarget(context.session.user.id, input.kind, input.id),
      ),
    restore: protectedProcedure
      .input(targetInput)
      .handler(({ context, input }) =>
        restoreTarget(context.session.user.id, input.kind, input.id),
      ),
    purge: protectedProcedure
      .input(targetInput)
      .handler(({ context, input }) =>
        purgeMaterialTarget(
          context.session.user.id,
          input.kind,
          input.id,
          dependencies,
        ),
      ),
    emptyTrash: protectedProcedure
      .input(z.object({ yearId: z.string().min(1) }).strict())
      .handler(async ({ context, input }) => {
        const userId = context.session.user.id;
        await requireYear(userId, input.yearId);
        return emptyTrash(
          userId,
          input.yearId,
          removeFile,
          removePreview,
          queueJob,
        );
      }),
  };
}

export const materialsOperationsRouter = createMaterialsOperationsRouter();

interface ExpiredMaterialTrashTarget {
  kind: TargetKind;
  id: string;
  userId: string;
  deletedAt: Date;
  parentId: string | null;
}

function targetCursor(
  target: ExpiredMaterialTrashTarget,
): MaterialTrashPurgeCursor {
  return {
    kind: target.kind,
    deletedAt: target.deletedAt.toISOString(),
    id: target.id,
  };
}

function cursorDate(cursor: MaterialTrashPurgeCursor | null) {
  return cursor ? new Date(cursor.deletedAt) : null;
}

async function selectExpiredTrashTargets(
  kind: TargetKind,
  cutoff: Date,
  cursor: MaterialTrashPurgeCursor | null,
  limit: number,
): Promise<ExpiredMaterialTrashTarget[]> {
  const after = cursorDate(cursor);
  switch (kind) {
    case "folder": {
      const rows = await db
        .select({
          id: materialFolders.id,
          userId: materialFolders.userId,
          deletedAt: materialFolders.deletedAt,
          parentId: materialFolders.parentId,
        })
        .from(materialFolders)
        .where(
          and(
            lt(materialFolders.deletedAt, cutoff),
            after && cursor
              ? or(
                  gt(materialFolders.deletedAt, after),
                  and(
                    eq(materialFolders.deletedAt, after),
                    gt(materialFolders.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(materialFolders.deletedAt), asc(materialFolders.id))
        .limit(limit);
      return rows.flatMap((row) =>
        row.deletedAt ? [{ kind, ...row, deletedAt: row.deletedAt }] : [],
      );
    }
    case "document": {
      const rows = await db
        .select({
          id: materialDocuments.id,
          userId: materialDocuments.userId,
          deletedAt: materialDocuments.deletedAt,
        })
        .from(materialDocuments)
        .where(
          and(
            lt(materialDocuments.deletedAt, cutoff),
            after && cursor
              ? or(
                  gt(materialDocuments.deletedAt, after),
                  and(
                    eq(materialDocuments.deletedAt, after),
                    gt(materialDocuments.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(materialDocuments.deletedAt), asc(materialDocuments.id))
        .limit(limit);
      return rows.flatMap((row) =>
        row.deletedAt
          ? [{ kind, ...row, deletedAt: row.deletedAt, parentId: null }]
          : [],
      );
    }
    case "study": {
      const rows = await db
        .select({
          id: studyDocuments.id,
          userId: studyDocuments.userId,
          deletedAt: studyDocuments.deletedAt,
        })
        .from(studyDocuments)
        .where(
          and(
            lt(studyDocuments.deletedAt, cutoff),
            after && cursor
              ? or(
                  gt(studyDocuments.deletedAt, after),
                  and(
                    eq(studyDocuments.deletedAt, after),
                    gt(studyDocuments.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(studyDocuments.deletedAt), asc(studyDocuments.id))
        .limit(limit);
      return rows.flatMap((row) =>
        row.deletedAt
          ? [{ kind, ...row, deletedAt: row.deletedAt, parentId: null }]
          : [],
      );
    }
    case "recording": {
      const rows = await db
        .select({
          id: lectureRecordings.id,
          userId: lectureRecordings.userId,
          deletedAt: lectureRecordings.deletedAt,
        })
        .from(lectureRecordings)
        .where(
          and(
            lt(lectureRecordings.deletedAt, cutoff),
            after && cursor
              ? or(
                  gt(lectureRecordings.deletedAt, after),
                  and(
                    eq(lectureRecordings.deletedAt, after),
                    gt(lectureRecordings.id, cursor.id),
                  ),
                )
              : undefined,
          ),
        )
        .orderBy(asc(lectureRecordings.deletedAt), asc(lectureRecordings.id))
        .limit(limit);
      return rows.flatMap((row) =>
        row.deletedAt
          ? [{ kind, ...row, deletedAt: row.deletedAt, parentId: null }]
          : [],
      );
    }
  }
}

async function expiredFolderRoots(
  candidates: readonly ExpiredMaterialTrashTarget[],
  cutoff: Date,
) {
  const parentIds = [
    ...new Set(
      candidates.flatMap((candidate) =>
        candidate.parentId ? [candidate.parentId] : [],
      ),
    ),
  ];
  if (parentIds.length === 0) {
    return new Set(candidates.map((candidate) => candidate.id));
  }
  const parents = await db
    .select({
      id: materialFolders.id,
      userId: materialFolders.userId,
      deletedAt: materialFolders.deletedAt,
    })
    .from(materialFolders)
    .where(inArray(materialFolders.id, parentIds));
  const expiredParents = new Set(
    parents.flatMap((parent) =>
      parent.deletedAt && parent.deletedAt < cutoff
        ? [`${parent.userId}\u0000${parent.id}`]
        : [],
    ),
  );
  return new Set(
    candidates.flatMap((candidate) =>
      !candidate.parentId ||
      !expiredParents.has(`${candidate.userId}\u0000${candidate.parentId}`)
        ? [candidate.id]
        : [],
    ),
  );
}

async function hasExpiredTrashAfter(
  cutoff: Date,
  cursor: MaterialTrashPurgeCursor,
) {
  const start = materialTrashPurgeKinds.indexOf(cursor.kind);
  for (let index = start; index < materialTrashPurgeKinds.length; index += 1) {
    const kind = materialTrashPurgeKinds[index];
    if (!kind) continue;
    const rows = await selectExpiredTrashTargets(
      kind,
      cutoff,
      index === start ? cursor : null,
      1,
    );
    if (rows.length > 0) return true;
  }
  return false;
}

function materialTrashPurgeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500) || "Material trash purge failed";
}

/**
 * One bounded, keyset-paginated maintenance pass. A failed target is reported
 * and skipped for this sweep so one broken provider object cannot block every
 * other user's trash. The next daily root pass retries anything still present.
 */
export async function purgeExpiredMaterialTrash(
  cutoff: Date,
  dependencies: MaterialsOperationsRouterDependencies & {
    batchSize?: number;
    cursor?: MaterialTrashPurgeCursor | null;
  } = {},
) {
  if (Number.isNaN(cutoff.getTime())) {
    throw new Error("Material trash purge cutoff must be a valid date");
  }
  const batchSize = dependencies.batchSize ?? MATERIAL_TRASH_PURGE_BATCH_SIZE;
  if (
    !Number.isInteger(batchSize) ||
    batchSize < 1 ||
    batchSize > MATERIAL_TRASH_PURGE_MAX_BATCH_SIZE
  ) {
    throw new Error("Material trash purge batchSize must be between 1 and 100");
  }
  const cursor = dependencies.cursor
    ? materialTrashPurgeCursorSchema.parse(dependencies.cursor)
    : null;
  const removeFile = dependencies.deleteFile ?? deleteFile;
  const removePreview = dependencies.deleteFilePreview ?? deleteFilePreview;
  const queueJob = dependencies.enqueueJob ?? enqueueJob;
  const failures: Array<{ kind: TargetKind; id: string; error: string }> = [];
  let purged = 0;
  let skipped = 0;
  let examined = 0;
  let nextCursor = cursor;
  const start = cursor ? materialTrashPurgeKinds.indexOf(cursor.kind) : 0;

  for (
    let index = start;
    index < materialTrashPurgeKinds.length && examined < batchSize;
    index += 1
  ) {
    const kind = materialTrashPurgeKinds[index];
    if (!kind) continue;
    const candidates = await selectExpiredTrashTargets(
      kind,
      cutoff,
      index === start ? cursor : null,
      batchSize - examined,
    );
    const folderRoots =
      kind === "folder" ? await expiredFolderRoots(candidates, cutoff) : null;
    for (const candidate of candidates) {
      examined += 1;
      nextCursor = targetCursor(candidate);
      if (folderRoots && !folderRoots.has(candidate.id)) {
        skipped += 1;
        continue;
      }
      try {
        await purgeTarget(
          candidate.userId,
          candidate.kind,
          candidate.id,
          removeFile,
          removePreview,
          queueJob,
          true,
        );
        purged += 1;
      } catch (error) {
        failures.push({
          kind: candidate.kind,
          id: candidate.id,
          error: materialTrashPurgeError(error),
        });
      }
    }
  }

  const hasMore = nextCursor
    ? await hasExpiredTrashAfter(cutoff, nextCursor)
    : false;
  return {
    examined,
    purged,
    skipped,
    failed: failures.length,
    failures,
    cursor: nextCursor,
    hasMore,
  };
}
