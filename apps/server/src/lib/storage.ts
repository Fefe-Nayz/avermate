import { and, eq, isNull, sum } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "../db";
import { files, type FilePurpose } from "../db/schema";
import { newId } from "./id";
import { enqueueJob } from "./jobs";
import { badRequest } from "./orpc";
import { requireFile } from "./ownership";
import { DOCUMENT_ARTIFACT_FILE_CONSTRAINT } from "./document-artifact-policy";
import {
  canonicalFileUrl,
  deleteStorageObject,
  fileVisibilityForPurpose,
  headStorageObject,
  newStorageKey,
  putStorageObject,
  signedStorageObjectUrl,
  storageBackendEnabled,
  storageDriver,
  type ManagedStorageProvider,
} from "./storage-backend";
import {
  createPairedNodeObjectStorageProvider,
  nodeIdFromStorageProvider,
  selectedNodeObjectStorageProvider,
} from "../node/services";

/**
 * Shared storage boundary for every provider-backed object.
 *
 * Deletion is soft in the database: the provider object is removed and the
 * row becomes `deleted`, so a referencing domain row never turns into an
 * unresolvable identifier during cleanup or audit.
 */

export const STORAGE_PROVIDER_DELETE_TIMEOUT_MS = 30_000;
export const COURSE_MATERIAL_STORAGE_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;
export const COURSE_MEDIA_STORAGE_QUOTA_BYTES = 20 * 1024 * 1024 * 1024;
export const LATEX_BUILD_STORAGE_QUOTA_BYTES = 512 * 1024 * 1024;
export const DOCUMENT_ARTIFACT_STORAGE_QUOTA_BYTES = 2 * 1024 * 1024 * 1024;

async function withProviderDeleteDeadline<T>(
  operation: Promise<T>,
  timeoutMs: number,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Storage provider deletion timed out")),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export const FILE_CONSTRAINTS: Record<
  FilePurpose,
  { maxBytes: number; mimeTypes: readonly string[] }
> = {
  avatar: {
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: ["image/png", "image/jpeg", "image/webp"],
  },
  "feedback-attachment": {
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: ["image/png", "image/jpeg", "image/webp"],
  },
  "course-material": {
    maxBytes: 50 * 1024 * 1024,
    mimeTypes: [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "text/plain",
      "text/markdown",
      "text/csv",
      "text/tab-separated-values",
      "application/x-subrip",
      "text/vtt",
      "application/x-ipynb+json",
      "text/x-python",
      "text/x-c",
      "text/x-c++src",
      "text/x-java-source",
      "application/sql",
      "text/x-r-source",
      "text/javascript",
      "text/typescript",
      "application/json",
      "application/yaml",
      "application/epub+zip",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.oasis.opendocument.text",
      "application/vnd.oasis.opendocument.presentation",
      "application/vnd.oasis.opendocument.spreadsheet",
    ],
  },
  "course-media": {
    maxBytes: 500 * 1024 * 1024,
    mimeTypes: [
      "audio/mpeg",
      "audio/mp4",
      "audio/m4a",
      "audio/wav",
      "audio/ogg",
      "audio/webm",
      "video/mp4",
      "video/webm",
      "video/quicktime",
    ],
  },
  "lecture-audio-segment": {
    maxBytes: 32 * 1024 * 1024,
    mimeTypes: ["audio/mp4", "audio/m4a", "audio/webm", "audio/ogg"],
  },
  "grade-copy": {
    maxBytes: 25 * 1024 * 1024,
    mimeTypes: [
      "application/pdf",
      "image/png",
      "image/jpeg",
      "image/webp",
      "image/heic",
    ],
  },
  "document-export": {
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
  },
  "document-artifact": DOCUMENT_ARTIFACT_FILE_CONSTRAINT,
  preview: {
    maxBytes: 2 * 1024 * 1024,
    mimeTypes: ["image/webp"],
  },
  "latex-build": {
    maxBytes: 20 * 1024 * 1024,
    mimeTypes: ["application/pdf"],
  },
};

export const COURSE_MATERIAL_EXTENSION_MIME_TYPES = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".markdown": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".srt": "application/x-subrip",
  ".vtt": "text/vtt",
  ".ipynb": "application/x-ipynb+json",
  ".py": "text/x-python",
  ".c": "text/x-c",
  ".h": "text/x-c",
  ".cpp": "text/x-c++src",
  ".cc": "text/x-c++src",
  ".java": "text/x-java-source",
  ".sql": "application/sql",
  ".r": "text/x-r-source",
  ".js": "text/javascript",
  ".ts": "text/typescript",
  ".json": "application/json",
  ".yaml": "application/yaml",
  ".yml": "application/yaml",
  ".epub": "application/epub+zip",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx":
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".odt": "application/vnd.oasis.opendocument.text",
  ".odp": "application/vnd.oasis.opendocument.presentation",
  ".ods": "application/vnd.oasis.opendocument.spreadsheet",
} as const;

export const COURSE_MEDIA_EXTENSION_MIME_TYPES = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".wav": "audio/wav",
  ".ogg": "audio/ogg",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".mov": "video/quicktime",
} as const;

export const COURSE_MATERIAL_EXTENSIONS = Object.keys(
  COURSE_MATERIAL_EXTENSION_MIME_TYPES,
);
export const COURSE_MEDIA_EXTENSIONS = Object.keys(
  COURSE_MEDIA_EXTENSION_MIME_TYPES,
);

export function storageEnabled() {
  return storageBackendEnabled();
}

function validationMessages(purpose: FilePurpose) {
  if (purpose === "avatar") {
    return {
      tooLarge: "That image is too large — crop it or pick a smaller one",
      badMime: "Only PNG, JPEG and WebP images are supported",
      disabled: "Avatar uploads are not configured on this server",
      failed: "The upload failed. Try again.",
    };
  }
  if (purpose === "course-material") {
    return {
      tooLarge: "Course materials must be 50 MiB or smaller",
      badMime:
        "Only PDF, image, text, Microsoft Office and OpenDocument course materials are supported",
      disabled: "Course-material uploads are not configured on this server",
      failed: "The course-material upload failed. Try again.",
    };
  }
  if (purpose === "course-media") {
    return {
      tooLarge: "Course audio and video must be 500 MiB or smaller",
      badMime: "Only MP3, M4A, WAV, Ogg, MP4, WebM and MOV media are supported",
      disabled: "Course-media uploads are not configured on this server",
      failed: "The course-media upload failed. Try again.",
    };
  }
  if (purpose === "lecture-audio-segment") {
    return {
      tooLarge: "Lecture segments must be 32 MiB or smaller",
      badMime: "Only MP4, M4A, WebM and Ogg lecture audio is supported",
      disabled: "Lecture-audio uploads are not configured on this server",
      failed: "The lecture segment upload failed. Try again.",
    };
  }
  if (purpose === "grade-copy") {
    return {
      tooLarge: "The copy must be 25 MiB or smaller",
      badMime: "Only PDF, PNG, JPEG, WebP and HEIC copies are supported",
      disabled: "Copy uploads are not configured on this server",
      failed: "The copy upload failed. Try again.",
    };
  }
  if (purpose === "document-export") {
    return {
      tooLarge: "Document exports must be 20 MiB or smaller",
      badMime: "Only PowerPoint document exports are supported",
      disabled: "Document exports are not configured on this server",
      failed: "The document export upload failed. Try again.",
    };
  }
  if (purpose === "document-artifact") {
    return {
      tooLarge: "Generated document artifacts must be 100 MiB or smaller",
      badMime: "This generated document artifact type is not supported",
      disabled: "Document-artifact storage is not configured on this server",
      failed: "The generated document artifact could not be stored.",
    };
  }
  if (purpose === "preview") {
    return {
      tooLarge: "Material previews must be 2 MiB or smaller",
      badMime: "Material previews must be WebP images",
      disabled: "Material preview storage is not configured on this server",
      failed: "The material preview could not be stored.",
    };
  }
  if (purpose === "latex-build") {
    return {
      tooLarge: "LaTeX PDF builds must be 20 MiB or smaller",
      badMime: "LaTeX builds must produce a PDF",
      disabled: "LaTeX build storage is not configured on this server",
      failed: "The LaTeX PDF build could not be stored.",
    };
  }
  return {
    tooLarge: "The feedback image must be 2 MiB or smaller",
    badMime: "Only PNG, JPEG and WebP feedback images are supported",
    disabled: "Feedback image uploads are not configured on this server",
    failed: "The feedback image upload failed. Try again.",
  };
}

export function fileAclForPurpose(
  purpose: FilePurpose,
): "private" | "public-read" {
  return fileVisibilityForPurpose(purpose) === "public"
    ? "public-read"
    : "private";
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot).toLowerCase();
}

export function resolvedFileMimeType(
  purpose: FilePurpose,
  file: Pick<File, "name" | "type">,
): string | null {
  const declared = file.type.trim().toLowerCase();
  const constraint = FILE_CONSTRAINTS[purpose];
  if (constraint.mimeTypes.includes(declared)) return declared;
  if (
    (purpose === "course-material" || purpose === "course-media") &&
    (declared === "" || declared === "application/octet-stream")
  ) {
    return (
      (purpose === "course-material"
        ? COURSE_MATERIAL_EXTENSION_MIME_TYPES[
            extensionOf(
              file.name,
            ) as keyof typeof COURSE_MATERIAL_EXTENSION_MIME_TYPES
          ]
        : COURSE_MEDIA_EXTENSION_MIME_TYPES[
            extensionOf(
              file.name,
            ) as keyof typeof COURSE_MEDIA_EXTENSION_MIME_TYPES
          ]) ?? null
    );
  }
  return null;
}

/** Choose the bounded upload lane without trusting a browser MIME alone. */
export function courseUploadPurpose(
  file: Pick<File, "name" | "type">,
): "course-material" | "course-media" {
  return resolvedFileMimeType("course-media", file)
    ? "course-media"
    : "course-material";
}

export function validateFileForPurpose(purpose: FilePurpose, file: File) {
  return validateFileInfoForPurpose(purpose, file);
}

export function validateFileInfoForPurpose(
  purpose: FilePurpose,
  file: Pick<File, "name" | "type" | "size">,
) {
  const constraint = FILE_CONSTRAINTS[purpose];
  const messages = validationMessages(purpose);
  if (file.size > constraint.maxBytes) badRequest(messages.tooLarge);
  const mimeType = resolvedFileMimeType(purpose, file);
  if (!mimeType) badRequest(messages.badMime);
  return mimeType;
}

export async function storeFile(input: {
  userId: string;
  purpose: FilePurpose;
  file: File;
  nameHint?: string;
}) {
  const messages = validationMessages(input.purpose);
  const mimeType = validateFileForPurpose(input.purpose, input.file);
  let nodeProvider: Awaited<
    ReturnType<typeof selectedNodeObjectStorageProvider>
  > = null;
  try {
    nodeProvider = await selectedNodeObjectStorageProvider(input.userId);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("NODE_STORAGE_CAPABILITY_")
    ) {
      throw new Error(
        "NODE_STORAGE_CAPABILITY_OFFLINE:Reconnect your Avermate Node or change the storage placement in Settings.",
      );
    }
    throw error;
  }
  if (!nodeProvider && !storageEnabled()) badRequest(messages.disabled);

  const provider = nodeProvider?.id ?? storageDriver();
  const id = newId("file");
  const storageKey = newStorageKey({
    purpose: input.purpose,
    userId: input.userId,
    name: input.nameHint ?? input.file.name,
  });
  let expectedDigest: `sha256:${string}` | null = null;
  try {
    if (nodeProvider) {
      const digest = createHash("sha256");
      for await (const chunk of input.file.stream()) digest.update(chunk);
      expectedDigest = `sha256:${digest.digest("hex")}`;
      await nodeProvider.put({
        ref: {
          ownerId: input.userId,
          namespace: "files",
          key: storageKey,
        },
        body: input.file.stream(),
        byteSize: input.file.size,
        mimeType,
        expectedDigest,
        idempotencyKey: `file-upload:${id}`,
      });
    } else {
      await putStorageObject({
        provider: provider as ManagedStorageProvider,
        storageKey,
        purpose: input.purpose,
        file: input.file,
        mimeType,
      });
    }
  } catch (error) {
    console.error("[storage] provider upload failed", error);
    badRequest(messages.failed);
  }

  try {
    return await recordStoredFile({
      id,
      provider,
      storageKey,
      url: canonicalFileUrl(id),
      mimeType,
      byteSize: input.file.size,
      purpose: input.purpose,
      userId: input.userId,
    });
  } catch (error) {
    try {
      await compensateProviderUpload(storageKey, {
        deleteProviderFile: async (key) => {
          if (nodeProvider) {
            const result = await nodeProvider.delete({
              ref: {
                ownerId: input.userId,
                namespace: "files",
                key,
              },
              ...(expectedDigest ? { expectedDigest } : {}),
              idempotencyKey: `file-upload-compensate:${id}`,
            });
            return {
              success: result.deleted || result.alreadyAbsent,
              deletedCount: result.deleted ? 1 : 0,
            };
          }
          await deleteStorageObject(provider as ManagedStorageProvider, key);
          return { success: true, deletedCount: 1 };
        },
      });
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        "The provider upload was stored, but database persistence and compensating deletion both failed",
      );
    }
    throw error;
  }
}

/**
 * Adopt a provider object and enforce the persistent course-material quota in
 * the same SQLite transaction. Concurrent uploads cannot both reserve the same
 * remaining bytes; a rejected adoption is compensated by `storeFile`.
 */
export async function recordStoredFile(
  input: Pick<
    typeof files.$inferInsert,
    | "id"
    | "provider"
    | "storageKey"
    | "url"
    | "mimeType"
    | "byteSize"
    | "purpose"
    | "userId"
  >,
  options: {
    database?: typeof db;
    courseMaterialQuotaBytes?: number;
    latexBuildQuotaBytes?: number;
  } = {},
) {
  const database = options.database ?? db;
  return database.transaction(async (tx) => {
    if (
      input.purpose === "course-material" ||
      input.purpose === "course-media" ||
      input.purpose === "latex-build" ||
      input.purpose === "document-artifact"
    ) {
      const quotaBytes =
        input.purpose === "course-material"
          ? (options.courseMaterialQuotaBytes ?? COURSE_MATERIAL_STORAGE_QUOTA_BYTES)
          : input.purpose === "course-media"
            ? COURSE_MEDIA_STORAGE_QUOTA_BYTES
            : input.purpose === "document-artifact"
              ? DOCUMENT_ARTIFACT_STORAGE_QUOTA_BYTES
              : (options.latexBuildQuotaBytes ?? LATEX_BUILD_STORAGE_QUOTA_BYTES);
      const [usage] = await tx
        .select({ byteSize: sum(files.byteSize) })
        .from(files)
        .where(
          and(
            eq(files.userId, input.userId),
            eq(files.purpose, input.purpose),
            eq(files.status, "stored"),
          ),
        );
      if (Number(usage?.byteSize ?? 0) + input.byteSize > quotaBytes) {
        badRequest(
          input.purpose === "course-material"
            ? "Course-material storage is limited to 5 GiB per account"
            : input.purpose === "course-media"
              ? "Course-media storage is limited to 20 GiB per account"
              : input.purpose === "document-artifact"
                ? "Generated document storage is limited to 2 GiB per account"
                : "LaTeX build storage is limited to 512 MiB per account",
        );
      }
    }
    const [stored] = await tx.insert(files).values(input).returning();
    if (!stored) throw new Error("The stored file row was not returned");
    return stored;
  });
}

/** Resolve a provider URL only after the caller has enforced file ownership. */
export async function fileAccessUrl(
  file: Pick<typeof files.$inferSelect, "provider" | "storageKey" | "url">,
  options: { expiresIn?: "5m" | "1h" | "6h" } = {},
): Promise<string> {
  if (file.provider !== "s3") return file.url;
  if (!storageEnabled()) {
    badRequest("File access is not configured on this server");
  }
  return signedStorageObjectUrl(
    file.storageKey,
    options.expiresIn === "6h"
      ? 6 * 60 * 60
      : options.expiresIn === "1h"
        ? 60 * 60
        : 5 * 60,
  );
}

/**
 * Resolve a file created by the direct-upload endpoint. The HEAD/stat check is
 * deliberately performed here, after the browser has completed its PUT: a
 * signed URL alone is not proof that an object was actually stored.
 */
export async function requireUploadedFile(
  userId: string,
  fileId: string,
  purpose: FilePurpose,
) {
  const file = await requireFile(userId, fileId);
  if (file.status !== "stored" || file.purpose !== purpose) {
    badRequest("The uploaded file is unavailable or has the wrong purpose");
  }
  let object: {
    byteSize: number;
    mimeType: string | null;
  };
  try {
    const nodeId = nodeIdFromStorageProvider(file.provider);
    if (nodeId) {
      const provider = await createPairedNodeObjectStorageProvider({
        ownerId: userId,
        nodeId,
      });
      const metadata = await provider.stat({
        ref: { ownerId: userId, namespace: "files", key: file.storageKey },
      });
      if (!metadata) throw new Error("OBJECT_NOT_FOUND");
      object = metadata;
    } else if (file.provider === "local" || file.provider === "s3") {
      object = await headStorageObject(
        file.provider as ManagedStorageProvider,
        file.storageKey,
      );
    } else {
      badRequest("The uploaded file is not managed by this storage service");
    }
  } catch {
    badRequest("The uploaded file has not reached storage");
  }
  if (object.byteSize !== file.byteSize) {
    badRequest("The uploaded file size does not match its reservation");
  }
  if (object.mimeType && object.mimeType !== file.mimeType.toLowerCase()) {
    badRequest("The uploaded file type does not match its reservation");
  }
  return file;
}

export async function resolveIncomingFile(input: {
  userId: string;
  purpose: FilePurpose;
  fileId?: string;
  file?: File;
  nameHint?: string;
}) {
  if (input.fileId) {
    return requireUploadedFile(input.userId, input.fileId, input.purpose);
  }
  if (input.file) {
    return storeFile({
      userId: input.userId,
      purpose: input.purpose,
      file: input.file,
      nameHint: input.nameHint,
    });
  }
  badRequest("A file upload is required");
}

export type DeleteProviderFile = (
  storageKey: string,
) => Promise<{ success: boolean; deletedCount: number }>;

/**
 * Compensate an upload whose database INSERT failed. There is no durable row
 * available for the cleanup queue in this boundary, so exhaust several direct
 * provider attempts and surface a loud aggregate error if none is confirmed.
 */
export async function compensateProviderUpload(
  storageKey: string,
  options: {
    deleteProviderFile: DeleteProviderFile;
    sleep?: (milliseconds: number) => Promise<void>;
    maxAttempts?: number;
    timeoutMs?: number;
  },
) {
  const maxAttempts = options.maxAttempts ?? 6;
  const timeoutMs = options.timeoutMs ?? STORAGE_PROVIDER_DELETE_TIMEOUT_MS;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  let lastError: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await withProviderDeleteDeadline(
        options.deleteProviderFile(storageKey),
        timeoutMs,
      );
      if (result.success) return result;
      lastError = new Error(
        "The storage provider did not confirm compensating deletion",
      );
    } catch (error) {
      lastError = error;
    }
    if (attempt < maxAttempts - 1) {
      await sleep(Math.min(2_000, 250 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Storage provider compensating deletion failed");
}

type EnqueueCleanup = typeof enqueueJob;

async function deferProviderDeletion(
  file: typeof files.$inferSelect,
  enqueue: EnqueueCleanup,
) {
  await enqueue({
    kind: "cleanup.unownedFile",
    payload: { userId: file.userId, fileId: file.id },
    userId: file.userId,
    // Each call is a distinct durable attempt. A prior job may have completed
    // while the file was still referenced; provider deletion is idempotent.
    idempotencyKey: `delete:${file.id}:${newId("cleanup")}`,
    maxAttempts: 6,
  });
}

export interface DeleteFileOptions {
  deleteProviderFile?: DeleteProviderFile | null;
  /** Cleanup jobs disable deferral so their own failure remains retryable. */
  deferOnProviderFailure?: boolean;
  enqueueCleanup?: EnqueueCleanup;
  providerTimeoutMs?: number;
}

export async function deleteFile(
  userId: string,
  fileId: string,
  options: DeleteFileOptions = {},
) {
  const file = await requireFile(userId, fileId);
  if (file.status === "deleted") return file;

  const nodeId = nodeIdFromStorageProvider(file.provider);
  if (nodeId) {
    const handleProviderFailure = async (error: Error) => {
      if (options.deferOnProviderFailure === false) throw error;
      await deferProviderDeletion(file, options.enqueueCleanup ?? enqueueJob);
      return file;
    };
    try {
      const provider = await createPairedNodeObjectStorageProvider({
        ownerId: userId,
        nodeId,
      });
      const result = await withProviderDeleteDeadline(
        provider.delete({
          ref: { ownerId: userId, namespace: "files", key: file.storageKey },
          idempotencyKey: `file-delete:${file.id}`,
        }),
        options.providerTimeoutMs ?? STORAGE_PROVIDER_DELETE_TIMEOUT_MS,
      );
      if (!result.deleted && !result.alreadyAbsent) {
        return handleProviderFailure(
          new Error("The Node did not confirm file deletion"),
        );
      }
    } catch (error) {
      return handleProviderFailure(
        error instanceof Error
          ? error
          : new Error("Node storage deletion failed"),
      );
    }
  } else if (file.provider === "local" || file.provider === "s3") {
    const managedProvider = file.provider as ManagedStorageProvider;
    const removeProviderFile =
      options.deleteProviderFile === undefined
        ? async (storageKey: string) => {
            await deleteStorageObject(managedProvider, storageKey);
            return { success: true, deletedCount: 1 };
          }
        : options.deleteProviderFile;
    const handleProviderFailure = async (error: Error) => {
      if (options.deferOnProviderFailure === false) throw error;
      await deferProviderDeletion(file, options.enqueueCleanup ?? enqueueJob);
      return file;
    };
    if (!removeProviderFile)
      return handleProviderFailure(
        new Error(
          "Storage provider deletion is not configured; the file remains stored",
        ),
      );
    // The provider contract is `{ success, deletedCount }`. A successful
    // response with `deletedCount: 0` is the idempotent already-absent case;
    // an exception or `success: false` must keep the local row retryable.
    let result: Awaited<ReturnType<DeleteProviderFile>>;
    try {
      result = await withProviderDeleteDeadline(
        removeProviderFile(file.storageKey),
        options.providerTimeoutMs ?? STORAGE_PROVIDER_DELETE_TIMEOUT_MS,
      );
    } catch (error) {
      return handleProviderFailure(
        error instanceof Error
          ? error
          : new Error("Storage provider deletion failed"),
      );
    }
    if (!result.success) {
      return handleProviderFailure(
        new Error(
          "The storage provider did not confirm deletion; the file remains stored",
        ),
      );
    }
  }
  const [deleted] = await db
    .update(files)
    .set({ status: "deleted", updatedAt: new Date() })
    .where(eq(files.id, file.id))
    .returning();
  return deleted ?? { ...file, status: "deleted" as const };
}

/**
 * Detach and remove the derivative owned by a source file before that source is
 * purged. This deliberately is not recursive: malformed historical self-links
 * or cycles are severed once and can never walk an unbounded file graph.
 */
export async function deleteFilePreview(
  userId: string,
  sourceFileId: string,
  options: DeleteFileOptions = {},
) {
  const source = await requireFile(userId, sourceFileId);
  const previewFileId = source.previewFileId;
  if (!previewFileId) return null;

  await db
    .update(files)
    .set({
      previewFileId: null,
      previewStatus: "pending",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(files.id, source.id),
        eq(files.userId, userId),
        eq(files.previewFileId, previewFileId),
      ),
    );
  if (previewFileId === source.id) return null;

  try {
    return await deleteFile(userId, previewFileId, options);
  } catch (error) {
    // Restore only if no new preview won the slot while provider deletion ran.
    await db
      .update(files)
      .set({
        previewFileId,
        previewStatus: "ready",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(files.id, source.id),
          eq(files.userId, userId),
          isNull(files.previewFileId),
        ),
      );
    throw error;
  }
}

/**
 * Delete provider objects before a user row can cascade away the only durable
 * storage ledger. A failure intentionally blocks account deletion: losing the
 * database rows first would make the remote objects impossible to reap.
 */
export async function deleteAllUserFiles(userId: string) {
  const owned = await db
    .select({ id: files.id })
    .from(files)
    .where(and(eq(files.userId, userId), eq(files.status, "stored")));
  for (const file of owned) {
    await deleteFile(userId, file.id, { deferOnProviderFailure: false });
  }
  return { deletedCount: owned.length };
}

/**
 * @deprecated Transitional support for URLs stored before the `files` table.
 * Historical rows are intentionally backfilled in a later maintenance pass.
 */
export function legacyKeyOf(url: string | null): string | null {
  if (!url) return null;
  const match = url.match(/\/f\/([^/?#]+)/);
  return match?.[1] ?? null;
}

/** @deprecated Only for deleting a pre-`files` provider key. */
export async function deleteLegacyStorageKey(storageKey: string) {
  void storageKey;
}
