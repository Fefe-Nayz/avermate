import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import type { FilePurpose } from "../db/schema";
import { env, isProduction } from "./env";

export type ManagedStorageProvider = "local" | "s3";

function uploadsDisabled() {
  const runtime = process.env.DISABLE_UPLOADS;
  return env.DISABLE_UPLOADS || runtime === "true" || runtime === "1";
}

export function storageDriver(): ManagedStorageProvider {
  return env.STORAGE_DRIVER ?? (isProduction ? "s3" : "local");
}

export function s3StorageConfigured() {
  return Boolean(
    env.S3_ENDPOINT && env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY,
  );
}

export function storageBackendEnabled() {
  if (uploadsDisabled()) return false;
  return storageDriver() === "local" || s3StorageConfigured();
}

let sharedS3Client: S3Client | null = null;

export function getS3Client(): S3Client {
  if (!s3StorageConfigured()) {
    throw new Error(
      "Garage storage is not configured (S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required)",
    );
  }
  sharedS3Client ??= new S3Client({
    region: env.S3_REGION,
    endpoint: env.S3_ENDPOINT,
    forcePathStyle: true,
    // Garage rejects the optional empty-body CRC32 that recent AWS SDKs add
    // while presigning a PUT. Sign only checksums that are actually required.
    requestChecksumCalculation: "WHEN_REQUIRED",
    responseChecksumValidation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID!,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    },
  });
  return sharedS3Client;
}

export function fileVisibilityForPurpose(
  purpose: FilePurpose,
): "public" | "private" {
  return purpose === "avatar" ? "public" : "private";
}

export function bucketForPurpose(purpose: FilePurpose) {
  return fileVisibilityForPurpose(purpose) === "public"
    ? env.S3_BUCKET
    : env.S3_PRIVATE_BUCKET;
}

export function bucketForStorageKey(storageKey: string) {
  return storageKey.startsWith("public/")
    ? env.S3_BUCKET
    : env.S3_PRIVATE_BUCKET;
}

function sanitizedObjectName(name: string) {
  return (
    name
      .trim()
      .replace(/[^\p{L}\p{N}._-]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 160) || "upload"
  );
}

export function newStorageKey(input: {
  purpose: FilePurpose;
  userId: string;
  name: string;
}) {
  const visibility = fileVisibilityForPurpose(input.purpose);
  return `${visibility}/${input.purpose}/${input.userId}/${crypto.randomUUID()}/${sanitizedObjectName(input.name)}`;
}

function localStorageRoot() {
  const configured = env.LOCAL_UPLOAD_DIR ?? ".data/uploads";
  return resolve(process.cwd(), configured);
}

export function localObjectPath(storageKey: string) {
  const root = localStorageRoot();
  const target = resolve(root, ...storageKey.split("/"));
  const fromRoot = relative(root, target);
  if (
    fromRoot === "" ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new Error("Invalid local storage key");
  }
  return target;
}

export function canonicalFileUrl(fileId: string) {
  return `${env.BETTER_AUTH_URL.replace(/\/$/, "")}/api/files/${encodeURIComponent(fileId)}`;
}

export async function putStorageObject(input: {
  provider?: ManagedStorageProvider;
  storageKey: string;
  purpose: FilePurpose;
  file: File;
  mimeType: string;
}) {
  const provider = input.provider ?? storageDriver();
  if (provider === "local") {
    const path = localObjectPath(input.storageKey);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, new Uint8Array(await input.file.arrayBuffer()), {
      flag: "wx",
    });
    return;
  }
  await getS3Client().send(
    new PutObjectCommand({
      Bucket: bucketForPurpose(input.purpose),
      Key: input.storageKey,
      Body: new Uint8Array(await input.file.arrayBuffer()),
      ContentLength: input.file.size,
      ContentType: input.mimeType,
      CacheControl:
        fileVisibilityForPurpose(input.purpose) === "public"
          ? "public, max-age=3600"
          : "private, no-store",
    }),
  );
}

function throwIfStorageReadAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Storage object read aborted", "AbortError");
}

function enforceStorageReadLimit(byteSize: number, maxBytes?: number) {
  if (maxBytes !== undefined && byteSize > maxBytes) {
    throw new Error(`Stored object exceeds the ${maxBytes} byte read limit`);
  }
}

function exactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

/**
 * Read a managed object from inside the server without going through the
 * authenticated `/api/files/:id` browser route. Background jobs have no user
 * cookie, while provider credentials and local disk access already form the
 * trusted storage boundary.
 */
export async function readStorageObject(
  provider: ManagedStorageProvider,
  storageKey: string,
  options: { signal?: AbortSignal; maxBytes?: number } = {},
): Promise<ArrayBuffer> {
  throwIfStorageReadAborted(options.signal);
  if (provider === "local") {
    const path = localObjectPath(storageKey);
    const info = await stat(path);
    enforceStorageReadLimit(info.size, options.maxBytes);
    const bytes = await readFile(
      path,
      options.signal ? { signal: options.signal } : undefined,
    );
    throwIfStorageReadAborted(options.signal);
    enforceStorageReadLimit(bytes.byteLength, options.maxBytes);
    return exactArrayBuffer(bytes);
  }

  const object = await getS3Client().send(
    new GetObjectCommand({
      Bucket: bucketForStorageKey(storageKey),
      Key: storageKey,
    }),
    options.signal ? { abortSignal: options.signal } : undefined,
  );
  if (typeof object.ContentLength === "number") {
    enforceStorageReadLimit(object.ContentLength, options.maxBytes);
  }
  if (!object.Body) throw new Error("Stored object has no response body");
  const bytes = await object.Body.transformToByteArray();
  throwIfStorageReadAborted(options.signal);
  enforceStorageReadLimit(bytes.byteLength, options.maxBytes);
  return exactArrayBuffer(bytes);
}

export async function deleteStorageObject(
  provider: ManagedStorageProvider,
  storageKey: string,
) {
  if (provider === "local") {
    await rm(localObjectPath(storageKey), { force: true });
    return;
  }
  await getS3Client().send(
    new DeleteObjectCommand({
      Bucket: bucketForStorageKey(storageKey),
      Key: storageKey,
    }),
  );
}

export async function headStorageObject(
  provider: ManagedStorageProvider,
  storageKey: string,
) {
  if (provider === "local") {
    const info = await stat(localObjectPath(storageKey));
    return { byteSize: info.size, mimeType: null as string | null };
  }
  const info = await getS3Client().send(
    new HeadObjectCommand({
      Bucket: bucketForStorageKey(storageKey),
      Key: storageKey,
    }),
  );
  return {
    byteSize: Number(info.ContentLength ?? -1),
    mimeType: info.ContentType?.split(";", 1)[0]?.trim().toLowerCase() ?? null,
  };
}

export function signedStorageObjectUrl(
  storageKey: string,
  expiresInSeconds: number,
) {
  return getSignedUrl(
    getS3Client(),
    new GetObjectCommand({
      Bucket: bucketForStorageKey(storageKey),
      Key: storageKey,
    }),
    { expiresIn: expiresInSeconds },
  );
}
