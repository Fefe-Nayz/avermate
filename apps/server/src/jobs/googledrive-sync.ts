import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  contentConnections,
  jobs,
  lectureRecordings,
  materialDocuments,
  materialFolders,
  studyDocuments,
} from "../db/schema";
import {
  createGoogleDriveChannel,
  deleteGoogleDriveChannel,
  downloadGoogleDriveFile,
  exportGoogleDriveFile,
  getGoogleDriveStartPageToken,
  googleDriveExportTarget,
  googleDriveFileSize,
  googleDriveWebhookTokenHash,
  listGoogleDriveChildren,
  newGoogleDriveWebhookToken,
  readGoogleDriveChangesPage,
  requireGoogleDriveFolder,
  type ContentConnection,
  type GoogleDriveChange,
  GoogleDriveCursorExpiredError,
  type GoogleDriveFile,
  type GoogleDriveHttpDependencies,
  GOOGLE_DRIVE_FOLDER_MIME,
  GOOGLE_DRIVE_SHORTCUT_MIME,
} from "../lib/googledrive";
import { enqueueJob, NonRetryableJobError } from "../lib/jobs";
import { newId } from "../lib/id";
import {
  deleteFile,
  deleteFilePreview,
  FILE_CONSTRAINTS,
  resolvedFileMimeType,
  storeFile,
} from "../lib/storage";
import {
  CredentialsRevokedSyncError,
  NonRetryableSyncError,
  RetryableSyncError,
} from "../sync/errors";
import { materializeProviderDownload } from "../sync/run";
import { enqueueMaterialPreview } from "./material-preview";

export const GOOGLE_DRIVE_SYNC_JOB_KIND = "connectors.googledrive.sync";
export const GOOGLE_DRIVE_CHANNEL_RENEW_JOB_KIND =
  "connectors.googledrive.renewChannel";
export const GOOGLE_DRIVE_CHANNEL_RECONCILE_JOB_KIND =
  "maintenance.reconcileGoogleDriveChannels";

const MAX_CHANGE_PAGES = 250;
const MAX_CHANGE_ITEMS = 100_000;
const MAX_SNAPSHOT_ITEMS = 100_000;
const FOLDER_WRITE_BATCH_SIZE = 200;
const CHANNEL_RENEW_EARLY_MS = 24 * 60 * 60_000;
const CHANNEL_RECONCILE_INTERVAL_MS = 24 * 60 * 60_000;
export const GOOGLE_DRIVE_CHANNEL_RECONCILE_BATCH_SIZE = 500;

const syncPayloadSchema = z.object({ connectionId: z.string().min(1) });
const reconcilePayloadSchema = z
  .object({ scheduledFor: z.string().datetime() })
  .strict();

type Enqueue = typeof enqueueJob;

interface GoogleDriveMaterialMeta {
  externalId: string;
  provider: "googledrive";
  version: string | null;
  md5Checksum: string | null;
  modifiedTime: string | null;
  sourceMimeType: string;
  exportMimeType: string | null;
}

interface RemoteItem {
  id: string;
  removed: boolean;
  file: GoogleDriveFile | null;
}

export interface GoogleDriveSyncResult {
  downloaded: number;
  updated: number;
  trashed: number;
  skipped: number;
  unsupported: number;
  errors: Array<{ externalId: string; message: string }>;
}

export interface GoogleDriveSyncDependencies extends GoogleDriveHttpDependencies {
  jobId?: string;
  storeFile?: typeof storeFile;
  deleteFile?: typeof deleteFile;
  deleteFilePreview?: typeof deleteFilePreview;
  enqueuePreview?: typeof enqueueMaterialPreview;
}

export interface GoogleDriveChannelReconcileDependencies extends GoogleDriveHttpDependencies {
  enqueue?: Enqueue;
  createChannel?: typeof createGoogleDriveChannel;
  deleteChannel?: typeof deleteGoogleDriveChannel;
  getStartPageToken?: typeof getGoogleDriveStartPageToken;
  batchSize?: number;
}

function safeError(error: unknown) {
  return (
    (error instanceof Error ? error.message : String(error))
      .replace(/https?:\/\/\S+/gi, "the Google service")
      .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]")
      .slice(0, 500) || "Unknown Google Drive synchronization error"
  );
}

function isFolder(file: GoogleDriveFile) {
  return file.mimeType === GOOGLE_DRIVE_FOLDER_MIME;
}

function binaryMimeType(file: GoogleDriveFile) {
  return resolvedFileMimeType("course-material", {
    name: file.name,
    type: file.mimeType,
  });
}

export function resolveGoogleDriveMaterialMimeType(file: GoogleDriveFile) {
  return (
    googleDriveExportTarget(file.mimeType)?.mimeType ?? binaryMimeType(file)
  );
}

function materialMimeType(file: GoogleDriveFile) {
  const resolved = resolveGoogleDriveMaterialMimeType(file);
  if (!resolved) {
    throw new NonRetryableSyncError(
      "The Google Drive item has an unsupported material type",
    );
  }
  return resolved;
}

function materialFileName(file: GoogleDriveFile) {
  const target = googleDriveExportTarget(file.mimeType);
  if (!target || file.name.toLowerCase().endsWith(target.extension)) {
    return file.name;
  }
  return `${file.name}${target.extension}`;
}

function isSupportedMaterial(file: GoogleDriveFile) {
  if (isFolder(file) || file.mimeType === GOOGLE_DRIVE_SHORTCUT_MIME) {
    return false;
  }
  if (file.capabilities?.canDownload === false) return false;
  const size = googleDriveFileSize(file);
  if (size !== null && size > FILE_CONSTRAINTS["course-material"].maxBytes) {
    return false;
  }
  return Boolean(resolveGoogleDriveMaterialMimeType(file));
}

function metaOf(file: GoogleDriveFile): GoogleDriveMaterialMeta {
  return {
    externalId: file.id,
    provider: "googledrive",
    version:
      file.version === undefined || file.version === null
        ? null
        : String(file.version),
    md5Checksum: file.md5Checksum ?? null,
    modifiedTime: file.modifiedTime ?? null,
    sourceMimeType: file.mimeType,
    exportMimeType: googleDriveExportTarget(file.mimeType)?.mimeType ?? null,
  };
}

function existingMeta(value: unknown): GoogleDriveMaterialMeta | null {
  const parsed = z
    .object({
      externalId: z.string(),
      provider: z.literal("googledrive"),
      version: z.string().nullable(),
      md5Checksum: z.string().nullable(),
      modifiedTime: z.string().nullable(),
      sourceMimeType: z.string(),
      exportMimeType: z.string().nullable(),
    })
    .safeParse(value);
  return parsed.success ? parsed.data : null;
}

function sameRemoteRevision(
  previous: GoogleDriveMaterialMeta | null,
  next: GoogleDriveMaterialMeta,
) {
  if (!previous) return false;
  if (
    previous.sourceMimeType !== next.sourceMimeType ||
    previous.exportMimeType !== next.exportMimeType
  ) {
    return false;
  }
  if (previous.version && next.version)
    return previous.version === next.version;
  if (previous.md5Checksum && next.md5Checksum) {
    return previous.md5Checksum === next.md5Checksum;
  }
  return Boolean(
    previous.modifiedTime &&
    next.modifiedTime &&
    previous.modifiedTime === next.modifiedTime,
  );
}

async function loadConnection(connectionId: string) {
  const [connection] = await db
    .select()
    .from(contentConnections)
    .where(
      and(
        eq(contentConnections.id, connectionId),
        eq(contentConnections.provider, "googledrive"),
      ),
    )
    .limit(1);
  if (!connection) {
    throw new NonRetryableJobError(
      "The Google Drive connection is unavailable",
    );
  }
  return connection;
}

async function readChanges(
  connection: ContentConnection,
  initialPageToken: string,
  dependencies: GoogleDriveHttpDependencies,
) {
  const changes: GoogleDriveChange[] = [];
  let pageToken = initialPageToken;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_CHANGE_PAGES || changes.length > MAX_CHANGE_ITEMS) {
      throw new NonRetryableSyncError(
        "The Google Drive changes feed is too large to synchronize safely",
      );
    }
    const result = await readGoogleDriveChangesPage(
      connection,
      pageToken,
      dependencies,
    );
    changes.push(...result.changes);
    if (changes.length > MAX_CHANGE_ITEMS) {
      throw new NonRetryableSyncError(
        "The Google Drive changes feed is too large to synchronize safely",
      );
    }
    if (result.nextPageToken) {
      pageToken = result.nextPageToken;
      continue;
    }
    if (!result.newStartPageToken) {
      throw new RetryableSyncError(
        "Google Drive did not finish the changes feed",
      );
    }
    return { changes, cursor: result.newStartPageToken };
  }
}

async function crawlSnapshot(
  connection: ContentConnection,
  dependencies: GoogleDriveHttpDependencies,
) {
  const roots = connection.scopeJson?.folderIds ?? [];
  const files = new Map<string, GoogleDriveFile>();
  const queue: GoogleDriveFile[] = [];
  for (const folderId of roots) {
    const folder = await requireGoogleDriveFolder(
      connection,
      folderId,
      dependencies,
    );
    files.set(folder.id, folder);
    queue.push(folder);
  }
  for (let index = 0; index < queue.length; index += 1) {
    if (files.size > MAX_SNAPSHOT_ITEMS) {
      throw new NonRetryableSyncError(
        "The selected Google Drive folders are too large to synchronize safely",
      );
    }
    const folder = queue[index]!;
    const children = await listGoogleDriveChildren(
      connection,
      folder.id,
      dependencies,
    );
    for (const child of children) {
      if (files.has(child.id)) continue;
      files.set(child.id, child);
      if (isFolder(child)) queue.push(child);
    }
  }
  return files;
}

function applyChanges(
  snapshot: Map<string, GoogleDriveFile>,
  changes: readonly GoogleDriveChange[],
) {
  const removed = new Set<string>();
  for (const change of changes) {
    // Shared-drive membership changes do not describe a material and omit
    // fileId. A removed selected drive behaves like a removed scope root.
    if (change.changeType === "drive") {
      if (change.removed && change.driveId) {
        snapshot.delete(change.driveId);
        removed.add(change.driveId);
      }
      continue;
    }
    const fileId = change.fileId ?? change.file?.id;
    if (!fileId) continue;
    if (change.removed || !change.file) {
      snapshot.delete(fileId);
      removed.add(fileId);
      continue;
    }
    snapshot.set(fileId, change.file);
    removed.delete(fileId);
  }
  return [
    ...[...snapshot.values()].map((file): RemoteItem => ({
      id: file.id,
      removed: false,
      file,
    })),
    ...[...removed].map((id): RemoteItem => ({
      id,
      removed: true,
      file: null,
    })),
  ];
}

async function readFullSnapshot(
  connection: ContentConnection,
  dependencies: GoogleDriveHttpDependencies,
) {
  // Take the token before crawling, then close the crawl race by replaying all
  // changes that happened while the recursive snapshot was being read.
  const startPageToken = await getGoogleDriveStartPageToken(
    connection,
    dependencies,
  );
  const snapshot = await crawlSnapshot(connection, dependencies);
  const delta = await readChanges(connection, startPageToken, dependencies);
  return {
    items: applyChanges(snapshot, delta.changes),
    cursor: delta.cursor,
    fullSnapshot: true,
  };
}

async function readRemoteState(
  connection: ContentConnection,
  dependencies: GoogleDriveHttpDependencies,
) {
  if (!connection.cursor) return readFullSnapshot(connection, dependencies);
  try {
    const delta = await readChanges(
      connection,
      connection.cursor,
      dependencies,
    );
    const selected = new Set(connection.scopeJson?.folderIds ?? []);
    if (
      delta.changes.some(
        (change) =>
          change.changeType === "drive" &&
          !change.removed &&
          Boolean(change.driveId && selected.has(change.driveId)),
      )
    ) {
      // A newly available/changed selected shared drive may contain an entire
      // unchanged subtree, while its membership event contains no file rows.
      return readFullSnapshot(connection, dependencies);
    }
    return {
      items: applyChanges(new Map(), delta.changes),
      cursor: delta.cursor,
      fullSnapshot: false,
    };
  } catch (error) {
    if (error instanceof GoogleDriveCursorExpiredError) {
      return readFullSnapshot(connection, dependencies);
    }
    throw error;
  }
}

function currentSyncRevision(connection: ContentConnection) {
  return exists(
    db
      .select({ id: contentConnections.id })
      .from(contentConnections)
      .where(
        and(
          eq(contentConnections.id, connection.id),
          eq(contentConnections.userId, connection.userId),
          eq(contentConnections.provider, "googledrive"),
          eq(contentConnections.syncRevision, connection.syncRevision),
        ),
      ),
  );
}

async function assertCurrentSyncRevision(connection: ContentConnection) {
  const [current] = await db
    .select({ id: contentConnections.id })
    .from(contentConnections)
    .where(
      and(
        eq(contentConnections.id, connection.id),
        eq(contentConnections.userId, connection.userId),
        eq(contentConnections.provider, "googledrive"),
        eq(contentConnections.syncRevision, connection.syncRevision),
      ),
    )
    .limit(1);
  if (!current) {
    throw new RetryableSyncError(
      "The Google Drive scope changed during synchronization",
    );
  }
}

function descendantsOf(
  folderId: string,
  folders: Array<typeof materialFolders.$inferSelect>,
) {
  const descendants = new Set([folderId]);
  let advanced = true;
  while (advanced) {
    advanced = false;
    for (const folder of folders) {
      if (
        folder.parentId &&
        descendants.has(folder.parentId) &&
        !descendants.has(folder.id)
      ) {
        descendants.add(folder.id);
        advanced = true;
      }
    }
  }
  return descendants;
}

async function trashDocument(
  connection: ContentConnection,
  document: typeof materialDocuments.$inferSelect,
  now: Date,
) {
  if (document.deletedAt) return false;
  await assertCurrentSyncRevision(connection);
  const [trashed] = await db
    .update(materialDocuments)
    .set({
      deletedAt: now,
      deletedFrom: document.folderId,
      deletedBy: "provider",
      deletedBatchId: newId("trash"),
      updatedAt: now,
    })
    .where(
      and(
        eq(materialDocuments.id, document.id),
        eq(materialDocuments.userId, document.userId),
        isNull(materialDocuments.deletedAt),
        currentSyncRevision(connection),
      ),
    )
    .returning({ id: materialDocuments.id });
  return Boolean(trashed);
}

async function trashFolderTree(
  connection: ContentConnection,
  folder: typeof materialFolders.$inferSelect,
  folders: Array<typeof materialFolders.$inferSelect>,
  now: Date,
) {
  if (folder.deletedAt) return 0;
  await assertCurrentSyncRevision(connection);
  const deletedBatchId = newId("trash");
  const ids = [...descendantsOf(folder.id, folders)];
  const mappedIds = new Set(ids);
  const allFolders = await db
    .select()
    .from(materialFolders)
    .where(
      and(
        eq(materialFolders.userId, folder.userId),
        eq(materialFolders.yearId, folder.yearId),
      ),
    );
  const allById = new Map(allFolders.map((row) => [row.id, row]));
  let destination = folder.parentId;
  const seen = new Set<string>();
  while (destination && !seen.has(destination)) {
    seen.add(destination);
    const candidate = allById.get(destination);
    if (candidate && !candidate.deletedAt && !mappedIds.has(candidate.id))
      break;
    destination = candidate?.parentId ?? null;
  }

  const [, , , , trashedFolders, trashedDocuments] = await db.batch([
    db
      .update(materialFolders)
      .set({ parentId: destination, updatedAt: now })
      .where(
        and(
          eq(materialFolders.userId, folder.userId),
          inArray(materialFolders.parentId, ids),
          or(
            isNull(materialFolders.connectionId),
            ne(materialFolders.connectionId, connection.id),
          ),
          isNull(materialFolders.deletedAt),
          currentSyncRevision(connection),
        ),
      ),
    db
      .update(materialDocuments)
      .set({ folderId: destination, updatedAt: now })
      .where(
        and(
          eq(materialDocuments.userId, folder.userId),
          inArray(materialDocuments.folderId, ids),
          or(
            isNull(materialDocuments.connectionId),
            ne(materialDocuments.connectionId, connection.id),
          ),
          isNull(materialDocuments.deletedAt),
          currentSyncRevision(connection),
        ),
      ),
    db
      .update(studyDocuments)
      .set({ folderId: destination, updatedAt: now })
      .where(
        and(
          eq(studyDocuments.userId, folder.userId),
          inArray(studyDocuments.folderId, ids),
          isNull(studyDocuments.deletedAt),
          currentSyncRevision(connection),
        ),
      ),
    db
      .update(lectureRecordings)
      .set({ folderId: destination, updatedAt: now })
      .where(
        and(
          eq(lectureRecordings.userId, folder.userId),
          inArray(lectureRecordings.folderId, ids),
          isNull(lectureRecordings.deletedAt),
          currentSyncRevision(connection),
        ),
      ),
    db
      .update(materialFolders)
      .set({
        deletedAt: now,
        deletedFrom: sql`${materialFolders.parentId}`,
        deletedBy: "provider",
        deletedBatchId,
        updatedAt: now,
      })
      .where(
        and(
          eq(materialFolders.userId, folder.userId),
          inArray(materialFolders.id, ids),
          eq(materialFolders.connectionId, connection.id),
          isNull(materialFolders.deletedAt),
          currentSyncRevision(connection),
        ),
      )
      .returning({ id: materialFolders.id }),
    db
      .update(materialDocuments)
      .set({
        deletedAt: now,
        deletedFrom: sql`${materialDocuments.folderId}`,
        deletedBy: "provider",
        deletedBatchId,
        updatedAt: now,
      })
      .where(
        and(
          eq(materialDocuments.userId, folder.userId),
          inArray(materialDocuments.folderId, ids),
          eq(materialDocuments.connectionId, connection.id),
          isNull(materialDocuments.deletedAt),
          currentSyncRevision(connection),
        ),
      )
      .returning({ id: materialDocuments.id }),
  ]);
  return trashedFolders.length + trashedDocuments.length;
}

/** Tombstone provider rows while preserving/moving personal children. */
export async function retireGoogleDriveConnectionMaterials(
  connection: ContentConnection,
  now = new Date(),
) {
  const [retiring] = await db
    .update(contentConnections)
    .set({
      status: "expired",
      syncRevision: sql`${contentConnections.syncRevision} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(contentConnections.id, connection.id),
        eq(contentConnections.userId, connection.userId),
        eq(contentConnections.provider, "googledrive"),
        eq(contentConnections.syncRevision, connection.syncRevision),
      ),
    )
    .returning();
  if (!retiring) {
    throw new RetryableSyncError(
      "The Google Drive connection changed while disconnecting",
    );
  }
  const folders = await db
    .select()
    .from(materialFolders)
    .where(
      and(
        eq(materialFolders.connectionId, connection.id),
        eq(materialFolders.userId, connection.userId),
      ),
    );
  const byId = new Map(folders.map((folder) => [folder.id, folder]));
  const roots = folders.filter((folder) => {
    if (folder.deletedAt) return false;
    const parent = folder.parentId ? byId.get(folder.parentId) : undefined;
    return !parent || Boolean(parent.deletedAt);
  });
  let trashed = 0;
  for (const root of roots) {
    trashed += await trashFolderTree(retiring, root, folders, now);
  }
  const remaining = await db
    .update(materialDocuments)
    .set({
      deletedAt: now,
      deletedFrom: sql`${materialDocuments.folderId}`,
      deletedBy: "provider",
      deletedBatchId: newId("trash"),
      updatedAt: now,
    })
    .where(
      and(
        eq(materialDocuments.connectionId, connection.id),
        eq(materialDocuments.userId, connection.userId),
        isNull(materialDocuments.deletedAt),
        currentSyncRevision(retiring),
      ),
    )
    .returning({ id: materialDocuments.id });
  return { connection: retiring, trashed: trashed + remaining.length };
}

function inRemoteScope(
  file: GoogleDriveFile,
  scope: ReadonlySet<string>,
  remoteById: ReadonlyMap<string, GoogleDriveFile>,
  mappedFolderIds: ReadonlySet<string>,
) {
  let cursor: string | undefined = isFolder(file) ? file.id : file.parents?.[0];
  const ownFolderId = isFolder(file) ? file.id : null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (scope.has(cursor)) return true;
    if (cursor !== ownFolderId && mappedFolderIds.has(cursor)) return true;
    seen.add(cursor);
    cursor = remoteById.get(cursor)?.parents?.[0];
  }
  return false;
}

type MaterialFolderRow = typeof materialFolders.$inferSelect;

interface FolderMaterializationPlan {
  file: GoogleDriveFile;
  parentId: string | null;
  localId: string;
  existing?: MaterialFolderRow;
  remainsDeleted: boolean;
}

function slicesOf<T>(rows: readonly T[], size: number) {
  const slices: T[][] = [];
  for (let index = 0; index < rows.length; index += size) {
    slices.push(rows.slice(index, index + size));
  }
  return slices;
}

function planFolderMaterialization(
  files: readonly GoogleDriveFile[],
  scope: ReadonlySet<string>,
  existingByExternal: ReadonlyMap<string, MaterialFolderRow>,
) {
  const candidates = new Map(files.map((file) => [file.id, file]));
  const children = new Map<string, GoogleDriveFile[]>();
  for (const file of candidates.values()) {
    const parentId = file.parents?.[0];
    if (!parentId) continue;
    const rows = children.get(parentId) ?? [];
    rows.push(file);
    children.set(parentId, rows);
  }
  const plans = new Map<string, FolderMaterializationPlan>();
  const queue: GoogleDriveFile[] = [];
  for (const file of candidates.values()) {
    const parentId = file.parents?.[0];
    const parent = parentId ? existingByExternal.get(parentId) : undefined;
    if (scope.has(file.id) || (parent && !parent.deletedAt)) queue.push(file);
  }
  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const file = queue[cursor]!;
    if (plans.has(file.id)) continue;
    const existing = existingByExternal.get(file.id);
    const isScopeRoot = scope.has(file.id);
    const parentExternalId = file.parents?.[0];
    const parentPlan = parentExternalId
      ? plans.get(parentExternalId)
      : undefined;
    const existingParent = parentExternalId
      ? existingByExternal.get(parentExternalId)
      : undefined;
    const activeParentId =
      parentPlan && !parentPlan.remainsDeleted
        ? parentPlan.localId
        : existingParent && !existingParent.deletedAt
          ? existingParent.id
          : null;
    if (!isScopeRoot && !activeParentId) continue;
    const remainsDeleted = Boolean(
      existing?.deletedAt && existing.deletedBy !== "provider",
    );
    const plan: FolderMaterializationPlan = {
      file,
      parentId: isScopeRoot ? null : activeParentId,
      localId: existing?.id ?? newId("mfold"),
      ...(existing ? { existing } : {}),
      remainsDeleted,
    };
    plans.set(file.id, plan);
    if (!remainsDeleted) queue.push(...(children.get(file.id) ?? []));
  }
  return [...plans.values()];
}

async function materializeFolders(
  connection: ContentConnection,
  plans: readonly FolderMaterializationPlan[],
  folders: readonly MaterialFolderRow[],
  now: Date,
) {
  if (plans.length === 0) return new Map<string, MaterialFolderRow>();
  return db.transaction(async (transaction) => {
    const [current] = await transaction
      .select({ id: contentConnections.id })
      .from(contentConnections)
      .where(
        and(
          eq(contentConnections.id, connection.id),
          eq(contentConnections.userId, connection.userId),
          eq(contentConnections.provider, "googledrive"),
          eq(contentConnections.syncRevision, connection.syncRevision),
        ),
      )
      .limit(1);
    if (!current) {
      throw new RetryableSyncError(
        "The Google Drive scope changed during folder publication",
      );
    }

    const restorable = plans.filter(
      (plan) =>
        plan.existing?.deletedAt && plan.existing.deletedBy === "provider",
    );
    if (restorable.length > 0) {
      const folderCohorts = restorable.map((plan) => {
        const deletionCohort = plan.existing!.deletedBatchId
          ? eq(materialFolders.deletedBatchId, plan.existing!.deletedBatchId)
          : and(
              isNull(materialFolders.deletedBatchId),
              eq(materialFolders.deletedAt, plan.existing!.deletedAt!),
            );
        return and(
          inArray(materialFolders.id, [
            ...descendantsOf(plan.existing!.id, [...folders]),
          ]),
          deletionCohort,
        );
      });
      const documentCohorts = restorable.map((plan) => {
        const deletionCohort = plan.existing!.deletedBatchId
          ? eq(materialDocuments.deletedBatchId, plan.existing!.deletedBatchId)
          : and(
              isNull(materialDocuments.deletedBatchId),
              eq(materialDocuments.deletedAt, plan.existing!.deletedAt!),
            );
        return and(
          inArray(materialDocuments.folderId, [
            ...descendantsOf(plan.existing!.id, [...folders]),
          ]),
          deletionCohort,
        );
      });
      await transaction
        .update(materialFolders)
        .set({
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(materialFolders.userId, connection.userId),
            eq(materialFolders.deletedBy, "provider"),
            or(...folderCohorts),
          ),
        );
      await transaction
        .update(materialDocuments)
        .set({
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(materialDocuments.userId, connection.userId),
            eq(materialDocuments.deletedBy, "provider"),
            or(...documentCohorts),
          ),
        );
    }

    const newPlans = plans.filter((plan) => !plan.existing);
    for (const batch of slicesOf(newPlans, FOLDER_WRITE_BATCH_SIZE)) {
      await transaction
        .insert(materialFolders)
        .values(
          batch.map((plan) => ({
            id: plan.localId,
            name: plan.file.name.slice(0, 160),
            parentId: plan.parentId,
            subjectId: null,
            origin: "googledrive" as const,
            connectionId: connection.id,
            externalId: plan.file.id,
            sortOrder: 0,
            yearId: connection.yearId,
            userId: connection.userId,
            createdAt: now,
            updatedAt: now,
          })),
        )
        .onConflictDoNothing();
    }

    const existingPlans = plans.filter(
      (
        plan,
      ): plan is FolderMaterializationPlan & { existing: MaterialFolderRow } =>
        Boolean(plan.existing),
    );
    for (const batch of slicesOf(existingPlans, FOLDER_WRITE_BATCH_SIZE)) {
      const names = sql.join(
        batch.map(
          (plan) =>
            sql`when ${plan.file.id} then ${plan.file.name.slice(0, 160)}`,
        ),
        sql.raw(" "),
      );
      const parents = sql.join(
        batch.map((plan) => sql`when ${plan.file.id} then ${plan.parentId}`),
        sql.raw(" "),
      );
      await transaction
        .update(materialFolders)
        .set({
          name: sql<string>`case ${materialFolders.externalId} ${names} else ${materialFolders.name} end`,
          parentId: sql<
            string | null
          >`case ${materialFolders.externalId} ${parents} else ${materialFolders.parentId} end`,
          deletedAt: sql<Date | null>`case when ${materialFolders.deletedBy} = 'provider' then null else ${materialFolders.deletedAt} end`,
          deletedFrom: sql<
            string | null
          >`case when ${materialFolders.deletedBy} = 'provider' then null else ${materialFolders.deletedFrom} end`,
          deletedBy: sql<
            "user" | "provider" | null
          >`case when ${materialFolders.deletedBy} = 'provider' then null else ${materialFolders.deletedBy} end`,
          deletedBatchId: sql<
            string | null
          >`case when ${materialFolders.deletedBy} = 'provider' then null else ${materialFolders.deletedBatchId} end`,
          updatedAt: now,
        })
        .where(
          and(
            eq(materialFolders.connectionId, connection.id),
            eq(materialFolders.userId, connection.userId),
            inArray(
              materialFolders.externalId,
              batch.map((plan) => plan.file.id),
            ),
            currentSyncRevision(connection),
          ),
        );
    }

    const published = new Map<string, MaterialFolderRow>();
    for (const batch of slicesOf(plans, FOLDER_WRITE_BATCH_SIZE)) {
      const rows = await transaction
        .select()
        .from(materialFolders)
        .where(
          and(
            eq(materialFolders.connectionId, connection.id),
            eq(materialFolders.userId, connection.userId),
            inArray(
              materialFolders.externalId,
              batch.map((plan) => plan.file.id),
            ),
          ),
        );
      for (const row of rows) {
        if (row.externalId) published.set(row.externalId, row);
      }
    }
    if (published.size !== plans.length) {
      throw new RetryableSyncError(
        "Some synchronized Google Drive folders could not be published",
      );
    }
    return published;
  });
}

async function publishFile(
  connection: ContentConnection,
  file: GoogleDriveFile,
  folderId: string,
  existing: typeof materialDocuments.$inferSelect | undefined,
  result: GoogleDriveSyncResult,
  now: Date,
  dependencies: GoogleDriveSyncDependencies,
) {
  const enqueuePreview = dependencies.enqueuePreview ?? enqueueMaterialPreview;
  if (existing?.deletedAt && existing.deletedBy !== "provider") {
    result.skipped += 1;
    return;
  }
  await assertCurrentSyncRevision(connection);
  if (!isSupportedMaterial(file)) {
    if (existing && (await trashDocument(connection, existing, now))) {
      result.trashed += 1;
    }
    result.unsupported += 1;
    return;
  }
  const nextMeta = metaOf(file);
  const title = materialFileName(file).slice(0, 160);
  if (
    existing?.fileId &&
    sameRemoteRevision(existingMeta(existing.metaJson), nextMeta)
  ) {
    if (
      existing.title !== title ||
      existing.folderId !== folderId ||
      existing.deletedBy === "provider"
    ) {
      await db
        .update(materialDocuments)
        .set({
          title,
          folderId,
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(materialDocuments.id, existing.id),
            eq(materialDocuments.userId, connection.userId),
            currentSyncRevision(connection),
          ),
        );
    }
    await enqueuePreview({
      fileId: existing.fileId,
      userId: connection.userId,
    }).catch((error) => {
      throw new RetryableSyncError(
        `The material preview could not be queued: ${safeError(error)}`,
        { cause: error },
      );
    });
    result.skipped += 1;
    return;
  }

  const exportTarget = googleDriveExportTarget(file.mimeType);
  const download = exportTarget
    ? await exportGoogleDriveFile(
        connection,
        file.id,
        exportTarget.mimeType,
        dependencies,
      )
    : await downloadGoogleDriveFile(connection, file.id, dependencies);
  const fileName = materialFileName(file);
  const materialized = await materializeProviderDownload(
    {
      externalId: file.id,
      fileName,
      folderPath: [],
      mimeType: materialMimeType(file),
      byteSize: exportTarget ? null : googleDriveFileSize(file),
      modifiedAt: file.modifiedTime ? new Date(file.modifiedTime) : null,
      courseRef: { externalId: connection.id, name: "Google Drive" },
    },
    download,
    FILE_CONSTRAINTS["course-material"].maxBytes,
    dependencies.signal,
  );
  await assertCurrentSyncRevision(connection);
  const persist = dependencies.storeFile ?? storeFile;
  const remove = dependencies.deleteFile ?? deleteFile;
  const removePreview = dependencies.deleteFilePreview ?? deleteFilePreview;
  const stored = await persist({
    userId: connection.userId,
    purpose: "course-material",
    file: materialized.file,
    nameHint: fileName,
  });
  let published = false;
  try {
    await assertCurrentSyncRevision(connection);
    if (existing) {
      const [updated] = await db
        .update(materialDocuments)
        .set({
          title,
          folderId,
          sourceType: "file",
          fileId: stored.id,
          sourceUrl: null,
          textContent: null,
          origin: "googledrive",
          connectionId: connection.id,
          externalId: file.id,
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          metaVersion: 3,
          metaJson: nextMeta,
          updatedAt: now,
        })
        .where(
          and(
            eq(materialDocuments.id, existing.id),
            eq(materialDocuments.userId, connection.userId),
            eq(materialDocuments.connectionId, connection.id),
            eq(materialDocuments.updatedAt, existing.updatedAt),
            currentSyncRevision(connection),
          ),
        )
        .returning({ id: materialDocuments.id });
      if (!updated) {
        throw new RetryableSyncError(
          "The synchronized Google Drive file changed before publication",
        );
      }
      published = true;
      if (existing.fileId && existing.fileId !== stored.id) {
        await removePreview(connection.userId, existing.fileId).catch(
          () => undefined,
        );
        await remove(connection.userId, existing.fileId).catch(() => undefined);
      }
      result.updated += 1;
    } else {
      const [created] = await db
        .insert(materialDocuments)
        .values({
          id: newId("mdoc"),
          title,
          folderId,
          sourceType: "file",
          fileId: stored.id,
          sourceUrl: null,
          textContent: null,
          origin: "googledrive",
          connectionId: connection.id,
          externalId: file.id,
          metaVersion: 3,
          metaJson: nextMeta,
          yearId: connection.yearId,
          userId: connection.userId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: materialDocuments.id });
      if (!created) {
        throw new RetryableSyncError(
          "The synchronized Google Drive file raced another publication",
        );
      }
      published = true;
      result.downloaded += 1;
    }
  } finally {
    if (!published) {
      await remove(connection.userId, stored.id).catch(() => undefined);
    }
  }
  await enqueuePreview({ fileId: stored.id, userId: connection.userId }).catch(
    (error) => {
      throw new RetryableSyncError(
        `The material preview could not be queued: ${safeError(error)}`,
        { cause: error },
      );
    },
  );
}

async function synchronizeItems(
  connection: ContentConnection,
  items: RemoteItem[],
  result: GoogleDriveSyncResult,
  now: Date,
  dependencies: GoogleDriveSyncDependencies,
  fullSnapshot: boolean,
) {
  const scope = new Set(connection.scopeJson?.folderIds ?? []);
  const remoteById = new Map(
    items.flatMap((item) =>
      item.file && !item.removed ? [[item.id, item.file] as const] : [],
    ),
  );
  const [folderRows, documentRows] = await Promise.all([
    db
      .select()
      .from(materialFolders)
      .where(
        and(
          eq(materialFolders.connectionId, connection.id),
          eq(materialFolders.userId, connection.userId),
        ),
      ),
    db
      .select()
      .from(materialDocuments)
      .where(
        and(
          eq(materialDocuments.connectionId, connection.id),
          eq(materialDocuments.userId, connection.userId),
        ),
      ),
  ]);
  const folderByExternal = new Map(
    folderRows
      .filter((folder) => folder.externalId)
      .map((folder) => [folder.externalId!, folder]),
  );
  const documentByExternal = new Map(
    documentRows
      .filter((document) => document.externalId)
      .map((document) => [document.externalId!, document]),
  );
  const activeMappedFolderIds = new Set(
    folderRows
      .filter((folder) => folder.externalId && !folder.deletedAt)
      .map((folder) => folder.externalId!),
  );
  const mappedScopeFallback =
    !fullSnapshot && connection.cursor
      ? new Set(activeMappedFolderIds)
      : new Set<string>();

  for (const item of items) {
    const inScope = item.file
      ? inRemoteScope(item.file, scope, remoteById, mappedScopeFallback)
      : false;
    if (!item.removed && item.file && !item.file.trashed && inScope) continue;
    const document = documentByExternal.get(item.id);
    if (document && (item.removed || item.file?.trashed || !inScope)) {
      if (await trashDocument(connection, document, now)) result.trashed += 1;
    }
    const folder = folderByExternal.get(item.id);
    if (folder && (item.removed || item.file?.trashed || !inScope)) {
      result.trashed += await trashFolderTree(
        connection,
        folder,
        folderRows,
        now,
      );
    }
  }

  const folderFiles = items.flatMap((item) =>
    item.file &&
    !item.removed &&
    !item.file.trashed &&
    isFolder(item.file) &&
    inRemoteScope(item.file, scope, remoteById, mappedScopeFallback)
      ? [item.file]
      : [],
  );
  const folderPlans = planFolderMaterialization(
    folderFiles,
    scope,
    folderByExternal,
  );
  const publishedFolders = await materializeFolders(
    connection,
    folderPlans,
    folderRows,
    now,
  );
  for (const plan of folderPlans) {
    const published = publishedFolders.get(plan.file.id)!;
    folderByExternal.set(plan.file.id, published);
    if (!published.deletedAt) {
      activeMappedFolderIds.add(plan.file.id);
      if (connection.cursor) mappedScopeFallback.add(plan.file.id);
    }
  }

  for (const item of items) {
    const file = item.file;
    if (!file || item.removed || file.trashed || isFolder(file)) continue;
    if (!inRemoteScope(file, scope, remoteById, mappedScopeFallback)) continue;
    const parentExternalId = file.parents?.[0];
    const parent = parentExternalId
      ? folderByExternal.get(parentExternalId)
      : undefined;
    if (parent?.deletedAt && parent.deletedBy !== "provider") {
      result.skipped += 1;
      continue;
    }
    if (!parent || parent.deletedAt) {
      throw new RetryableSyncError(
        `The Google Drive parent folder for ${file.id} could not be resolved`,
      );
    }
    try {
      await publishFile(
        connection,
        file,
        parent.id,
        documentByExternal.get(file.id),
        result,
        now,
        dependencies,
      );
    } catch (error) {
      if (
        error instanceof CredentialsRevokedSyncError ||
        error instanceof RetryableSyncError
      ) {
        throw error;
      }
      if (error instanceof NonRetryableSyncError) {
        result.errors.push({ externalId: file.id, message: safeError(error) });
        continue;
      }
      throw new RetryableSyncError(safeError(error), { cause: error });
    }
  }

  if (fullSnapshot) {
    const visibleIds = new Set(
      items.flatMap((item) =>
        item.file &&
        !item.removed &&
        !item.file.trashed &&
        inRemoteScope(item.file, scope, remoteById, mappedScopeFallback)
          ? [item.id]
          : [],
      ),
    );
    for (const document of documentRows) {
      if (
        document.externalId &&
        !visibleIds.has(document.externalId) &&
        (await trashDocument(connection, document, now))
      ) {
        result.trashed += 1;
      }
    }
    for (const folder of folderRows) {
      if (
        folder.externalId &&
        !visibleIds.has(folder.externalId) &&
        !folder.deletedAt
      ) {
        result.trashed += await trashFolderTree(
          connection,
          folder,
          folderRows,
          now,
        );
      }
    }
  }
}

async function runGoogleDriveSyncPass(
  payload: unknown,
  dependencies: GoogleDriveSyncDependencies = {},
): Promise<GoogleDriveSyncResult> {
  const parsed = syncPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new NonRetryableJobError(
      "Invalid Google Drive synchronization payload",
    );
  }
  const connection = await loadConnection(parsed.data.connectionId);
  if (connection.status === "expired") {
    throw new NonRetryableJobError(
      "The Google Drive connection has expired; reconnect the account",
    );
  }
  const now = dependencies.now?.() ?? new Date();
  const result: GoogleDriveSyncResult = {
    downloaded: 0,
    updated: 0,
    trashed: 0,
    skipped: 0,
    unsupported: 0,
    errors: [],
  };
  try {
    const remote = await readRemoteState(connection, dependencies);
    await assertCurrentSyncRevision(connection);
    await synchronizeItems(
      connection,
      remote.items,
      result,
      now,
      dependencies,
      remote.fullSnapshot,
    );
    const cursorCondition = connection.cursor
      ? eq(contentConnections.cursor, connection.cursor)
      : isNull(contentConnections.cursor);
    const scopeCondition = connection.scopeJson
      ? eq(contentConnections.scopeJson, connection.scopeJson)
      : isNull(contentConnections.scopeJson);
    const [published] = await db
      .update(contentConnections)
      .set({
        cursor: remote.cursor,
        status: result.errors.length ? "error" : "connected",
        lastSyncedAt: now,
        lastError: result.errors[0]?.message ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentConnections.id, connection.id),
          eq(contentConnections.userId, connection.userId),
          eq(contentConnections.provider, "googledrive"),
          eq(contentConnections.syncRevision, connection.syncRevision),
          cursorCondition,
          scopeCondition,
        ),
      )
      .returning({ id: contentConnections.id });
    if (!published) {
      throw new RetryableSyncError(
        "The Google Drive scope changed before synchronization completed",
      );
    }
    return result;
  } catch (error) {
    const message = safeError(error);
    await db
      .update(contentConnections)
      .set({ status: "error", lastError: message, updatedAt: now })
      .where(
        and(
          eq(contentConnections.id, connection.id),
          eq(contentConnections.userId, connection.userId),
          eq(contentConnections.syncRevision, connection.syncRevision),
          ne(contentConnections.status, "expired"),
        ),
      );
    if (
      error instanceof NonRetryableSyncError ||
      error instanceof CredentialsRevokedSyncError
    ) {
      throw new NonRetryableJobError(message, { cause: error });
    }
    throw error instanceof RetryableSyncError
      ? error
      : new RetryableSyncError(message, { cause: error });
  }
}

const MAX_COALESCED_SYNC_PASSES = 10;

export async function runGoogleDriveSyncJob(
  payload: unknown,
  dependencies: GoogleDriveSyncDependencies = {},
): Promise<GoogleDriveSyncResult> {
  const parsed = syncPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new NonRetryableJobError(
      "Invalid Google Drive synchronization payload",
    );
  }
  if (!dependencies.jobId) {
    return runGoogleDriveSyncPass(parsed.data, dependencies);
  }
  const jobId = dependencies.jobId;
  const [claimed] = await db
    .update(contentConnections)
    .set({ syncActiveJobId: jobId, updatedAt: new Date() })
    .where(
      and(
        eq(contentConnections.id, parsed.data.connectionId),
        eq(contentConnections.provider, "googledrive"),
        or(
          isNull(contentConnections.syncActiveJobId),
          eq(contentConnections.syncActiveJobId, jobId),
        ),
      ),
    )
    .returning({ userId: contentConnections.userId });
  if (!claimed) {
    throw new NonRetryableJobError(
      "This Google Drive synchronization was coalesced into another active job",
    );
  }

  const combined: GoogleDriveSyncResult = {
    downloaded: 0,
    updated: 0,
    trashed: 0,
    skipped: 0,
    unsupported: 0,
    errors: [],
  };
  try {
    for (let pass = 0; pass < MAX_COALESCED_SYNC_PASSES; pass += 1) {
      const [before] = await db
        .select({
          requestedGeneration: contentConnections.syncRequestedGeneration,
        })
        .from(contentConnections)
        .where(
          and(
            eq(contentConnections.id, parsed.data.connectionId),
            eq(contentConnections.syncActiveJobId, jobId),
          ),
        )
        .limit(1);
      if (!before) {
        throw new NonRetryableJobError(
          "The Google Drive synchronization mutex was lost",
        );
      }
      const current = await runGoogleDriveSyncPass(parsed.data, dependencies);
      combined.downloaded += current.downloaded;
      combined.updated += current.updated;
      combined.trashed += current.trashed;
      combined.skipped += current.skipped;
      combined.unsupported += current.unsupported;
      combined.errors.push(...current.errors);

      const [released] = await db
        .update(contentConnections)
        .set({ syncActiveJobId: null, updatedAt: new Date() })
        .where(
          and(
            eq(contentConnections.id, parsed.data.connectionId),
            eq(contentConnections.syncActiveJobId, jobId),
            eq(
              contentConnections.syncRequestedGeneration,
              before.requestedGeneration,
            ),
          ),
        )
        .returning({ id: contentConnections.id });
      if (released) return combined;
    }
    throw new RetryableSyncError(
      "Google Drive received continuous changes while synchronizing",
    );
  } catch (error) {
    if (error instanceof NonRetryableJobError) {
      await db
        .update(contentConnections)
        .set({ syncActiveJobId: null, updatedAt: new Date() })
        .where(
          and(
            eq(contentConnections.id, parsed.data.connectionId),
            eq(contentConnections.syncActiveJobId, jobId),
          ),
        );
    }
    throw error;
  }
}

export async function enqueueGoogleDriveSync(
  userId: string,
  connectionId: string,
) {
  const [request] = await db
    .update(contentConnections)
    .set({
      syncRequestedGeneration: sql`${contentConnections.syncRequestedGeneration} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(contentConnections.id, connectionId),
        eq(contentConnections.userId, userId),
        eq(contentConnections.provider, "googledrive"),
      ),
    )
    .returning({
      generation: contentConnections.syncRequestedGeneration,
      activeJobId: contentConnections.syncActiveJobId,
    });
  if (!request) {
    throw new NonRetryableJobError(
      "The Google Drive connection is unavailable",
    );
  }
  if (request.activeJobId) {
    const [active] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, request.activeJobId))
      .limit(1);
    if (active?.status === "queued" || active?.status === "running") {
      return active;
    }
    await db
      .update(contentConnections)
      .set({ syncActiveJobId: null, updatedAt: new Date() })
      .where(
        and(
          eq(contentConnections.id, connectionId),
          eq(contentConnections.userId, userId),
          eq(contentConnections.syncActiveJobId, request.activeJobId),
        ),
      );
  }

  const job = await enqueueJob({
    kind: GOOGLE_DRIVE_SYNC_JOB_KIND,
    payload: { connectionId },
    userId,
    idempotencyKey: `${connectionId}:generation:${request.generation}`,
    maxAttempts: 100,
    newAttemptAfterTerminal: true,
  });
  const [claimed] = await db
    .update(contentConnections)
    .set({ syncActiveJobId: job.id, updatedAt: new Date() })
    .where(
      and(
        eq(contentConnections.id, connectionId),
        eq(contentConnections.userId, userId),
        or(
          isNull(contentConnections.syncActiveJobId),
          eq(contentConnections.syncActiveJobId, job.id),
        ),
      ),
    )
    .returning({ activeJobId: contentConnections.syncActiveJobId });
  if (claimed) return job;

  const [winnerConnection] = await db
    .select({ activeJobId: contentConnections.syncActiveJobId })
    .from(contentConnections)
    .where(
      and(
        eq(contentConnections.id, connectionId),
        eq(contentConnections.userId, userId),
      ),
    )
    .limit(1);
  if (winnerConnection?.activeJobId !== job.id) {
    await db
      .update(jobs)
      .set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "queued")));
  }
  const [winner] = winnerConnection?.activeJobId
    ? await db
        .select()
        .from(jobs)
        .where(eq(jobs.id, winnerConnection.activeJobId))
        .limit(1)
    : [];
  if (!winner) {
    throw new RetryableSyncError(
      "The Google Drive synchronization queue changed while coalescing",
    );
  }
  return winner;
}

export function enqueueGoogleDriveChannelRenewal(
  connection: Pick<
    ContentConnection,
    "id" | "userId" | "subscriptionId" | "subscriptionExpiresAt"
  >,
  now = new Date(),
  options: { enqueue?: Enqueue } = {},
) {
  if (!connection.subscriptionId || !connection.subscriptionExpiresAt) {
    return null;
  }
  const runAt = new Date(
    Math.max(
      now.getTime(),
      connection.subscriptionExpiresAt.getTime() - CHANNEL_RENEW_EARLY_MS,
    ),
  );
  return (options.enqueue ?? enqueueJob)({
    kind: GOOGLE_DRIVE_CHANNEL_RENEW_JOB_KIND,
    payload: { connectionId: connection.id },
    userId: connection.userId,
    idempotencyKey: `${connection.id}:${connection.subscriptionExpiresAt.toISOString()}`,
    runAt,
    maxAttempts: 6,
    newAttemptAfterTerminal: true,
  });
}

async function replaceChannel(
  connection: ContentConnection,
  dependencies: GoogleDriveChannelReconcileDependencies,
) {
  const createChannel = dependencies.createChannel ?? createGoogleDriveChannel;
  const deleteChannel = dependencies.deleteChannel ?? deleteGoogleDriveChannel;
  const getStartPageToken =
    dependencies.getStartPageToken ?? getGoogleDriveStartPageToken;
  const now = dependencies.now?.() ?? new Date();
  const pageToken =
    connection.cursor ?? (await getStartPageToken(connection, dependencies));
  const webhookToken = newGoogleDriveWebhookToken();
  const created = await createChannel(
    connection,
    pageToken,
    webhookToken,
    dependencies,
  );
  if (!created) return null;

  const oldChannel =
    connection.subscriptionId && connection.subscriptionResourceId
      ? {
          id: connection.subscriptionId,
          resourceId: connection.subscriptionResourceId,
        }
      : null;
  const idCondition = connection.subscriptionId
    ? eq(contentConnections.subscriptionId, connection.subscriptionId)
    : isNull(contentConnections.subscriptionId);
  const resourceCondition = connection.subscriptionResourceId
    ? eq(
        contentConnections.subscriptionResourceId,
        connection.subscriptionResourceId,
      )
    : isNull(contentConnections.subscriptionResourceId);
  const expiryCondition = connection.subscriptionExpiresAt
    ? eq(
        contentConnections.subscriptionExpiresAt,
        connection.subscriptionExpiresAt,
      )
    : isNull(contentConnections.subscriptionExpiresAt);
  const [updated] = await db
    .update(contentConnections)
    .set({
      subscriptionId: created.id,
      subscriptionResourceId: created.resourceId,
      subscriptionExpiresAt: created.expiresAt,
      webhookSecretHash: googleDriveWebhookTokenHash(webhookToken),
      status: "connected",
      lastError: null,
      updatedAt: now,
    })
    .where(
      and(
        eq(contentConnections.id, connection.id),
        eq(contentConnections.userId, connection.userId),
        eq(contentConnections.provider, "googledrive"),
        ne(contentConnections.status, "expired"),
        idCondition,
        resourceCondition,
        expiryCondition,
      ),
    )
    .returning();
  if (!updated) {
    await deleteChannel(
      connection,
      { id: created.id, resourceId: created.resourceId },
      dependencies,
    ).catch(() => undefined);
    throw new RetryableSyncError(
      "The Google Drive channel changed before renewal was published",
    );
  }
  if (oldChannel) {
    await deleteChannel(updated, oldChannel, dependencies).catch(
      () => undefined,
    );
  }
  return updated;
}

export async function runGoogleDriveChannelRenewalJob(
  payload: unknown,
  dependencies: GoogleDriveChannelReconcileDependencies = {},
) {
  const parsed = syncPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new NonRetryableJobError("Invalid Google Drive renewal payload");
  }
  const connection = await loadConnection(parsed.data.connectionId);
  if (!connection.subscriptionId || !connection.subscriptionResourceId) {
    throw new NonRetryableJobError("The Google Drive channel is unavailable");
  }
  const now = dependencies.now?.() ?? new Date();
  try {
    const updated = await replaceChannel(connection, dependencies);
    if (!updated)
      return { connectionId: connection.id, disabled: true as const };
    await enqueueGoogleDriveChannelRenewal(updated, now, {
      enqueue: dependencies.enqueue,
    });
    return {
      connectionId: updated.id,
      subscriptionId: updated.subscriptionId,
      subscriptionResourceId: updated.subscriptionResourceId,
      subscriptionExpiresAt: updated.subscriptionExpiresAt,
    };
  } catch (error) {
    const message = safeError(error);
    await db
      .update(contentConnections)
      .set({ status: "error", lastError: message, updatedAt: now })
      .where(
        and(
          eq(contentConnections.id, connection.id),
          eq(contentConnections.userId, connection.userId),
          ne(contentConnections.status, "expired"),
        ),
      );
    if (
      error instanceof NonRetryableSyncError ||
      error instanceof CredentialsRevokedSyncError
    ) {
      throw new NonRetryableJobError(message, { cause: error });
    }
    throw error;
  }
}

function utcDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

export function enqueueGoogleDriveChannelReconciliation(
  runAt = new Date(),
  options: { enqueue?: Enqueue } = {},
) {
  return (options.enqueue ?? enqueueJob)({
    kind: GOOGLE_DRIVE_CHANNEL_RECONCILE_JOB_KIND,
    payload: { scheduledFor: runAt.toISOString() },
    userId: null,
    idempotencyKey: utcDateKey(runAt),
    runAt,
    maxAttempts: 6,
  });
}

export async function reconcileGoogleDriveChannels(
  dependencies: GoogleDriveChannelReconcileDependencies = {},
) {
  const now = dependencies.now?.() ?? new Date();
  const enqueue = dependencies.enqueue ?? enqueueJob;
  const batchSize =
    dependencies.batchSize ?? GOOGLE_DRIVE_CHANNEL_RECONCILE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error(
      "Google Drive reconciliation batchSize must be between 1 and 500",
    );
  }
  const result = {
    examined: 0,
    renewalJobs: 0,
    replaced: 0,
    failed: 0,
    skippedExpiredCredentials: 0,
    skippedWithoutWebhook: 0,
  };
  let afterId: string | null = null;
  while (true) {
    const connections = await db
      .select()
      .from(contentConnections)
      .where(
        and(
          eq(contentConnections.provider, "googledrive"),
          ne(contentConnections.status, "expired"),
          afterId ? gt(contentConnections.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(contentConnections.id))
      .limit(batchSize);
    if (connections.length === 0) break;
    for (const connection of connections) {
      result.examined += 1;
      if (connection.status === "expired") {
        result.skippedExpiredCredentials += 1;
        continue;
      }
      try {
        const expired =
          !connection.subscriptionId ||
          !connection.subscriptionResourceId ||
          !connection.subscriptionExpiresAt ||
          connection.subscriptionExpiresAt.getTime() <= now.getTime();
        if (expired) {
          const updated = await replaceChannel(connection, dependencies);
          if (!updated) {
            result.skippedWithoutWebhook += 1;
            continue;
          }
          await enqueueGoogleDriveChannelRenewal(updated, now, { enqueue });
          result.replaced += 1;
          result.renewalJobs += 1;
        } else {
          await enqueueGoogleDriveChannelRenewal(connection, now, { enqueue });
          result.renewalJobs += 1;
        }
      } catch (error) {
        result.failed += 1;
        await db
          .update(contentConnections)
          .set({ status: "error", lastError: safeError(error), updatedAt: now })
          .where(
            and(
              eq(contentConnections.id, connection.id),
              eq(contentConnections.userId, connection.userId),
              ne(contentConnections.status, "expired"),
            ),
          );
      }
    }
    afterId = connections.at(-1)!.id;
  }
  return result;
}

export async function runGoogleDriveChannelReconciliationJob(
  payload: unknown,
  dependencies: GoogleDriveChannelReconcileDependencies = {},
) {
  reconcilePayloadSchema.parse(payload);
  const now = dependencies.now?.() ?? new Date();
  const enqueue = dependencies.enqueue ?? enqueueJob;
  const next = await enqueueGoogleDriveChannelReconciliation(
    new Date(now.getTime() + CHANNEL_RECONCILE_INTERVAL_MS),
    { enqueue },
  );
  const result = await reconcileGoogleDriveChannels({
    ...dependencies,
    now: () => now,
    enqueue,
  });
  return { ...result, nextJobId: next.id };
}
