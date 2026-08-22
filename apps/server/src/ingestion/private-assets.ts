import { createHash } from "node:crypto";
import type {
  CapturedAsset,
  ObjectStorageCommit,
  ObjectStorageProvider,
  OwnedObjectRef,
} from "@avermate/agent-contracts";
import sharp, { type Metadata } from "sharp";
import { newId } from "../lib/id";
import { AdvancedIngestionError } from "./errors";
import type {
  CapturedImageSet,
  ReferencedImageCandidate,
} from "./static-html";
import { PublicIngestionUrlPolicy } from "./url-policy";

const MAX_SOURCE_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_IMAGE_PIXELS = 40_000_000;
const MAX_SOURCE_IMAGE_EDGE = 8_192;
const MAX_CAPTURED_IMAGES = 64;

export interface PolicyEnforcedAssetFetcher {
  readonly enforcement: "revalidating-egress";
  fetch(input: {
    url: string;
    signal?: AbortSignal;
    maxBytes: number;
  }): Promise<Response>;
}

export interface CapturedAssetFileAdopter {
  adopt(input: {
    ownerId: string;
    sourceId: string;
    originalUrl: string;
    alt: string;
    commit: ObjectStorageCommit;
    width: number;
    height: number;
  }): Promise<{
    assetId: string;
    fileId: string;
    storagePlacement: "core" | "node";
  }>;
}

export interface AssetCaptureFailure {
  readonly sourceUrl: string;
  readonly reasonCode:
    | "blocked_destination"
    | "content_too_large"
    | "unsupported_content"
    | "internal_failure";
}

function bytesStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function boundedBytes(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_SOURCE_IMAGE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new AdvancedIngestionError(
      "content_too_large",
      "The source image exceeds the capture limit",
      false,
    );
  }
  if (!response.body) {
    throw new AdvancedIngestionError(
      "unsupported_content",
      "The source image response is empty",
      false,
    );
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > MAX_SOURCE_IMAGE_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw new AdvancedIngestionError(
        "content_too_large",
        "The source image exceeds the capture limit",
        false,
      );
    }
    chunks.push(next.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function supportedImageMagic(bytes: Uint8Array) {
  const starts = (...signature: number[]) =>
    signature.every((byte, index) => bytes[index] === byte);
  return (
    starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a) ||
    starts(0xff, 0xd8, 0xff) ||
    (bytes.length >= 12 &&
      new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
      new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP")
  );
}

async function safeWebp(bytes: Uint8Array) {
  if (!supportedImageMagic(bytes)) {
    throw new AdvancedIngestionError(
      "unsupported_content",
      "The source asset is not a supported image",
      false,
    );
  }
  let metadata: Metadata;
  try {
    metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
      sequentialRead: true,
    }).metadata();
  } catch (error) {
    throw new AdvancedIngestionError(
      "unsupported_content",
      "The source image could not be decoded safely",
      false,
      { cause: error },
    );
  }
  const width = metadata.width ?? 0;
  const height = metadata.height ?? 0;
  if (
    width < 1 ||
    height < 1 ||
    width > MAX_SOURCE_IMAGE_EDGE ||
    height > MAX_SOURCE_IMAGE_EDGE ||
    width * height > MAX_SOURCE_IMAGE_PIXELS
  ) {
    throw new AdvancedIngestionError(
      "content_too_large",
      "The decoded source image exceeds the dimension limit",
      false,
    );
  }
  const encoded = await sharp(bytes, {
    failOn: "error",
    limitInputPixels: MAX_SOURCE_IMAGE_PIXELS,
    sequentialRead: true,
  })
    .rotate()
    .webp({ quality: 88, effort: 4 })
    .toBuffer();
  if (encoded.byteLength > MAX_SOURCE_IMAGE_BYTES) {
    throw new AdvancedIngestionError(
      "content_too_large",
      "The normalized source image exceeds the storage limit",
      false,
    );
  }
  return { bytes: new Uint8Array(encoded), width, height };
}

function reasonForFailure(error: unknown): AssetCaptureFailure["reasonCode"] {
  if (error instanceof AdvancedIngestionError) {
    if (
      error.reasonCode === "blocked_destination" ||
      error.reasonCode === "content_too_large" ||
      error.reasonCode === "unsupported_content"
    ) {
      return error.reasonCode;
    }
  }
  return "internal_failure";
}

/**
 * Captures article images into the selected ObjectStorageProvider. There is no
 * native `fetch` fallback: the injected transport must attest runtime-level
 * DNS/IP/redirect enforcement, otherwise asset capture fails closed.
 */
export class PrivateSourceAssetCaptureService {
  constructor(
    private readonly dependencies: {
      ownerId: string;
      storage: ObjectStorageProvider;
      adopter: CapturedAssetFileAdopter;
      fetcher: PolicyEnforcedAssetFetcher;
      urlPolicy: PublicIngestionUrlPolicy;
    },
  ) {
    if (dependencies.fetcher.enforcement !== "revalidating-egress") {
      throw new Error("Asset fetching requires a revalidating egress boundary");
    }
  }

  async capture(input: {
    sourceId: string;
    finalUrl: string;
    candidates: readonly ReferencedImageCandidate[];
    signal?: AbortSignal;
  }): Promise<
    CapturedImageSet & { readonly failures: readonly AssetCaptureFailure[] }
  > {
    const unique = new Map(
      input.candidates
        .slice(0, MAX_CAPTURED_IMAGES)
        .map((candidate) => [candidate.sourceUrl, candidate] as const),
    );
    const assets: CapturedAsset[] = [];
    const failures: AssetCaptureFailure[] = [];
    const assetHrefBySourceUrl = new Map<string, string>();
    for (const candidate of unique.values()) {
      try {
        const validated = await this.dependencies.urlPolicy.validate(
          candidate.sourceUrl,
          "subresource",
          input.signal,
        );
        const response = await this.dependencies.fetcher.fetch({
          url: validated.url,
          signal: input.signal,
          maxBytes: MAX_SOURCE_IMAGE_BYTES,
        });
        if (!response.ok) {
          await response.body?.cancel().catch(() => undefined);
          throw new AdvancedIngestionError(
            response.status === 401 || response.status === 403
              ? "blocked_destination"
              : "internal_failure",
            "The source image could not be fetched",
            response.status >= 500 || response.status === 429,
          );
        }
        const normalized = await safeWebp(await boundedBytes(response));
        const digest = createHash("sha256")
          .update(normalized.bytes)
          .digest("hex");
        const ref: OwnedObjectRef = {
          ownerId: this.dependencies.ownerId,
          namespace: "source-assets",
          key: `${input.sourceId}/${digest}.webp`,
        };
        const capabilities = await this.dependencies.storage.capabilities();
        if (normalized.bytes.byteLength > capabilities.maxObjectBytes) {
          throw new AdvancedIngestionError(
            "content_too_large",
            "The selected storage provider cannot accept this source image",
            false,
          );
        }
        const commit = await this.dependencies.storage.put({
          ref,
          body: bytesStream(normalized.bytes),
          byteSize: normalized.bytes.byteLength,
          mimeType: "image/webp",
          expectedDigest: `sha256:${digest}`,
          idempotencyKey: `source-asset:${input.sourceId}:${digest}`,
        });
        const adopted = await this.dependencies.adopter.adopt({
          ownerId: this.dependencies.ownerId,
          sourceId: input.sourceId,
          originalUrl: validated.url,
          alt: candidate.alt,
          commit,
          width: normalized.width,
          height: normalized.height,
        });
        const asset = Object.freeze({
          assetId: adopted.assetId || newId("sasset"),
          fileId: adopted.fileId,
          originalUrl: validated.url,
          mimeType: "image/webp" as const,
          width: normalized.width,
          height: normalized.height,
          byteSize: normalized.bytes.byteLength,
          digest,
          attribution: candidate.alt || null,
          storagePlacement: adopted.storagePlacement,
          captureState: "stored" as const,
        });
        assets.push(asset);
        assetHrefBySourceUrl.set(candidate.sourceUrl, `asset://${asset.assetId}`);
      } catch (error) {
        failures.push(
          Object.freeze({
            sourceUrl: candidate.sourceUrl,
            reasonCode: reasonForFailure(error),
          }),
        );
      }
    }
    return Object.freeze({
      assets: Object.freeze(assets),
      failures: Object.freeze(failures),
      assetHrefBySourceUrl,
    });
  }
}
