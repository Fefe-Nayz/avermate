import { and, eq } from "drizzle-orm";
import {
  handleRequest,
  RejectUpload,
  type Router,
  route,
} from "better-upload/server";
import { Hono } from "hono";
import { db } from "../db";
import { files, type FilePurpose } from "../db/schema";
import { isAdmin } from "../lib/admin";
import { isSuspensionActive } from "../lib/access-policy";
import { auth } from "../lib/auth";
import { newId } from "../lib/id";
import { reserveRateLimit } from "../lib/rate-limit";
import {
  FILE_CONSTRAINTS,
  fileAccessUrl,
  recordStoredFile,
  storageEnabled,
  storeFile,
  validateFileInfoForPurpose,
} from "../lib/storage";
import {
  bucketForPurpose,
  canonicalFileUrl,
  fileVisibilityForPurpose,
  getS3Client,
  localObjectPath,
  newStorageKey,
  s3StorageConfigured,
  storageDriver,
} from "../lib/storage-backend";
import { selectedNodeObjectStorageProvider } from "../node/services";
import { nodeFileResponse } from "../node/node-file-response";

const uploadPurposes = {
  avatar: "avatar",
  feedbackAttachment: "feedback-attachment",
  courseMaterial: "course-material",
  courseMedia: "course-media",
  lectureAudioSegment: "lecture-audio-segment",
  gradeCopy: "grade-copy",
} as const satisfies Record<string, FilePurpose>;

export type BrowserUploadRoute = keyof typeof uploadPurposes;

type UploadReservation = {
  fileId: string;
  mimeType: string;
  purpose: FilePurpose;
  userId: string;
};

async function uploadUser(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) throw new RejectUpload("Authentication required");
  if (!session.user.emailVerified) {
    throw new RejectUpload("Verify your email address before uploading files");
  }
  if (isSuspensionActive(session.user)) {
    throw new RejectUpload("This account is suspended");
  }
  return session.user;
}

function rejectableValidation(
  purpose: FilePurpose,
  file: { name: string; size: number; type: string },
) {
  try {
    return validateFileInfoForPurpose(purpose, file);
  } catch (error) {
    throw new RejectUpload(
      error instanceof Error ? error.message : "The file is not supported",
    );
  }
}

function reserveUpload(userId: string, purpose: FilePurpose) {
  try {
    reserveRateLimit({
      subject: userId,
      action: `storage.upload.${purpose}`,
      limit:
        purpose === "lecture-audio-segment"
          ? 180
          : purpose === "course-media"
            ? 30
            : 90,
      windowMs: 60 * 60_000,
    });
  } catch (error) {
    throw new RejectUpload(
      error instanceof Error ? error.message : "Too many uploads",
    );
  }
}

function uploadRouteForPurpose(purpose: FilePurpose) {
  return route<false, false, UploadReservation>({
    maxFileSize: FILE_CONSTRAINTS[purpose].maxBytes,
    signedUrlExpiresIn: 5 * 60,
    onBeforeUpload: async ({ req, file }) => {
      const user = await uploadUser(req);
      reserveUpload(user.id, purpose);
      const mimeType = rejectableValidation(purpose, file);
      const fileId = newId("file");
      return {
        bucketName: bucketForPurpose(purpose),
        metadata: { fileId, mimeType, purpose, userId: user.id },
        objectInfo: {
          key: newStorageKey({
            purpose,
            userId: user.id,
            name: file.name,
          }),
          cacheControl:
            fileVisibilityForPurpose(purpose) === "public"
              ? "public, max-age=3600"
              : "private, no-store",
        },
      };
    },
    onAfterSignedUrl: async ({ file, metadata }) => {
      await recordStoredFile({
        id: metadata.fileId,
        provider: "s3",
        storageKey: file.objectKey,
        url: canonicalFileUrl(metadata.fileId),
        mimeType: metadata.mimeType,
        byteSize: file.size,
        purpose: metadata.purpose,
        userId: metadata.userId,
      });
      return { metadata: { fileId: metadata.fileId } };
    },
  });
}

function createS3UploadRouter(): Router {
  return {
    client: getS3Client(),
    bucketName: "unused-per-route",
    routes: Object.fromEntries(
      Object.entries(uploadPurposes).map(([name, purpose]) => [
        name,
        uploadRouteForPurpose(purpose),
      ]),
    ),
  };
}

let s3UploadRouter: Router | null = null;

function configuredS3UploadRouter() {
  if (!s3StorageConfigured()) return null;
  s3UploadRouter ??= createS3UploadRouter();
  return s3UploadRouter;
}

export const uploadRoutes = new Hono();

uploadRoutes.get("/upload/status", async (context) => {
  const session = await auth.api.getSession({ headers: context.req.raw.headers });
  let nodeSelected = false;
  let nodeOffline = false;
  if (session) {
    try {
      nodeSelected = Boolean(
        await selectedNodeObjectStorageProvider(session.user.id),
      );
    } catch {
      nodeSelected = true;
      nodeOffline = true;
    }
  }
  return context.json({
    enabled: nodeSelected || storageEnabled(),
    mode: nodeSelected ? "node" : storageDriver(),
    nodeOffline,
  });
});

uploadRoutes.post("/upload", async (context) => {
  const user = await uploadUser(context.req.raw).catch(() => null);
  if (user) {
    try {
      if (await selectedNodeObjectStorageProvider(user.id)) {
        return context.json(
          {
            error: {
              type: "rejected",
              message: "Use the relayed upload endpoint for Node storage",
            },
          },
          409,
        );
      }
    } catch {
      return context.json(
        {
          error: {
            type: "node-unavailable",
            message:
              "Reconnect your Avermate Node or change storage placement in Settings.",
          },
        },
        503,
      );
    }
  }
  if (storageDriver() !== "s3") {
    return context.json(
      { error: { type: "rejected", message: "Use the local upload endpoint" } },
      409,
    );
  }
  const router = configuredS3UploadRouter();
  if (!router || !storageEnabled()) {
    return context.json(
      {
        error: {
          type: "rejected",
          message: "Garage storage is not configured on this server",
        },
      },
      503,
    );
  }
  return handleRequest(context.req.raw, router);
});

uploadRoutes.post("/upload/local", async (context) => {
  let user;
  try {
    user = await uploadUser(context.req.raw);
  } catch (error) {
    return context.json(
      { error: error instanceof Error ? error.message : "Upload rejected" },
      401,
    );
  }
  let nodeSelected = false;
  try {
    nodeSelected = Boolean(await selectedNodeObjectStorageProvider(user.id));
  } catch {
    return context.json(
      {
        error: {
          code: "NODE_STORAGE_CAPABILITY_OFFLINE",
          message:
            "Reconnect your Avermate Node or change storage placement in Settings.",
          settingsPath: "/settings/node",
        },
      },
      503,
    );
  }
  if (!nodeSelected && (storageDriver() !== "local" || !storageEnabled())) {
    return context.json({ error: "Local uploads are not enabled" }, 409);
  }
  const declaredLength = Number(context.req.header("content-length") ?? 0);
  const largestUpload = Math.max(
    ...Object.values(FILE_CONSTRAINTS).map((constraint) => constraint.maxBytes),
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > largestUpload + 1024 * 1024
  ) {
    return context.json({ error: "The upload body is too large" }, 413);
  }
  const body = await context.req.formData();
  const routeName = body.get("route");
  const file = body.get("file");
  if (typeof routeName !== "string" || !(routeName in uploadPurposes)) {
    return context.json({ error: "Unknown upload route" }, 400);
  }
  if (!(file instanceof File)) {
    return context.json({ error: "A file is required" }, 400);
  }
  const purpose = uploadPurposes[routeName as BrowserUploadRoute];
  try {
    reserveUpload(user.id, purpose);
    const stored = await storeFile({ userId: user.id, purpose, file });
    return context.json({
      fileId: stored.id,
      objectKey: stored.storageKey,
      mimeType: stored.mimeType,
      byteSize: stored.byteSize,
    });
  } catch (error) {
    return context.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      400,
    );
  }
});

uploadRoutes.on(["GET", "HEAD"], "/files/:fileId", async (context) => {
  const [file] = await db
    .select()
    .from(files)
    .where(
      and(
        eq(files.id, context.req.param("fileId")),
        eq(files.status, "stored"),
      ),
    )
    .limit(1);
  if (!file) return context.json({ error: "File not found" }, 404);

  const session = await auth.api.getSession({
    headers: context.req.raw.headers,
  });
  const isPublicAvatar = file.purpose === "avatar";
  const isOwner = session?.user.id === file.userId;
  const isFeedbackAdmin =
    file.purpose === "feedback-attachment" &&
    Boolean(session && isAdmin(session.user));
  if (!isPublicAvatar && !isOwner && !isFeedbackAdmin) {
    return context.json({ error: "File not found" }, 404);
  }

  if (file.provider === "s3") {
    return context.redirect(
      await fileAccessUrl(file, { expiresIn: "5m" }),
      302,
    );
  }
  if (file.provider === "local") {
    const body = Bun.file(localObjectPath(file.storageKey));
    if (!(await body.exists())) {
      return context.json({ error: "File not found" }, 404);
    }
    const name = file.storageKey.split("/").at(-1) ?? "download";
    const commonHeaders = {
      "Content-Type": file.mimeType,
      "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(name)}`,
      "Cache-Control": isPublicAvatar
        ? "public, max-age=3600"
        : "private, no-store",
      "Accept-Ranges": "bytes",
    };
    if (context.req.method === "HEAD") {
      return new Response(null, {
        headers: { ...commonHeaders, "Content-Length": String(file.byteSize) },
      });
    }
    const range = context.req.header("range")?.match(/^bytes=(\d*)-(\d*)$/);
    if (range) {
      const requestedStart = range[1] ? Number(range[1]) : 0;
      const requestedEnd = range[2] ? Number(range[2]) : file.byteSize - 1;
      const start = Math.max(0, requestedStart);
      const end = Math.min(file.byteSize - 1, requestedEnd);
      if (
        !Number.isSafeInteger(start) ||
        !Number.isSafeInteger(end) ||
        start > end ||
        start >= file.byteSize
      ) {
        return new Response(null, {
          status: 416,
          headers: { "Content-Range": `bytes */${file.byteSize}` },
        });
      }
      return new Response(body.slice(start, end + 1), {
        status: 206,
        headers: {
          ...commonHeaders,
          "Content-Length": String(end - start + 1),
          "Content-Range": `bytes ${start}-${end}/${file.byteSize}`,
        },
      });
    }
    return new Response(body, {
      headers: {
        ...commonHeaders,
        "Content-Length": String(file.byteSize),
      },
    });
  }
  const nodeResponse = await nodeFileResponse(context.req.raw, file, {
    disposition: "inline",
    cacheControl: isPublicAvatar
      ? "public, max-age=3600"
      : "private, no-store",
  });
  if (nodeResponse) return nodeResponse;
  if (
    file.url !== canonicalFileUrl(file.id) &&
    /^https?:\/\//i.test(file.url)
  ) {
    return context.redirect(file.url, 302);
  }
  return context.json({ error: "File not found" }, 404);
});
