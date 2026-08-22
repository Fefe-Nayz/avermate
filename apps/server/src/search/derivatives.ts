import { createHash } from "node:crypto";
import { z } from "zod";
import { sourceLocatorV1Schema } from "@avermate/agent-contracts";
import sharp from "sharp";
import { getDocumentProxy } from "unpdf";
import { db } from "../db";
import { newId } from "../lib/id";
import { readOwnedFileBytes } from "../lib/owned-file-storage";
import { canonicalJson, jsonValue, sha256 } from "./values";

const derivativeInputSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  versionId: z.string().min(1).max(256),
  chunkId: z.string().min(1).max(256),
  fileId: z.string().min(1).max(256),
  kind: z.enum([
    "pdf-page",
    "page-image",
    "slide-image",
    "sheet-image",
    "audio-segment",
    "video-segment",
  ]),
  locator: sourceLocatorV1Schema,
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  mimeType: z.string().min(1).max(256),
  byteSize: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024),
  estimatedInputTokens: z.number().int().min(1).max(8192),
  durationMs: z.number().int().positive().max(180_000).nullable(),
  rendererProfile: z.string().min(1).max(256),
  rendererImageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  metadata: z.record(z.string(), z.unknown()),
});
export type RegisterContentDerivativeInput = z.infer<
  typeof derivativeInputSchema
>;

function validateLocator(input: RegisterContentDerivativeInput) {
  if (
    input.kind === "pdf-page" &&
    (input.locator.kind !== "pdf" || input.mimeType !== "application/pdf")
  ) {
    throw new Error("DERIVATIVE_PDF_PAGE_LOCATOR_MISMATCH");
  }
  if (
    input.kind === "page-image" &&
    (!(
      input.locator.kind === "pdf" ||
      (input.locator.kind === "text" && input.metadata.originalImage === true)
    ) ||
      !["image/png", "image/jpeg"].includes(input.mimeType))
  ) {
    throw new Error("DERIVATIVE_PAGE_IMAGE_LOCATOR_MISMATCH");
  }
  if (
    input.kind === "slide-image" &&
    (input.locator.kind !== "slides" ||
      !["image/png", "image/jpeg"].includes(input.mimeType))
  ) {
    throw new Error("DERIVATIVE_SLIDE_IMAGE_LOCATOR_MISMATCH");
  }
  if (
    input.kind === "sheet-image" &&
    (input.locator.kind !== "spreadsheet" ||
      !["image/png", "image/jpeg"].includes(input.mimeType))
  ) {
    throw new Error("DERIVATIVE_SHEET_IMAGE_LOCATOR_MISMATCH");
  }
  if (input.kind === "audio-segment") {
    if (
      input.locator.kind !== "audio" ||
      !input.durationMs ||
      input.locator.endMs - input.locator.startMs !== input.durationMs ||
      !["audio/mpeg", "audio/wav", "audio/x-wav"].includes(input.mimeType)
    ) {
      throw new Error("DERIVATIVE_AUDIO_LOCATOR_MISMATCH");
    }
  } else if (input.kind === "video-segment") {
    if (
      input.locator.kind !== "video" ||
      !input.durationMs ||
      input.durationMs > 120_000 ||
      input.locator.endMs - input.locator.startMs !== input.durationMs ||
      !["video/mp4", "video/quicktime"].includes(input.mimeType)
    ) {
      throw new Error("DERIVATIVE_VIDEO_LOCATOR_MISMATCH");
    }
  } else if (input.durationMs !== null) {
    throw new Error("DERIVATIVE_UNEXPECTED_DURATION");
  }
  if (input.locator.kind === "pdf") {
    const page = Number(input.metadata.originalPage);
    const rotation = Number(input.metadata.rotationDegrees);
    const width = Number(input.metadata.widthPoints);
    const height = Number(input.metadata.heightPoints);
    if (
      page !== input.locator.page ||
      ![0, 90, 180, 270].includes(rotation) ||
      !Number.isFinite(width) ||
      width <= 0 ||
      !Number.isFinite(height) ||
      height <= 0
    ) {
      throw new Error("DERIVATIVE_PDF_GEOMETRY_METADATA_REQUIRED");
    }
  }
}

async function validateBytes(
  input: RegisterContentDerivativeInput,
  bytes: Uint8Array,
) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (bytes.byteLength !== input.byteSize || digest !== input.contentHash) {
    throw new Error("DERIVATIVE_FILE_DIGEST_MISMATCH");
  }
  if (input.kind === "pdf-page") {
    const pdf = await getDocumentProxy(bytes, {
      maxImageSize: 16_777_216,
      stopAtErrors: false,
    });
    try {
      if (pdf.numPages !== 1) throw new Error("DERIVATIVE_PDF_NOT_ONE_PAGE");
    } finally {
      await pdf.cleanup().catch(() => undefined);
    }
  }
  if (["page-image", "slide-image", "sheet-image"].includes(input.kind)) {
    const metadata = await sharp(bytes, {
      limitInputPixels: 16_777_216,
    }).metadata();
    const pixels = Number(metadata.width ?? 0) * Number(metadata.height ?? 0);
    if (!pixels || pixels > 16_777_216) {
      throw new Error("DERIVATIVE_IMAGE_PIXEL_LIMIT");
    }
  }
}

/** Internal attested-worker boundary; this is deliberately not an oRPC mutation. */
export async function registerContentDerivative(
  raw: unknown,
  options: { readFile?: typeof readOwnedFileBytes } = {},
) {
  const input = derivativeInputSchema.parse(raw);
  validateLocator(input);
  const ownership = await db.$client.execute({
    sql: `SELECT files.id, files.userId, files.provider, files.storageKey,
        files.mimeType, files.byteSize, files.status
      FROM content_versions AS versions
      JOIN content_sources AS sources ON sources.id = versions.sourceId
      JOIN content_chunks AS chunks ON chunks.versionId = versions.id
      JOIN files ON files.id = ? AND files.userId = sources.userId
      WHERE versions.id = ? AND chunks.id = ? AND sources.userId = ?
      LIMIT 1`,
    args: [input.fileId, input.versionId, input.chunkId, input.ownerId],
  });
  const file = ownership.rows[0];
  if (
    !file ||
    file.status !== "stored" ||
    file.mimeType !== input.mimeType ||
    Number(file.byteSize) !== input.byteSize
  ) {
    throw new Error("DERIVATIVE_OWNED_FILE_UNAVAILABLE");
  }
  const bytes = new Uint8Array(
    await (options.readFile ?? readOwnedFileBytes)(
      input.ownerId,
      {
        id: String(file.id),
        userId: String(file.userId),
        provider: String(file.provider),
        storageKey: String(file.storageKey),
        mimeType: String(file.mimeType),
        byteSize: Number(file.byteSize),
        status: "stored",
      },
      { maxBytes: input.byteSize },
    ),
  );
  await validateBytes(input, bytes);
  const locatorJson = canonicalJson(input.locator);
  const immutableDigest = sha256(
    canonicalJson({
      versionId: input.versionId,
      chunkId: input.chunkId,
      kind: input.kind,
      locator: input.locator,
      contentHash: input.contentHash,
      rendererProfile: input.rendererProfile,
      rendererImageDigest: input.rendererImageDigest,
    }),
  );
  const existing = await db.$client.execute({
    sql: `SELECT derivatives.*, files.status AS existingFileStatus
      FROM content_derivatives AS derivatives
      LEFT JOIN files ON files.id = derivatives.fileId
      WHERE derivatives.versionId = ? AND derivatives.kind = ?
        AND derivatives.locatorJson = ? LIMIT 1`,
    args: [input.versionId, input.kind, locatorJson],
  });
  if (existing.rows[0]) {
    const metadata = jsonValue<Record<string, unknown>>(
      existing.rows[0].metadataJson,
    );
    if (metadata.immutableDigest !== immutableDigest) {
      throw new Error("DERIVATIVE_IMMUTABLE_IDENTITY_CONFLICT");
    }
    if (
      existing.rows[0].status === "deleted" ||
      existing.rows[0].existingFileStatus !== "stored"
    ) {
      const repaired = await db.$client.execute({
        sql: `UPDATE content_derivatives SET fileId = ?, status = 'ready',
            contentHash = ?, mimeType = ?, byteSize = ?,
            estimatedInputTokens = ?, durationMs = ?, rendererProfile = ?,
            rendererImageDigest = ?, metadataJson = ?, errorCode = NULL,
            updatedAt = ? WHERE id = ? AND (status = 'deleted' OR fileId IN (
              SELECT id FROM files WHERE status != 'stored'
            ))`,
        args: [
          input.fileId,
          input.contentHash,
          input.mimeType,
          input.byteSize,
          input.estimatedInputTokens,
          input.durationMs,
          input.rendererProfile,
          input.rendererImageDigest,
          canonicalJson({ ...input.metadata, immutableDigest }),
          Math.floor(Date.now() / 1_000),
          existing.rows[0].id,
        ],
      });
      if (Number(repaired.rowsAffected) !== 1) {
        throw new Error("DERIVATIVE_REPAIR_CONFLICT");
      }
      return {
        id: String(existing.rows[0].id),
        fileId: input.fileId,
        reused: true as const,
      };
    }
    return {
      id: String(existing.rows[0].id),
      fileId: String(existing.rows[0].fileId),
      reused: true as const,
    };
  }
  const id = newId("cder");
  const now = Math.floor(Date.now() / 1_000);
  await db.$client.execute({
    sql: `INSERT INTO content_derivatives (
        id, versionId, chunkId, fileId, kind, status,
        locatorSchemaVersion, locatorJson, contentHash, mimeType, byteSize,
        estimatedInputTokens, durationMs, rendererProfile,
        rendererImageDigest, metadataJson, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, 'ready', 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.versionId,
      input.chunkId,
      input.fileId,
      input.kind,
      locatorJson,
      input.contentHash,
      input.mimeType,
      input.byteSize,
      input.estimatedInputTokens,
      input.durationMs,
      input.rendererProfile,
      input.rendererImageDigest,
      canonicalJson({ ...input.metadata, immutableDigest }),
      now,
      now,
    ],
  });
  return { id, fileId: input.fileId, reused: false as const };
}

export async function tombstoneOwnedContentDerivatives(input: {
  ownerId: string;
  versionIds: readonly string[];
}) {
  const versionIds = [...new Set(input.versionIds)].slice(0, 1_000);
  if (versionIds.length === 0) return { tombstoned: 0 };
  const result = await db.$client.execute({
    sql: `UPDATE content_derivatives SET status = 'deleted', updatedAt = ?
      WHERE status != 'deleted' AND versionId IN (
        SELECT versions.id FROM content_versions AS versions
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE sources.userId = ?
          AND versions.id IN (${versionIds.map(() => "?").join(", ")})
      )`,
    args: [Math.floor(Date.now() / 1_000), input.ownerId, ...versionIds],
  });
  return { tombstoned: Number(result.rowsAffected) };
}
