import { createHash } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "../db";
import {
  materialDocuments,
  materialFolders,
  syncedResources,
  syncConnections,
  years,
} from "../db/schema";
import { newId } from "../lib/id";
import { enqueueJob, NonRetryableJobError } from "../lib/jobs";
import { open } from "../lib/crypto";
import {
  deleteFilePreview,
  deleteFile as deleteStoredFile,
  FILE_CONSTRAINTS,
  storeFile as storeDownloadedFile,
} from "../lib/storage";
import { enqueueMaterialPreview } from "../jobs/material-preview";
import {
  SYNC_PROVIDERS,
  type ProviderDownload,
  type ProviderFile,
  type SyncProvider,
} from "./provider";
import {
  CredentialsRevokedSyncError,
  NonRetryableSyncError,
  RetryableSyncError,
} from "./errors";
import {
  defaultSchoolSyncWindow,
  SchoolPlanningPublicationConflictError,
  synchronizeSchoolPlanning,
  type SchoolPlanningPublishResult,
} from "./school-planning";

const payloadSchema = z.object({ connectionId: z.string().min(1) }).strict();
const SYNC_MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

export const SYNC_JOB_KIND = "sync.run";

type StoreFile = typeof storeDownloadedFile;
type DeleteFile = typeof deleteStoredFile;

interface SyncRunDependencies {
  providers?: Partial<
    Record<import("../db/schema").SyncProviderId, SyncProvider>
  >;
  storeFile?: StoreFile;
  deleteFile?: DeleteFile;
  now?: () => Date;
  signal?: AbortSignal;
  /** Deterministic seam for lease-loss tests at the commit boundary. */
  afterPublication?: () => void | Promise<void>;
}

export interface SyncRunError {
  externalId: string;
  message: string;
}

export interface SyncRunResult {
  downloaded: number;
  updated: number;
  skipped: number;
  errors: SyncRunError[];
  schoolPlanning?: SchoolPlanningPublishResult;
}

type SyncDatabaseReader = Pick<typeof db, "select">;

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(
        typeof signal.reason === "string"
          ? signal.reason
          : "The synchronization was aborted",
      );
}

function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw abortError(signal);
}

function connectionUnavailableError() {
  return new NonRetryableJobError(
    "The synchronization connection is no longer available",
  );
}

export function nextSyncConnectionVersion(
  expectedUpdatedAt: Date,
  now = new Date(),
) {
  // SQLite timestamp columns persist whole seconds. Advancing by at least one
  // full second prevents two writers in the same second from both matching the
  // same observed version (an ABA CAS failure).
  return new Date(Math.max(now.getTime(), expectedUpdatedAt.getTime() + 1_000));
}

function connectionVersionCanAdvance(expectedUpdatedAt: Date) {
  return eq(syncConnections.updatedAt, expectedUpdatedAt);
}

async function requireWritableConnection(
  database: SyncDatabaseReader,
  connection: { id: string; userId: string },
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  const [current] = await database
    .select({ id: syncConnections.id })
    .from(syncConnections)
    .where(
      and(
        eq(syncConnections.id, connection.id),
        eq(syncConnections.userId, connection.userId),
        inArray(syncConnections.status, ["active", "error"]),
      ),
    )
    .limit(1);
  throwIfAborted(signal);
  if (!current) throw connectionUnavailableError();
}

function safeErrorMessage(error: unknown) {
  return (
    (error instanceof Error ? error.message : String(error))
      .replace(/https?:\/\/\S+/gi, "the remote service")
      .replace(/\b[a-f\d]{32,}\b/gi, "[redacted]")
      .slice(0, 500) || "Unknown synchronization failure"
  );
}

function cleanPathComponent(value: string, fallback = "") {
  return (
    value
      .replace(/[<>:"/\\|?*]/g, "_")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/^[. ]+|[. ]+$/g, "")
      .slice(0, 100) || fallback
  );
}

function titleOf(file: ProviderFile) {
  return file.fileName.trim().slice(0, 160) || "Material";
}

function mimeTypeOf(file: ProviderFile) {
  const extension = file.fileName.toLowerCase().match(/\.[^.]+$/)?.[0] ?? "";
  return (
    SYNC_MIME_BY_EXTENSION[extension] ??
    file.mimeType ??
    "application/octet-stream"
  );
}

/**
 * Consume a provider response incrementally, enforcing the storage ceiling while
 * hashing it. The bounded chunks are retained only because the shared storage
 * boundary deliberately accepts a validated `File`.
 */
export async function materializeProviderDownload(
  source: ProviderFile,
  download: ProviderDownload,
  maxBytes = FILE_CONSTRAINTS["course-material"].maxBytes,
  signal?: AbortSignal,
) {
  throwIfAborted(signal);
  if (
    (source.byteSize !== null && source.byteSize > maxBytes) ||
    (download.contentLength !== null && download.contentLength > maxBytes)
  ) {
    void download.body.cancel().catch(() => undefined);
    throw new NonRetryableSyncError(
      `Course material exceeds the ${maxBytes} byte storage limit`,
    );
  }

  const reader = download.body.getReader();
  const chunks: ArrayBuffer[] = [];
  const hash = createHash("sha256");
  let byteSize = 0;
  const onAbort = () => {
    void reader.cancel(abortError(signal!)).catch(() => undefined);
  };
  signal?.addEventListener("abort", onAbort, { once: true });
  try {
    while (true) {
      throwIfAborted(signal);
      const chunk = await reader.read().catch((error: unknown) => {
        throwIfAborted(signal);
        throw new RetryableSyncError(
          "The course material download was interrupted",
          { cause: error },
        );
      });
      throwIfAborted(signal);
      const { done, value } = chunk;
      if (done) break;
      byteSize += value.byteLength;
      if (byteSize > maxBytes) {
        throw new NonRetryableSyncError(
          `Course material exceeds the ${maxBytes} byte storage limit`,
        );
      }
      hash.update(value);
      const owned = new Uint8Array(value.byteLength);
      owned.set(value);
      chunks.push(owned.buffer);
    }
    throwIfAborted(signal);
  } catch (error) {
    void reader.cancel().catch(() => undefined);
    throwIfAborted(signal);
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbort);
    reader.releaseLock();
  }

  return {
    contentHash: hash.digest("hex"),
    file: new File(chunks, titleOf(source), { type: mimeTypeOf(source) }),
  };
}

function sameModifiedAt(left: Date | null, right: Date | null) {
  return left !== null && right !== null && left.getTime() === right.getTime();
}

function folderInsert(values: typeof materialFolders.$inferInsert) {
  return db.insert(materialFolders).values(values);
}

async function planFolderPath(input: {
  userId: string;
  yearId: string;
  courseName: string;
  courseExternalId: string;
  path: string[];
  now: Date;
  signal?: AbortSignal;
}) {
  const rootFallback = cleanPathComponent(
    `Course ${input.courseExternalId}`,
    "Moodle course",
  );
  const names = [
    cleanPathComponent(input.courseName, rootFallback),
    ...input.path.map((part) => cleanPathComponent(part)).filter(Boolean),
  ];
  let parentId: string | null = null;
  const inserts: ReturnType<typeof folderInsert>[] = [];
  for (const name of names) {
    throwIfAborted(input.signal);
    const [existing] = await db
      .select()
      .from(materialFolders)
      .where(
        and(
          eq(materialFolders.userId, input.userId),
          eq(materialFolders.yearId, input.yearId),
          eq(materialFolders.origin, "moodle"),
          eq(materialFolders.name, name),
          parentId
            ? eq(materialFolders.parentId, parentId)
            : isNull(materialFolders.parentId),
        ),
      )
      .limit(1);
    if (existing) {
      parentId = existing.id;
      continue;
    }
    const siblings = await db
      .select({ sortOrder: materialFolders.sortOrder })
      .from(materialFolders)
      .where(
        and(
          eq(materialFolders.userId, input.userId),
          eq(materialFolders.yearId, input.yearId),
          parentId
            ? eq(materialFolders.parentId, parentId)
            : isNull(materialFolders.parentId),
        ),
      );
    const sortOrder = siblings.reduce(
      (highest, sibling) => Math.max(highest, sibling.sortOrder + 1),
      0,
    );
    throwIfAborted(input.signal);
    const folderId = newId("mfold");
    inserts.push(
      folderInsert({
        id: folderId,
        name,
        parentId,
        subjectId: null,
        origin: "moodle",
        sortOrder,
        yearId: input.yearId,
        userId: input.userId,
        createdAt: input.now,
        updatedAt: input.now,
      }),
    );
    parentId = folderId;
  }
  throwIfAborted(input.signal);
  if (!parentId)
    throw new Error("The Moodle material folder could not be resolved");
  return { folderId: parentId, inserts };
}

/**
 * The first statement in a publication batch. The scalar subquery returns
 * NULL when the connection was deleted/revoked, so SQLite aborts and rolls
 * back the whole batch before any material mutation can commit.
 */
function connectionPublicationFence(
  connection: { id: string; userId: string },
  now: Date,
  targets: {
    resource?: Pick<
      typeof syncedResources.$inferSelect,
      "id" | "contentHash" | "externalModifiedAt" | "localId"
    >;
    document?: Pick<
      typeof materialDocuments.$inferSelect,
      "id" | "fileId" | "updatedAt"
    >;
  } = {},
) {
  const id = newId("sres");
  return {
    insert: db.insert(syncedResources).values({
      id,
      connectionId: sql<string>`(
        select ${syncConnections.id}
        from ${syncConnections}
        where ${and(
          eq(syncConnections.id, connection.id),
          eq(syncConnections.userId, connection.userId),
          inArray(syncConnections.status, ["active", "error"]),
          targets.resource
            ? sql`exists (
                select 1
                from ${syncedResources}
                where ${and(
                  eq(syncedResources.id, targets.resource.id),
                  eq(syncedResources.connectionId, syncConnections.id),
                  eq(syncedResources.localId, targets.resource.localId),
                  targets.resource.contentHash === null
                    ? isNull(syncedResources.contentHash)
                    : eq(
                        syncedResources.contentHash,
                        targets.resource.contentHash,
                      ),
                  targets.resource.externalModifiedAt === null
                    ? isNull(syncedResources.externalModifiedAt)
                    : eq(
                        syncedResources.externalModifiedAt,
                        targets.resource.externalModifiedAt,
                      ),
                )}
              )`
            : undefined,
          targets.document
            ? sql`exists (
                select 1
                from ${materialDocuments}
                where ${and(
                  eq(materialDocuments.id, targets.document.id),
                  eq(materialDocuments.userId, connection.userId),
                  targets.document.fileId === null
                    ? isNull(materialDocuments.fileId)
                    : eq(materialDocuments.fileId, targets.document.fileId),
                  eq(materialDocuments.updatedAt, targets.document.updatedAt),
                )}
              )`
            : undefined,
        )}
        limit 1
      )`,
      capability: "files",
      externalId: `__publication_fence__:${id}`,
      externalModifiedAt: null,
      contentHash: null,
      localKind: "syncPublicationFence",
      localId: id,
      syncedAt: now,
      userId: connection.userId,
    }),
    remove: db.delete(syncedResources).where(eq(syncedResources.id, id)),
  };
}

async function findResource(connectionId: string, externalId: string) {
  const [resource] = await db
    .select()
    .from(syncedResources)
    .where(
      and(
        eq(syncedResources.connectionId, connectionId),
        eq(syncedResources.externalId, externalId),
      ),
    )
    .limit(1);
  return resource ?? null;
}

async function findLocalDocument(userId: string, localId: string) {
  const [document] = await db
    .select()
    .from(materialDocuments)
    .where(
      and(
        eq(materialDocuments.id, localId),
        eq(materialDocuments.userId, userId),
      ),
    )
    .limit(1);
  return document ?? null;
}

async function canCompensateStoredFile(userId: string, fileId: string) {
  try {
    const [reference] = await db
      .select({ id: materialDocuments.id })
      .from(materialDocuments)
      .where(
        and(
          eq(materialDocuments.userId, userId),
          eq(materialDocuments.fileId, fileId),
        ),
      )
      .limit(1);
    return !reference;
  } catch {
    // Unknown publication state is not permission to destroy a possibly
    // adopted object. The hourly unowned-file reaper handles true orphans.
    return false;
  }
}

async function recordConnectionFailure(
  connectionId: string,
  userId: string,
  expectedUpdatedAt: Date,
  message: string,
  now: Date,
  signal?: AbortSignal,
  status: "error" | "revoked" = "error",
) {
  throwIfAborted(signal);
  const writeAt = nextSyncConnectionVersion(expectedUpdatedAt, now);
  const [updated] = await db
    .update(syncConnections)
    .set({ status, lastError: message, updatedAt: writeAt })
    .where(
      and(
        eq(syncConnections.id, connectionId),
        eq(syncConnections.userId, userId),
        inArray(syncConnections.status, ["active", "error"]),
        connectionVersionCanAdvance(expectedUpdatedAt),
      ),
    )
    .returning({ id: syncConnections.id });
  throwIfAborted(signal);
  if (!updated) {
    await requireWritableConnection(db, { id: connectionId, userId }, signal);
    throw new RetryableSyncError(
      "The synchronization connection changed before failure publication",
    );
  }
}

/** Execute one provider-to-materials synchronization job. */
export async function runSyncJob(
  payload: unknown,
  dependencies: SyncRunDependencies = {},
): Promise<SyncRunResult> {
  const { signal } = dependencies;
  throwIfAborted(signal);
  const { connectionId } = payloadSchema.parse(payload);
  const [connection] = await db
    .select()
    .from(syncConnections)
    .where(eq(syncConnections.id, connectionId))
    .limit(1);
  throwIfAborted(signal);
  if (!connection) throw connectionUnavailableError();
  if (
    (connection.status !== "active" && connection.status !== "error") ||
    !connection.yearId ||
    !connection.sealedCredentials
  ) {
    throw connectionUnavailableError();
  }

  const now = dependencies.now?.() ?? new Date();
  const providers: Partial<
    Record<import("../db/schema").SyncProviderId, SyncProvider>
  > = dependencies.providers ?? SYNC_PROVIDERS;
  const provider = providers[connection.provider];
  if (!provider) {
    const message = "The synchronization provider is unavailable";
    await recordConnectionFailure(
      connection.id,
      connection.userId,
      connection.updatedAt,
      message,
      now,
      signal,
    );
    throw new NonRetryableJobError(message);
  }

  let credentials: string;
  try {
    credentials = open(connection.sealedCredentials);
  } catch {
    const message = "The synchronization credentials could not be opened";
    await recordConnectionFailure(
      connection.id,
      connection.userId,
      connection.updatedAt,
      message,
      now,
      signal,
    );
    throw new NonRetryableJobError(message);
  }
  const openConnection = {
    id: connection.id,
    userId: connection.userId,
    yearId: connection.yearId,
    baseUrl: connection.baseUrl,
    credentials,
    credentialRevision: connection.sealedCredentials,
    caCertPem: connection.caCertPem,
  };

  try {
    let discovered: ProviderFile[];
    try {
      const options = { signal };
      if (provider.capabilities.includes("files")) {
        const courses = await provider.listCourses(openConnection, options);
        throwIfAborted(signal);
        discovered = (
          await Promise.all(
            courses.map((course) =>
              provider.listFiles(openConnection, course.externalId, options),
            ),
          )
        ).flat();
      } else {
        discovered = [];
      }
      throwIfAborted(signal);
      await requireWritableConnection(db, connection, signal);
    } catch (error) {
      throwIfAborted(signal);
      if (error instanceof NonRetryableJobError) throw error;
      const message = safeErrorMessage(error);
      await recordConnectionFailure(
        connection.id,
        connection.userId,
        connection.updatedAt,
        message,
        now,
        signal,
        error instanceof CredentialsRevokedSyncError ? "revoked" : "error",
      );
      if (error instanceof NonRetryableSyncError) {
        throw new NonRetryableJobError(message, { cause: error });
      }
      throw new RetryableSyncError(message, { cause: error });
    }

    const result: SyncRunResult = {
      downloaded: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };
    const seen = new Set<string>();
    const storeFile = dependencies.storeFile ?? storeDownloadedFile;
    const deleteFile = dependencies.deleteFile ?? deleteStoredFile;
    let hasRetryableFailure = false;

    for (const file of discovered) {
      throwIfAborted(signal);
      if (seen.has(file.externalId)) {
        result.skipped += 1;
        continue;
      }
      seen.add(file.externalId);
      try {
        const resource = await findResource(connection.id, file.externalId);
        throwIfAborted(signal);
        const existingDocument = resource
          ? await findLocalDocument(connection.userId, resource.localId)
          : null;
        throwIfAborted(signal);
        if (resource && !existingDocument) {
          // A missing local document means the user deleted it intentionally.
          // Keeping the identity ledger prevents a later provider run restoring it.
          result.skipped += 1;
          continue;
        }
        if (
          resource &&
          existingDocument &&
          sameModifiedAt(resource.externalModifiedAt, file.modifiedAt)
        ) {
          result.skipped += 1;
          if (existingDocument.fileId) {
            await enqueueMaterialPreview({
              fileId: existingDocument.fileId,
              userId: connection.userId,
            });
          }
          continue;
        }

        const download = await provider.download(openConnection, file, {
          signal,
        });
        if (signal?.aborted) {
          void download.body.cancel(abortError(signal)).catch(() => undefined);
          throw abortError(signal);
        }
        const materialized = await materializeProviderDownload(
          file,
          download,
          FILE_CONSTRAINTS["course-material"].maxBytes,
          signal,
        );
        throwIfAborted(signal);
        const { contentHash } = materialized;
        if (
          resource &&
          existingDocument &&
          resource.contentHash === contentHash
        ) {
          const fence = connectionPublicationFence(connection, now, {
            resource,
            document: existingDocument,
          });
          try {
            throwIfAborted(signal);
            const [, updated] = await db.batch([
              fence.insert,
              db
                .update(syncedResources)
                .set({
                  externalModifiedAt: file.modifiedAt,
                  syncedAt: now,
                })
                .where(
                  and(
                    eq(syncedResources.id, resource.id),
                    eq(syncedResources.connectionId, connection.id),
                  ),
                )
                .returning({ id: syncedResources.id }),
              fence.remove,
            ]);
            if (updated.length === 0) {
              throw new RetryableSyncError(
                "The synchronized resource changed before publication",
              );
            }
            throwIfAborted(signal);
          } catch (error) {
            throwIfAborted(signal);
            await requireWritableConnection(db, connection, signal);
            throw error;
          }
          result.skipped += 1;
          continue;
        }

        await requireWritableConnection(db, connection, signal);
        throwIfAborted(signal);
        const stored = await storeFile({
          userId: connection.userId,
          purpose: "course-material",
          file: materialized.file,
          nameHint: titleOf(file),
        });
        let publicationCommitted = false;
        try {
          throwIfAborted(signal);
          const folderPlan = await planFolderPath({
            userId: connection.userId,
            yearId: connection.yearId,
            courseName: file.courseRef.name,
            courseExternalId: file.courseRef.externalId,
            path: file.folderPath,
            now,
            signal,
          });
          const fence = connectionPublicationFence(
            connection,
            now,
            resource && existingDocument
              ? {
                  resource,
                  document: existingDocument,
                }
              : {},
          );
          throwIfAborted(signal);
          if (resource && existingDocument) {
            const updateDocument = db
              .update(materialDocuments)
              .set({
                title: titleOf(file),
                folderId: folderPlan.folderId,
                sourceType: "file",
                fileId: stored.id,
                sourceUrl: null,
                textContent: null,
                origin: "moodle",
                metaVersion: 1,
                metaJson: { externalId: file.externalId },
                updatedAt: now,
              })
              .where(
                and(
                  eq(materialDocuments.id, existingDocument.id),
                  eq(materialDocuments.userId, connection.userId),
                ),
              )
              .returning({ id: materialDocuments.id });
            const updateResource = db
              .update(syncedResources)
              .set({
                externalModifiedAt: file.modifiedAt,
                contentHash,
                syncedAt: now,
              })
              .where(
                and(
                  eq(syncedResources.id, resource.id),
                  eq(syncedResources.connectionId, connection.id),
                ),
              )
              .returning({ id: syncedResources.id });
            const statements = [
              fence.insert,
              ...folderPlan.inserts,
              updateDocument,
              updateResource,
              fence.remove,
            ];
            await db.batch(
              statements as [
                (typeof statements)[number],
                ...(typeof statements)[number][],
              ],
            );
          } else {
            const documentId = newId("mdoc");
            const insertDocument = db.insert(materialDocuments).values({
              id: documentId,
              title: titleOf(file),
              folderId: folderPlan.folderId,
              sourceType: "file",
              fileId: stored.id,
              sourceUrl: null,
              textContent: null,
              origin: "moodle",
              metaVersion: 1,
              metaJson: { externalId: file.externalId },
              yearId: connection.yearId,
              userId: connection.userId,
              createdAt: now,
              updatedAt: now,
            });
            const insertResource = db.insert(syncedResources).values({
              id: newId("sres"),
              connectionId: connection.id,
              capability: "files",
              externalId: file.externalId,
              externalModifiedAt: file.modifiedAt,
              contentHash,
              localKind: "materialDocument",
              localId: documentId,
              syncedAt: now,
              userId: connection.userId,
            });
            const statements = [
              fence.insert,
              ...folderPlan.inserts,
              insertDocument,
              insertResource,
              fence.remove,
            ];
            await db.batch(
              statements as [
                (typeof statements)[number],
                ...(typeof statements)[number][],
              ],
            );
          }
          publicationCommitted = true;
          await enqueueMaterialPreview({
            fileId: stored.id,
            userId: connection.userId,
          });
          await dependencies.afterPublication?.();
          throwIfAborted(signal);
        } catch (error) {
          if (
            !publicationCommitted &&
            (await canCompensateStoredFile(connection.userId, stored.id))
          ) {
            await deleteFile(connection.userId, stored.id).catch(
              () => undefined,
            );
          }
          throwIfAborted(signal);
          await requireWritableConnection(db, connection, signal);
          throw error;
        }
        throwIfAborted(signal);
        if (resource && existingDocument) {
          if (
            existingDocument.fileId &&
            existingDocument.fileId !== stored.id
          ) {
            await deleteFilePreview(
              connection.userId,
              existingDocument.fileId,
            ).catch(() => undefined);
            await deleteFile(connection.userId, existingDocument.fileId).catch(
              () => undefined,
            );
            throwIfAborted(signal);
          }
          result.updated += 1;
        } else {
          result.downloaded += 1;
        }
      } catch (error) {
        throwIfAborted(signal);
        if (error instanceof NonRetryableJobError) throw error;
        hasRetryableFailure ||= !(error instanceof NonRetryableSyncError);
        result.errors.push({
          externalId: file.externalId,
          message: safeErrorMessage(error),
        });
      }
    }

    const lastError = result.errors.length
      ? `${result.errors.length} file(s) failed: ${result.errors[0]?.message ?? "unknown failure"}`.slice(
          0,
          1_000,
        )
      : null;
    const connectionWriteAt = nextSyncConnectionVersion(
      connection.updatedAt,
      now,
    );
    let schoolConnectionPublished = false;

    if (provider.school) {
      try {
        const [academicYear] = await db
          .select({ startsAt: years.startsAt, endsAt: years.endsAt })
          .from(years)
          .where(
            and(
              eq(years.id, connection.yearId),
              eq(years.userId, connection.userId),
            ),
          )
          .limit(1);
        if (!academicYear) {
          throw new NonRetryableSyncError(
            "The connected academic year is unavailable",
          );
        }
        const schoolTimezone =
          provider.school.timezone?.(openConnection) ?? "Europe/Paris";
        result.schoolPlanning = await synchronizeSchoolPlanning(
          provider.school,
          openConnection,
          {
            signal,
            window: defaultSchoolSyncWindow(now, schoolTimezone),
          },
          {
            expectedConnectionUpdatedAt: connection.updatedAt,
            connectionUpdatedAt: connectionWriteAt,
            connectionStatus: result.errors.length ? "error" : "active",
            lastSyncAt: now,
            lastError,
          },
          now,
          {
            window: {
              from: academicYear.startsAt,
              to: academicYear.endsAt,
              timezone: schoolTimezone,
            },
            publish: connection.gradesAuthority,
          },
        );
        schoolConnectionPublished = true;
        throwIfAborted(signal);
      } catch (error) {
        throwIfAborted(signal);
        const message = safeErrorMessage(error);
        if (error instanceof SchoolPlanningPublicationConflictError) {
          throw new RetryableSyncError(message, { cause: error });
        }
        await recordConnectionFailure(
          connection.id,
          connection.userId,
          connection.updatedAt,
          message,
          now,
          signal,
          error instanceof CredentialsRevokedSyncError ? "revoked" : "error",
        );
        if (error instanceof NonRetryableSyncError) {
          throw new NonRetryableJobError(message, { cause: error });
        }
        throw new RetryableSyncError(message, { cause: error });
      }
    }

    if (!schoolConnectionPublished) {
      throwIfAborted(signal);
      const [updatedConnection] = await db
        .update(syncConnections)
        .set({
          status: result.errors.length ? "error" : "active",
          lastSyncAt: now,
          lastError,
          updatedAt: connectionWriteAt,
        })
        .where(
          and(
            eq(syncConnections.id, connection.id),
            eq(syncConnections.userId, connection.userId),
            inArray(syncConnections.status, ["active", "error"]),
            connectionVersionCanAdvance(connection.updatedAt),
          ),
        )
        .returning({ id: syncConnections.id });
      throwIfAborted(signal);
      if (!updatedConnection) {
        await requireWritableConnection(db, connection, signal);
        throw new RetryableSyncError(
          "The synchronization connection changed before publication",
        );
      }
    }
    if (hasRetryableFailure) {
      throw new RetryableSyncError(
        lastError ?? "The synchronization must be retried",
      );
    }
    return result;
  } finally {
    await provider.releaseConnection?.(openConnection);
  }
}

export function syncRunIdempotencyKey(connectionId: string, _now = new Date()) {
  // A connection can have at most one active run, even when it crosses an
  // hour boundary. enqueueJob archives this canonical key only after the run
  // is terminal, at which point an explicit request gets a fresh job id.
  return connectionId;
}

export function enqueueSyncRun(
  userId: string,
  connectionId: string,
  now = new Date(),
) {
  return enqueueJob({
    kind: SYNC_JOB_KIND,
    payload: { connectionId },
    userId,
    idempotencyKey: syncRunIdempotencyKey(connectionId, now),
    maxAttempts: 3,
    newAttemptAfterTerminal: true,
  });
}
