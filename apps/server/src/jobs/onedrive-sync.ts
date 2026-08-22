import {
  and,
  asc,
  eq,
  exists,
  gt,
  inArray,
  isNull,
  lt,
  ne,
  or,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  contentConnections,
  contentOauthStates,
  jobs,
  lectureRecordings,
  materialDocuments,
  materialFolders,
  studyDocuments,
} from "../db/schema";
import {
  createOneDriveSubscription,
  deleteOneDriveSubscription,
  downloadOneDriveItem,
  newOneDriveWebhookClientState,
  oneDriveWebhookSecretHash,
  readOneDriveDeltaPage,
  renewOneDriveSubscription,
  type ContentConnection,
  OneDriveDeltaCursorExpiredError,
  type OneDriveDriveItem,
  type OneDriveHttpDependencies,
} from "../lib/onedrive";
import { enqueueJob, NonRetryableJobError } from "../lib/jobs";
import { newId } from "../lib/id";
import {
  deleteFile,
  deleteFilePreview,
  FILE_CONSTRAINTS,
  resolvedFileMimeType,
  storeFile,
} from "../lib/storage";
import { enqueueMaterialPreview } from "./material-preview";
import { materializeProviderDownload } from "../sync/run";
import {
  CredentialsRevokedSyncError,
  NonRetryableSyncError,
  RetryableSyncError,
} from "../sync/errors";

export const ONEDRIVE_SYNC_JOB_KIND = "connectors.onedrive.sync";
export const ONEDRIVE_SUBSCRIPTION_RENEW_JOB_KIND =
  "connectors.onedrive.renewSubscription";
export const ONEDRIVE_SUBSCRIPTION_RECONCILE_JOB_KIND =
  "maintenance.reconcileOneDriveSubscriptions";

const MAX_DELTA_PAGES = 250;
const MAX_DELTA_ITEMS = 100_000;
const FOLDER_WRITE_BATCH_SIZE = 200;
const SUBSCRIPTION_RENEW_EARLY_MS = 3 * 24 * 60 * 60_000;
const SUBSCRIPTION_RECONCILE_INTERVAL_MS = 24 * 60 * 60_000;
export const ONEDRIVE_SUBSCRIPTION_RECONCILE_BATCH_SIZE = 500;

const syncPayloadSchema = z.object({
  connectionId: z.string().min(1),
});
const reconcilePayloadSchema = z
  .object({ scheduledFor: z.string().datetime() })
  .strict();

type Enqueue = typeof enqueueJob;

interface OneDriveMaterialMeta {
  externalId: string;
  provider: "onedrive";
  eTag: string | null;
  cTag: string | null;
  lastModifiedAt: string | null;
}

export interface OneDriveSyncResult {
  downloaded: number;
  updated: number;
  trashed: number;
  skipped: number;
  unsupported: number;
  errors: Array<{ externalId: string; message: string }>;
}

export interface OneDriveSyncDependencies extends OneDriveHttpDependencies {
  jobId?: string;
  storeFile?: typeof storeFile;
  deleteFile?: typeof deleteFile;
  deleteFilePreview?: typeof deleteFilePreview;
  enqueuePreview?: typeof enqueueMaterialPreview;
}

export interface OneDriveSubscriptionReconcileDependencies extends OneDriveHttpDependencies {
  enqueue?: Enqueue;
  createSubscription?: typeof createOneDriveSubscription;
  deleteSubscription?: typeof deleteOneDriveSubscription;
  batchSize?: number;
}

function safeError(error: unknown) {
  return (
    (error instanceof Error ? error.message : String(error))
      .replace(/https?:\/\/\S+/gi, "the Microsoft service")
      .replace(/[A-Za-z0-9_-]{80,}/g, "[redacted]")
      .slice(0, 500) || "Unknown OneDrive synchronization error"
  );
}

function isSupportedMaterial(item: OneDriveDriveItem) {
  if (!item.file) return false;
  if (
    item.size !== undefined &&
    item.size > FILE_CONSTRAINTS["course-material"].maxBytes
  ) {
    return false;
  }
  return Boolean(resolveOneDriveMaterialMimeType(item));
}

export function resolveOneDriveMaterialMimeType(item: OneDriveDriveItem) {
  if (!item.file) return null;
  return resolvedFileMimeType("course-material", {
    name: item.name,
    // Graph occasionally uses octet-stream; only that neutral declaration is
    // allowed to fall back to the extension by the shared storage resolver.
    type: item.file.mimeType ?? "application/octet-stream",
  });
}

function materialMimeType(item: OneDriveDriveItem) {
  const resolved = resolveOneDriveMaterialMimeType(item);
  if (!resolved) {
    throw new NonRetryableSyncError(
      "The OneDrive item has an unsupported material type",
    );
  }
  return resolved;
}

function metaOf(item: OneDriveDriveItem): OneDriveMaterialMeta {
  return {
    externalId: item.id,
    provider: "onedrive",
    eTag: item.eTag ?? null,
    cTag: item.cTag ?? null,
    lastModifiedAt: item.lastModifiedDateTime ?? null,
  };
}

function existingMeta(value: unknown): OneDriveMaterialMeta | null {
  const parsed = z
    .object({
      externalId: z.string(),
      provider: z.literal("onedrive"),
      eTag: z.string().nullable(),
      cTag: z.string().nullable(),
      lastModifiedAt: z.string().nullable(),
    })
    .safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function loadConnection(connectionId: string) {
  const [connection] = await db
    .select()
    .from(contentConnections)
    .where(
      and(
        eq(contentConnections.id, connectionId),
        eq(contentConnections.provider, "onedrive"),
      ),
    )
    .limit(1);
  if (!connection) {
    throw new NonRetryableJobError("The OneDrive connection is unavailable");
  }
  return connection;
}

async function readDelta(
  connection: ContentConnection,
  dependencies: OneDriveHttpDependencies,
) {
  const items: OneDriveDriveItem[] = [];
  const emptyScope = (connection.scopeJson?.folderIds.length ?? 0) === 0;
  let cursor: string | null =
    connection.cursor ??
    (emptyScope ? "me/drive/root/delta?token=latest" : null);
  let deltaLink: string | null = null;
  let fullSnapshot = connection.cursor === null;
  let restarted = false;
  for (let page = 0; ; page += 1) {
    if (page >= MAX_DELTA_PAGES || items.length > MAX_DELTA_ITEMS) {
      throw new NonRetryableSyncError(
        "The OneDrive delta is too large to synchronize safely",
      );
    }
    let result;
    try {
      result = await readOneDriveDeltaPage(connection, cursor, dependencies);
    } catch (error) {
      if (error instanceof OneDriveDeltaCursorExpiredError && !restarted) {
        // 410 invalidates every page already collected. Graph's Location is
        // accepted only after the fixed Graph-origin validation in the HTTP
        // boundary. The original DB cursor remains untouched for the final CAS.
        restarted = true;
        fullSnapshot = true;
        items.length = 0;
        deltaLink = null;
        cursor =
          error.restartCursor ??
          (emptyScope ? "me/drive/root/delta?token=latest" : null);
        continue;
      }
      throw error;
    }
    items.push(...result.items);
    if (items.length > MAX_DELTA_ITEMS) {
      throw new NonRetryableSyncError(
        "The OneDrive delta is too large to synchronize safely",
      );
    }
    if (result.nextLink) {
      cursor = result.nextLink;
      continue;
    }
    deltaLink = result.deltaLink;
    break;
  }
  if (!deltaLink) {
    throw new RetryableSyncError(
      "Microsoft Graph did not finish the OneDrive delta",
    );
  }
  return { items, deltaLink, fullSnapshot };
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
        eq(contentConnections.syncRevision, connection.syncRevision),
      ),
    )
    .limit(1);
  if (!current) {
    throw new RetryableSyncError(
      "The OneDrive scope changed during synchronization",
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
  const deletedBatchId = newId("trash");
  const [trashed] = await db
    .update(materialDocuments)
    .set({
      deletedAt: now,
      deletedFrom: document.folderId,
      deletedBy: "provider",
      deletedBatchId,
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
  const seenDestinations = new Set<string>();
  while (destination && !seenDestinations.has(destination)) {
    seenDestinations.add(destination);
    const candidate = allById.get(destination);
    if (candidate && !candidate.deletedAt && !mappedIds.has(candidate.id)) {
      break;
    }
    destination = candidate?.parentId ?? null;
  }
  const [, , , , trashedFolders, trashedDocuments] = await db.batch([
    // A synced folder is only a location boundary. Personal subtrees and rows
    // are moved to the nearest live ancestor before provider tombstones land.
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

/**
 * Remove a disconnected source from the live Materials tree without touching
 * personal content nested beside it. Tombstones remain recoverable/purgeable,
 * while clearing connectionId later allows a reconnect to import one live copy.
 */
export async function retireOneDriveConnectionMaterials(
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
        eq(contentConnections.provider, "onedrive"),
        eq(contentConnections.syncRevision, connection.syncRevision),
      ),
    )
    .returning();
  if (!retiring) {
    throw new RetryableSyncError(
      "The OneDrive connection changed while disconnecting",
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

  // A malformed/legacy mapping can have no mapped parent folder. Retire those
  // documents in one guarded statement instead of leaving stale live copies.
  const deletedBatchId = newId("trash");
  const remainingDocuments = await db
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
        eq(materialDocuments.connectionId, connection.id),
        eq(materialDocuments.userId, connection.userId),
        isNull(materialDocuments.deletedAt),
        currentSyncRevision(retiring),
      ),
    )
    .returning({ id: materialDocuments.id });
  return { connection: retiring, trashed: trashed + remainingDocuments.length };
}

function inRemoteScope(
  item: OneDriveDriveItem,
  scope: ReadonlySet<string>,
  remoteById: ReadonlyMap<string, OneDriveDriveItem>,
  mappedFolderIds: ReadonlySet<string>,
) {
  let cursor: string | undefined = item.folder
    ? item.id
    : item.parentReference?.id;
  const ownFolderId = item.folder ? item.id : null;
  const seen = new Set<string>();
  while (cursor && !seen.has(cursor)) {
    if (scope.has(cursor)) return true;
    if (cursor !== ownFolderId && mappedFolderIds.has(cursor)) return true;
    seen.add(cursor);
    cursor = remoteById.get(cursor)?.parentReference?.id;
  }
  return false;
}

type MaterialFolderRow = typeof materialFolders.$inferSelect;

interface FolderMaterializationPlan {
  item: OneDriveDriveItem;
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

/**
 * Resolve the Graph folder graph entirely in memory. Local ids are allocated
 * before any write, so a deep chain does not require one database round-trip
 * per level (material_folders deliberately has no self-FK).
 */
function planFolderMaterialization(
  items: readonly OneDriveDriveItem[],
  scope: ReadonlySet<string>,
  existingByExternal: ReadonlyMap<string, MaterialFolderRow>,
) {
  const candidates = new Map(items.map((item) => [item.id, item]));
  const children = new Map<string, OneDriveDriveItem[]>();
  for (const item of candidates.values()) {
    const parentId = item.parentReference?.id;
    if (!parentId) continue;
    const rows = children.get(parentId) ?? [];
    rows.push(item);
    children.set(parentId, rows);
  }

  const plans = new Map<string, FolderMaterializationPlan>();
  const queue: OneDriveDriveItem[] = [];
  for (const item of candidates.values()) {
    const parent = item.parentReference?.id
      ? existingByExternal.get(item.parentReference.id)
      : undefined;
    if (scope.has(item.id) || (parent && !parent.deletedAt)) queue.push(item);
  }

  for (let cursor = 0; cursor < queue.length; cursor += 1) {
    const item = queue[cursor]!;
    if (plans.has(item.id)) continue;
    const existing = existingByExternal.get(item.id);
    const isScopeRoot = scope.has(item.id);
    const parentExternalId = item.parentReference?.id;
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
      item,
      parentId: isScopeRoot ? null : activeParentId,
      localId: existing?.id ?? newId("mfold"),
      ...(existing ? { existing } : {}),
      remainsDeleted,
    };
    plans.set(item.id, plan);
    if (!remainsDeleted) queue.push(...(children.get(item.id) ?? []));
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

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ id: contentConnections.id })
      .from(contentConnections)
      .where(
        and(
          eq(contentConnections.id, connection.id),
          eq(contentConnections.userId, connection.userId),
          eq(contentConnections.syncRevision, connection.syncRevision),
        ),
      )
      .limit(1);
    if (!current) {
      throw new RetryableSyncError(
        "The OneDrive scope changed during folder publication",
      );
    }

    // Provider restores use their original deletion cohort. They are rare, but
    // remain a fixed four statements regardless of the number/depth of roots.
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
      const studyCohorts = restorable.map((plan) => {
        const deletionCohort = plan.existing!.deletedBatchId
          ? eq(studyDocuments.deletedBatchId, plan.existing!.deletedBatchId)
          : and(
              isNull(studyDocuments.deletedBatchId),
              eq(studyDocuments.deletedAt, plan.existing!.deletedAt!),
            );
        return and(
          inArray(studyDocuments.folderId, [
            ...descendantsOf(plan.existing!.id, [...folders]),
          ]),
          deletionCohort,
        );
      });
      const recordingCohorts = restorable.map((plan) => {
        const deletionCohort = plan.existing!.deletedBatchId
          ? eq(lectureRecordings.deletedBatchId, plan.existing!.deletedBatchId)
          : and(
              isNull(lectureRecordings.deletedBatchId),
              eq(lectureRecordings.deletedAt, plan.existing!.deletedAt!),
            );
        return and(
          inArray(lectureRecordings.folderId, [
            ...descendantsOf(plan.existing!.id, [...folders]),
          ]),
          deletionCohort,
        );
      });
      await tx
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
      await tx
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
      await tx
        .update(studyDocuments)
        .set({
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(studyDocuments.userId, connection.userId),
            eq(studyDocuments.deletedBy, "provider"),
            or(...studyCohorts),
          ),
        );
      await tx
        .update(lectureRecordings)
        .set({
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(lectureRecordings.userId, connection.userId),
            eq(lectureRecordings.deletedBy, "provider"),
            or(...recordingCohorts),
          ),
        );
    }

    const newPlans = plans.filter((plan) => !plan.existing);
    for (const batch of slicesOf(newPlans, FOLDER_WRITE_BATCH_SIZE)) {
      await tx
        .insert(materialFolders)
        .values(
          batch.map((plan) => ({
            id: plan.localId,
            name: plan.item.name.slice(0, 160),
            parentId: plan.parentId,
            subjectId: null,
            origin: "onedrive" as const,
            connectionId: connection.id,
            externalId: plan.item.id,
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
            sql`when ${plan.item.id} then ${plan.item.name.slice(0, 160)}`,
        ),
        sql.raw(" "),
      );
      const parents = sql.join(
        batch.map((plan) => sql`when ${plan.item.id} then ${plan.parentId}`),
        sql.raw(" "),
      );
      await tx
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
              batch.map((plan) => plan.item.id),
            ),
            currentSyncRevision(connection),
          ),
        );
    }

    const published = new Map<string, MaterialFolderRow>();
    for (const batch of slicesOf(plans, FOLDER_WRITE_BATCH_SIZE)) {
      const rows = await tx
        .select()
        .from(materialFolders)
        .where(
          and(
            eq(materialFolders.connectionId, connection.id),
            eq(materialFolders.userId, connection.userId),
            inArray(
              materialFolders.externalId,
              batch.map((plan) => plan.item.id),
            ),
          ),
        );
      for (const row of rows) {
        if (row.externalId) published.set(row.externalId, row);
      }
    }
    if (published.size !== plans.length) {
      throw new RetryableSyncError(
        "Some synchronized OneDrive folders could not be published",
      );
    }
    return published;
  });
}

async function publishFile(
  connection: ContentConnection,
  item: OneDriveDriveItem,
  folderId: string,
  existing: typeof materialDocuments.$inferSelect | undefined,
  result: OneDriveSyncResult,
  now: Date,
  dependencies: OneDriveSyncDependencies,
) {
  const enqueuePreview = dependencies.enqueuePreview ?? enqueueMaterialPreview;
  if (existing?.deletedAt && existing.deletedBy !== "provider") {
    // A user-trash is a tombstone for this connection. Provider changes do not
    // silently restore it; an explicit Materials restore remains authoritative.
    result.skipped += 1;
    return;
  }
  await assertCurrentSyncRevision(connection);
  if (!isSupportedMaterial(item)) {
    if (existing && (await trashDocument(connection, existing, now))) {
      result.trashed += 1;
    }
    result.unsupported += 1;
    return;
  }
  const nextMeta = metaOf(item);
  const previousMeta = existingMeta(existing?.metaJson);
  if (
    existing?.fileId &&
    previousMeta?.eTag &&
    nextMeta.eTag &&
    previousMeta.eTag === nextMeta.eTag
  ) {
    if (
      existing.title !== item.name ||
      existing.folderId !== folderId ||
      existing.deletedBy === "provider"
    ) {
      await db
        .update(materialDocuments)
        .set({
          title: item.name.slice(0, 160),
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
  const download = await downloadOneDriveItem(
    connection,
    item.id,
    dependencies,
  );
  const materialized = await materializeProviderDownload(
    {
      externalId: item.id,
      fileName: item.name,
      folderPath: [],
      mimeType: materialMimeType(item),
      byteSize: item.size ?? null,
      modifiedAt: item.lastModifiedDateTime
        ? new Date(item.lastModifiedDateTime)
        : null,
      courseRef: { externalId: connection.id, name: "OneDrive" },
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
    nameHint: item.name,
  });
  let published = false;
  try {
    await assertCurrentSyncRevision(connection);
    if (existing) {
      const [updated] = await db
        .update(materialDocuments)
        .set({
          title: item.name.slice(0, 160),
          folderId,
          sourceType: "file",
          fileId: stored.id,
          sourceUrl: null,
          textContent: null,
          origin: "onedrive",
          connectionId: connection.id,
          externalId: item.id,
          deletedAt: null,
          deletedFrom: null,
          deletedBy: null,
          deletedBatchId: null,
          metaVersion: 2,
          // MaterialMetaV1 deliberately permits provider additions by version;
          // the schema's runtime JSON column preserves this v2 envelope.
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
          "The synchronized OneDrive file changed before publication",
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
          title: item.name.slice(0, 160),
          folderId,
          sourceType: "file",
          fileId: stored.id,
          sourceUrl: null,
          textContent: null,
          origin: "onedrive",
          connectionId: connection.id,
          externalId: item.id,
          metaVersion: 2,
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
          "The synchronized OneDrive file raced another publication",
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
  items: OneDriveDriveItem[],
  result: OneDriveSyncResult,
  now: Date,
  dependencies: OneDriveSyncDependencies,
  fullSnapshot: boolean,
) {
  const scope = new Set(connection.scopeJson?.folderIds ?? []);
  const remoteById = new Map(items.map((item) => [item.id, item]));
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
  // On a cursor reset (notably after setScope), the complete Graph snapshot is
  // authoritative. Old local mappings must not make deselected folders look
  // like descendants of the new scope. The fallback is only for sparse deltas.
  const mappedScopeFallback =
    !fullSnapshot && connection.cursor
      ? new Set(activeMappedFolderIds)
      : new Set<string>();

  // Deletions and moves outside scope are applied before additions. A folder
  // deletion covers its whole already-materialized subtree recoverably.
  for (const item of items) {
    const inScope = inRemoteScope(item, scope, remoteById, mappedScopeFallback);
    if (!item.deleted && inScope) continue;
    const document = documentByExternal.get(item.id);
    if (document && (item.deleted || !inScope)) {
      if (await trashDocument(connection, document, now)) result.trashed += 1;
    }
    const folder = folderByExternal.get(item.id);
    if (folder && (item.deleted || !inScope)) {
      result.trashed += await trashFolderTree(
        connection,
        folder,
        folderRows,
        now,
      );
    }
  }

  // Folders arrive in no guaranteed order. Resolve the whole parent graph in
  // memory, allocate stable local ids, then publish in bounded SQL batches.
  const folderItems = items.filter(
    (item) =>
      item.folder &&
      !item.deleted &&
      inRemoteScope(item, scope, remoteById, mappedScopeFallback),
  );
  const folderPlans = planFolderMaterialization(
    folderItems,
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
    const published = publishedFolders.get(plan.item.id)!;
    folderByExternal.set(plan.item.id, published);
    if (!published.deletedAt) {
      activeMappedFolderIds.add(plan.item.id);
      if (connection.cursor) mappedScopeFallback.add(plan.item.id);
    }
  }

  for (const item of items) {
    if (!item.file || item.deleted) continue;
    if (!inRemoteScope(item, scope, remoteById, mappedScopeFallback)) {
      continue;
    }
    const parentExternalId = item.parentReference?.id;
    const parent = parentExternalId
      ? folderByExternal.get(parentExternalId)
      : undefined;
    if (parent?.deletedAt && parent.deletedBy !== "provider") {
      result.skipped += 1;
      continue;
    }
    if (!parent || parent.deletedAt) {
      throw new RetryableSyncError(
        `The OneDrive parent folder for ${item.id} could not be resolved`,
      );
    }
    try {
      await publishFile(
        connection,
        item,
        parent.id,
        documentByExternal.get(item.id),
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
        result.errors.push({ externalId: item.id, message: safeError(error) });
        continue;
      }
      throw new RetryableSyncError(safeError(error), { cause: error });
    }
  }

  // A cursor reset means a complete drive snapshot. Anything previously
  // mapped but absent from the selected snapshot is now out of scope/missing.
  if (fullSnapshot) {
    const visibleIds = new Set(
      items
        .filter(
          (item) =>
            !item.deleted &&
            inRemoteScope(item, scope, remoteById, mappedScopeFallback),
        )
        .map((item) => item.id),
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

async function runOneDriveSyncPass(
  payload: unknown,
  dependencies: OneDriveSyncDependencies = {},
): Promise<OneDriveSyncResult> {
  const parsed = syncPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new NonRetryableJobError("Invalid OneDrive synchronization payload");
  }
  const connection = await loadConnection(parsed.data.connectionId);
  if (connection.status === "expired") {
    throw new NonRetryableJobError(
      "The OneDrive connection has expired; reconnect the account",
    );
  }
  const now = dependencies.now?.() ?? new Date();
  const result: OneDriveSyncResult = {
    downloaded: 0,
    updated: 0,
    trashed: 0,
    skipped: 0,
    unsupported: 0,
    errors: [],
  };
  try {
    const delta = await readDelta(connection, dependencies);
    await assertCurrentSyncRevision(connection);
    await synchronizeItems(
      connection,
      delta.items,
      result,
      now,
      dependencies,
      delta.fullSnapshot,
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
        cursor: delta.deltaLink,
        status: result.errors.length ? "error" : "connected",
        lastSyncedAt: now,
        lastError: result.errors[0]?.message ?? null,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentConnections.id, connection.id),
          eq(contentConnections.userId, connection.userId),
          eq(contentConnections.provider, "onedrive"),
          eq(contentConnections.syncRevision, connection.syncRevision),
          cursorCondition,
          scopeCondition,
        ),
      )
      .returning({ id: contentConnections.id });
    if (!published) {
      throw new RetryableSyncError(
        "The OneDrive scope changed before synchronization completed",
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

export async function runOneDriveSyncJob(
  payload: unknown,
  dependencies: OneDriveSyncDependencies = {},
): Promise<OneDriveSyncResult> {
  const parsed = syncPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new NonRetryableJobError("Invalid OneDrive synchronization payload");
  }
  if (!dependencies.jobId) {
    return runOneDriveSyncPass(parsed.data, dependencies);
  }

  const jobId = dependencies.jobId;
  const [claimed] = await db
    .update(contentConnections)
    .set({ syncActiveJobId: jobId, updatedAt: new Date() })
    .where(
      and(
        eq(contentConnections.id, parsed.data.connectionId),
        eq(contentConnections.provider, "onedrive"),
        or(
          isNull(contentConnections.syncActiveJobId),
          eq(contentConnections.syncActiveJobId, jobId),
        ),
      ),
    )
    .returning({ userId: contentConnections.userId });
  if (!claimed) {
    // A racing request already has the durable mutex and its generation covers
    // this job. Terminally coalesce this redundant queue row.
    throw new NonRetryableJobError(
      "This OneDrive synchronization was coalesced into another active job",
    );
  }

  const combined: OneDriveSyncResult = {
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
          "The OneDrive synchronization mutex was lost",
        );
      }
      const current = await runOneDriveSyncPass(parsed.data, dependencies);
      combined.downloaded += current.downloaded;
      combined.updated += current.updated;
      combined.trashed += current.trashed;
      combined.skipped += current.skipped;
      combined.unsupported += current.unsupported;
      combined.errors.push(...current.errors);

      // This conditional release is the enqueue/finish handshake. A request
      // that increments the generation before this statement prevents release;
      // a request after it observes a null mutex and creates a fresh job.
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
      "OneDrive received continuous changes while synchronizing",
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

export async function enqueueOneDriveSync(
  userId: string,
  connectionId: string,
) {
  // UPDATE ... RETURNING makes the dirty generation atomic across webhook,
  // manual and setScope requests.
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
        eq(contentConnections.provider, "onedrive"),
      ),
    )
    .returning({
      generation: contentConnections.syncRequestedGeneration,
      activeJobId: contentConnections.syncActiveJobId,
    });
  if (!request) {
    throw new NonRetryableJobError("The OneDrive connection is unavailable");
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
    // Repair a worker that terminated after its queue ledger changed but before
    // releasing the connection mutex.
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
    kind: ONEDRIVE_SYNC_JOB_KIND,
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
      "The OneDrive synchronization queue changed while coalescing",
    );
  }
  return winner;
}

export function enqueueOneDriveSubscriptionRenewal(
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
      connection.subscriptionExpiresAt.getTime() - SUBSCRIPTION_RENEW_EARLY_MS,
    ),
  );
  return (options.enqueue ?? enqueueJob)({
    kind: ONEDRIVE_SUBSCRIPTION_RENEW_JOB_KIND,
    payload: { connectionId: connection.id },
    userId: connection.userId,
    idempotencyKey: `${connection.id}:${connection.subscriptionExpiresAt.toISOString()}`,
    runAt,
    maxAttempts: 6,
    newAttemptAfterTerminal: true,
  });
}

export async function runOneDriveSubscriptionRenewalJob(
  payload: unknown,
  dependencies: OneDriveHttpDependencies = {},
) {
  const parsed = syncPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new NonRetryableJobError("Invalid OneDrive renewal payload");
  }
  const connection = await loadConnection(parsed.data.connectionId);
  if (!connection.subscriptionId) {
    throw new NonRetryableJobError("The OneDrive subscription is unavailable");
  }
  const now = dependencies.now?.() ?? new Date();
  try {
    const renewed = await renewOneDriveSubscription(connection, dependencies);
    const [updated] = await db
      .update(contentConnections)
      .set({
        subscriptionId: renewed.id,
        subscriptionExpiresAt: renewed.expiresAt,
        status: "connected",
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentConnections.id, connection.id),
          eq(contentConnections.userId, connection.userId),
          eq(contentConnections.subscriptionId, connection.subscriptionId),
        ),
      )
      .returning();
    if (!updated) {
      throw new RetryableSyncError(
        "The OneDrive subscription changed before renewal was published",
      );
    }
    await enqueueOneDriveSubscriptionRenewal(updated, now);
    return {
      connectionId: updated.id,
      subscriptionId: updated.subscriptionId,
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

/** Seeded at boot; each run schedules its successor before doing provider I/O. */
export function enqueueOneDriveSubscriptionReconciliation(
  runAt = new Date(),
  options: { enqueue?: Enqueue } = {},
) {
  return (options.enqueue ?? enqueueJob)({
    kind: ONEDRIVE_SUBSCRIPTION_RECONCILE_JOB_KIND,
    payload: { scheduledFor: runAt.toISOString() },
    userId: null,
    idempotencyKey: utcDateKey(runAt),
    runAt,
    maxAttempts: 6,
  });
}

export async function reconcileOneDriveSubscriptions(
  dependencies: OneDriveSubscriptionReconcileDependencies = {},
) {
  const now = dependencies.now?.() ?? new Date();
  const enqueue = dependencies.enqueue ?? enqueueJob;
  const createSubscription =
    dependencies.createSubscription ?? createOneDriveSubscription;
  const deleteSubscription =
    dependencies.deleteSubscription ?? deleteOneDriveSubscription;
  const batchSize =
    dependencies.batchSize ?? ONEDRIVE_SUBSCRIPTION_RECONCILE_BATCH_SIZE;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 500) {
    throw new Error(
      "OneDrive reconciliation batchSize must be between 1 and 500",
    );
  }
  const purgedOauthStates = await db
    .delete(contentOauthStates)
    .where(lt(contentOauthStates.expiresAt, now))
    .returning({ id: contentOauthStates.id });
  const result = {
    examined: 0,
    renewalJobs: 0,
    recreated: 0,
    failed: 0,
    skippedExpiredCredentials: 0,
    skippedWithoutWebhook: 0,
    purgedOauthStates: purgedOauthStates.length,
  };

  const reconcileConnection = async (connection: ContentConnection) => {
    if (connection.status === "expired") {
      result.skippedExpiredCredentials += 1;
      return;
    }
    try {
      const subscriptionExpired =
        !connection.subscriptionExpiresAt ||
        connection.subscriptionExpiresAt.getTime() <= now.getTime();
      if (!connection.subscriptionId || subscriptionExpired) {
        const clientState = newOneDriveWebhookClientState();
        const created = await createSubscription(
          connection,
          clientState,
          dependencies,
        );
        if (!created) {
          // Webhooks are optional in local/self-hosted deployments. Browse and
          // manual synchronization remain fully healthy without a public URL.
          result.skippedWithoutWebhook += 1;
          return;
        }
        const subscriptionCondition = connection.subscriptionId
          ? eq(contentConnections.subscriptionId, connection.subscriptionId)
          : isNull(contentConnections.subscriptionId);
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
            subscriptionExpiresAt: created.expiresAt,
            webhookSecretHash: oneDriveWebhookSecretHash(clientState),
            status: "connected",
            lastError: null,
            updatedAt: now,
          })
          .where(
            and(
              eq(contentConnections.id, connection.id),
              eq(contentConnections.userId, connection.userId),
              subscriptionCondition,
              expiryCondition,
            ),
          )
          .returning();
        if (!updated) {
          await deleteSubscription(
            {
              ...connection,
              subscriptionId: created.id,
              subscriptionExpiresAt: created.expiresAt,
            },
            dependencies,
          ).catch(() => undefined);
          return;
        }
        await enqueueOneDriveSubscriptionRenewal(updated, now, { enqueue });
        result.recreated += 1;
        result.renewalJobs += 1;
        return;
      }

      // Calling this for every healthy subscription also repairs a callback or
      // deploy that persisted Graph state but failed before its renewal job.
      await enqueueOneDriveSubscriptionRenewal(connection, now, { enqueue });
      result.renewalJobs += 1;
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
  };

  // Keyset pagination keeps each SQLite query bounded without starving rows
  // after the first batch. Expired OAuth credentials cannot be repaired by a
  // daemon and are excluded in SQL instead of consuming the daily watermark.
  let afterId: string | null = null;
  while (true) {
    const connections = await db
      .select()
      .from(contentConnections)
      .where(
        and(
          eq(contentConnections.provider, "onedrive"),
          ne(contentConnections.status, "expired"),
          afterId ? gt(contentConnections.id, afterId) : undefined,
        ),
      )
      .orderBy(asc(contentConnections.id))
      .limit(batchSize);
    if (connections.length === 0) break;
    for (const connection of connections) {
      result.examined += 1;
      await reconcileConnection(connection);
    }
    afterId = connections.at(-1)!.id;
  }
  return result;
}

export async function runOneDriveSubscriptionReconciliationJob(
  payload: unknown,
  dependencies: OneDriveSubscriptionReconcileDependencies = {},
) {
  reconcilePayloadSchema.parse(payload);
  const now = dependencies.now?.() ?? new Date();
  const enqueue = dependencies.enqueue ?? enqueueJob;
  const next = await enqueueOneDriveSubscriptionReconciliation(
    new Date(now.getTime() + SUBSCRIPTION_RECONCILE_INTERVAL_MS),
    { enqueue },
  );
  const result = await reconcileOneDriveSubscriptions({
    ...dependencies,
    now: () => now,
    enqueue,
  });
  return { ...result, nextJobId: next.id };
}
