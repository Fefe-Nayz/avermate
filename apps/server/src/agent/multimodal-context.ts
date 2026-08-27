import { createHash } from "node:crypto";
import {
  contextAssetHandleSchema,
  contextBlockSchema,
  type ContextAssetHandle,
  type ContextBlock,
  type ContextPart,
  type ModelDescriptor,
  type ModelRequest,
  type SourceLocatorV1,
} from "@avermate/agent-contracts";
import type { ModelMessage, UserContent } from "ai";
import sharp from "sharp";
import { getDocumentProxy } from "unpdf";
import { z } from "zod";
import {
  readOwnedFileBytes,
  type OwnedStoredFile,
} from "../lib/owned-file-storage";

export type ContextMediaBudgets = {
  maximumParts: number;
  maximumBytesPerPart: number;
  maximumTotalBytes: number;
  maximumPixelsPerImage: number;
};

export const DEFAULT_CONTEXT_MEDIA_BUDGETS: Readonly<ContextMediaBudgets> = Object.freeze({
  maximumParts: 12,
  maximumBytesPerPart: 10 * 1024 * 1024,
  maximumTotalBytes: 24 * 1024 * 1024,
  maximumPixelsPerImage: 16_777_216,
});

export type ResolvedContextAsset = {
  ownerId: string;
  assetId: string;
  mime: string;
  byteSize: number;
  bytes: Uint8Array;
};

export interface ContextAssetResolver {
  /**
   * Resolve on the same trusted server/Node that owns the selected gateway.
   * Implementations must authorize the current owner again; callers still
   * verify the returned owner and immutable media metadata below.
   */
  resolve(input: {
    ownerId: string;
    assetHandle: ContextAssetHandle;
    maximumBytes: number;
    signal?: AbortSignal;
  }): Promise<ResolvedContextAsset>;
}

export type PreparedContextCitation = {
  blockId: string;
  partIndex: number;
  sourceRef: string | null;
  chunkId: string | null;
  page: number | null;
  locator: SourceLocatorV1;
  digest: string;
  delivery: "text" | "media" | "text-fallback";
};

export type ContextMediaFallback = {
  blockId: string;
  partIndex: number;
  mediaType: "image" | "pdf-page";
  reason: "model-image-unsupported" | "model-file-unsupported";
};

export type PreparedModelPrompt = {
  system: string;
  messages: ModelMessage[];
  citations: PreparedContextCitation[];
  fallbacks: ContextMediaFallback[];
  mediaUsage: { parts: number; bytes: number; pixels: number };
};

export type PrepareModelPromptInput = {
  request: ModelRequest;
  descriptor: ModelDescriptor;
  assetResolver?: ContextAssetResolver;
  mediaBudgets?: Partial<ContextMediaBudgets>;
};

export type ContextMediaErrorCode =
  | "CONTEXT_MEDIA_BUDGET_INVALID"
  | "CONTEXT_MEDIA_PART_LIMIT"
  | "CONTEXT_MEDIA_BYTE_LIMIT"
  | "CONTEXT_MEDIA_PIXEL_LIMIT"
  | "CONTEXT_MEDIA_IN_SYSTEM_POLICY"
  | "CONTEXT_ASSET_RESOLVER_UNAVAILABLE"
  | "CONTEXT_ASSET_RESOLUTION_FAILED"
  | "CONTEXT_ASSET_OWNER_MISMATCH"
  | "CONTEXT_ASSET_METADATA_MISMATCH"
  | "CONTEXT_ASSET_DIGEST_MISMATCH"
  | "CONTEXT_ASSET_UNSAFE_BYTES";

/** Stable, non-provider-specific failure suitable for fail-closed callers. */
export class ContextMediaError extends Error {
  constructor(readonly code: ContextMediaErrorCode) {
    super(code);
    this.name = "ContextMediaError";
  }
}

const handlePayloadSchema = z.strictObject({
  version: z.literal(1),
  ownerId: z.string().min(1).max(256),
  assetId: z.string().min(1).max(256),
  nonce: z.string().uuid(),
});

const handleAad = new TextEncoder().encode("avermate:context-asset-handle:v1");
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

function base64Url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64Url(value: string) {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error("invalid");
  return new Uint8Array(Buffer.from(value, "base64url"));
}

/**
 * Durable opaque handle for a DB-backed asset. It grants no access by itself:
 * the resolver below always reloads the row for the current owner and status.
 */
export class ContextAssetHandleService {
  readonly #key: Promise<CryptoKey>;

  constructor(secret: string) {
    if (encoder.encode(secret).byteLength < 32) {
      throw new Error("The context-asset secret must contain at least 32 bytes");
    }
    this.#key = crypto.subtle
      .digest("SHA-256", encoder.encode(`context-asset\0${secret}`))
      .then((digest) =>
        crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, [
          "encrypt",
          "decrypt",
        ]),
      );
  }

  async mint(input: { ownerId: string; assetId: string }) {
    const payload = handlePayloadSchema.parse({
      version: 1,
      ownerId: input.ownerId,
      assetId: input.assetId,
      nonce: crypto.randomUUID(),
    });
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: handleAad, tagLength: 128 },
        await this.#key,
        encoder.encode(JSON.stringify(payload)),
      ),
    );
    const packed = new Uint8Array(iv.byteLength + encrypted.byteLength);
    packed.set(iv);
    packed.set(encrypted, iv.byteLength);
    return contextAssetHandleSchema.parse(`cah1.${base64Url(packed)}`);
  }

  async resolve(input: { ownerId: string; assetHandle: ContextAssetHandle }) {
    try {
      const handle = contextAssetHandleSchema.parse(input.assetHandle);
      const packed = fromBase64Url(handle.slice(5));
      if (packed.byteLength < 30) throw new Error("invalid");
      const cleartext = await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv: packed.slice(0, 12),
          additionalData: handleAad,
          tagLength: 128,
        },
        await this.#key,
        packed.slice(12),
      );
      const payload = handlePayloadSchema.parse(
        JSON.parse(decoder.decode(new Uint8Array(cleartext))),
      );
      if (payload.ownerId !== input.ownerId) {
        throw new ContextMediaError("CONTEXT_ASSET_OWNER_MISMATCH");
      }
      return { ownerId: payload.ownerId, assetId: payload.assetId };
    } catch (error) {
      if (error instanceof ContextMediaError) throw error;
      throw new ContextMediaError("CONTEXT_ASSET_RESOLUTION_FAILED");
    }
  }
}

export type OwnedFileContextAssetResolverOptions = {
  handles: ContextAssetHandleService;
  loadOwnedFile(
    ownerId: string,
    assetId: string,
  ): Promise<OwnedStoredFile | null>;
  readOwnedFile?: typeof readOwnedFileBytes;
};

/** Production-capable adapter for Core or a paired Node's owned file store. */
export class OwnedFileContextAssetResolver implements ContextAssetResolver {
  constructor(private readonly options: OwnedFileContextAssetResolverOptions) {}

  async resolve(input: Parameters<ContextAssetResolver["resolve"]>[0]) {
    const identity = await this.options.handles.resolve({
      ownerId: input.ownerId,
      assetHandle: input.assetHandle,
    });
    const file = await this.options.loadOwnedFile(
      input.ownerId,
      identity.assetId,
    );
    if (!file || file.userId !== input.ownerId || file.status !== "stored") {
      throw new ContextMediaError("CONTEXT_ASSET_RESOLUTION_FAILED");
    }
    if (file.byteSize > input.maximumBytes) {
      throw new ContextMediaError("CONTEXT_MEDIA_BYTE_LIMIT");
    }
    try {
      const bytes = new Uint8Array(
        await (this.options.readOwnedFile ?? readOwnedFileBytes)(
          input.ownerId,
          file,
          { signal: input.signal, maxBytes: input.maximumBytes },
        ),
      );
      return {
        ownerId: file.userId,
        assetId: identity.assetId,
        mime: file.mimeType.toLowerCase(),
        byteSize: file.byteSize,
        bytes,
      };
    } catch (error) {
      if (error instanceof ContextMediaError) throw error;
      // Storage/provider details must never become model input or API output.
      throw new ContextMediaError("CONTEXT_ASSET_RESOLUTION_FAILED");
    }
  }
}

function budgets(input?: Partial<ContextMediaBudgets>): ContextMediaBudgets {
  const value = { ...DEFAULT_CONTEXT_MEDIA_BUDGETS, ...input };
  if (
    !Object.values(value).every(
      (item) => Number.isSafeInteger(item) && item > 0,
    ) ||
    value.maximumBytesPerPart > value.maximumTotalBytes
  ) {
    throw new ContextMediaError("CONTEXT_MEDIA_BUDGET_INVALID");
  }
  return value;
}

function throwIfAborted(signal?: AbortSignal) {
  if (!signal?.aborted) return;
  throw signal.reason instanceof Error
    ? signal.reason
    : new DOMException("Model context preparation aborted", "AbortError");
}

function digest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function hasMagicBytes(bytes: Uint8Array, mime: string) {
  if (mime === "image/png") {
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (value, index) => bytes[index] === value,
    );
  }
  if (mime === "image/jpeg") {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mime === "image/webp") {
    return (
      Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" &&
      Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP"
    );
  }
  if (mime === "application/pdf") {
    return Buffer.from(bytes.subarray(0, 5)).toString("ascii") === "%PDF-";
  }
  return false;
}

function page(locator: SourceLocatorV1) {
  return locator.kind === "pdf" ? locator.page : null;
}

function parts(block: ContextBlock): readonly ContextPart[] | null {
  return block.parts ?? null;
}

async function validateImage(bytes: Uint8Array, maximumPixels: number) {
  try {
    const metadata = await sharp(bytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: maximumPixels,
    }).metadata();
    const pixels = Number(metadata.width ?? 0) * Number(metadata.height ?? 0);
    if (!pixels || pixels > maximumPixels) {
      throw new ContextMediaError("CONTEXT_MEDIA_PIXEL_LIMIT");
    }
    return pixels;
  } catch (error) {
    if (error instanceof ContextMediaError) throw error;
    if (
      error instanceof Error &&
      /pixel limit|exceeds pixel/i.test(error.message)
    ) {
      throw new ContextMediaError("CONTEXT_MEDIA_PIXEL_LIMIT");
    }
    throw new ContextMediaError("CONTEXT_ASSET_UNSAFE_BYTES");
  }
}

async function validateOnePagePdf(
  bytes: Uint8Array,
  maximumPixelsPerImage: number,
) {
  try {
    const document = await getDocumentProxy(bytes, {
      maxImageSize: maximumPixelsPerImage,
      stopAtErrors: true,
    });
    try {
      if (document.numPages !== 1) {
        throw new ContextMediaError("CONTEXT_ASSET_UNSAFE_BYTES");
      }
    } finally {
      await document.cleanup().catch(() => undefined);
    }
  } catch (error) {
    if (error instanceof ContextMediaError) throw error;
    throw new ContextMediaError("CONTEXT_ASSET_UNSAFE_BYTES");
  }
}

function citation(
  block: ContextBlock,
  part: ContextPart,
  partIndex: number,
  delivery: PreparedContextCitation["delivery"],
): PreparedContextCitation | null {
  if (!part.evidence.locator || !part.evidence.digest) return null;
  return {
    blockId: block.id,
    partIndex,
    sourceRef: block.sourceRef,
    chunkId: part.evidence.chunkId,
    page: page(part.evidence.locator),
    locator: part.evidence.locator,
    digest: part.evidence.digest,
    delivery,
  };
}

function fallbackPart(part: Extract<ContextPart, { type: "image" | "pdf-page" }>) {
  return {
    type: "text" as const,
    text: `[${part.type} OCR/text fallback; mime=${part.mime}]\n${part.fallbackText}`,
  };
}

/**
 * Resolve a provider-neutral ModelRequest into an AI SDK prompt. This is the
 * integration point for AssistantRunService: construct `ContextBlock.parts`,
 * then let the selected server-side gateway call this function immediately
 * before provider dispatch.
 */
export async function prepareModelPrompt(
  input: PrepareModelPromptInput,
): Promise<PreparedModelPrompt> {
  const mediaBudgets = budgets(input.mediaBudgets);
  const blocks = input.request.messages.map((block) =>
    contextBlockSchema.parse(block),
  );
  const mediaPartCount = blocks.reduce(
    (count, block) =>
      count +
      (parts(block)?.filter((part) => part.type !== "text").length ?? 0),
    0,
  );
  if (mediaPartCount > mediaBudgets.maximumParts) {
    throw new ContextMediaError("CONTEXT_MEDIA_PART_LIMIT");
  }

  const system: string[] = [];
  const messages: ModelMessage[] = [];
  const citations: PreparedContextCitation[] = [];
  const fallbacks: ContextMediaFallback[] = [];
  const mediaUsage = { parts: 0, bytes: 0, pixels: 0 };

  for (const block of blocks) {
    throwIfAborted(input.request.abortSignal);
    const structured = parts(block);
    if (block.trust === "system-policy") {
      if (structured?.some((part) => part.type !== "text")) {
        throw new ContextMediaError("CONTEXT_MEDIA_IN_SYSTEM_POLICY");
      }
      system.push(
        structured
          ? structured.map((part) => (part.type === "text" ? part.text : "")).join("\n\n")
          : block.content,
      );
      continue;
    }
    if (!structured) {
      messages.push({
        role: "user",
        content: `[trust=${block.trust}]\n${block.content}`,
      });
      continue;
    }

    const content: UserContent = [
      { type: "text", text: `[trust=${block.trust}]` },
    ];
    for (let partIndex = 0; partIndex < structured.length; partIndex += 1) {
      const part = structured[partIndex]!;
      if (part.type === "text") {
        content.push({ type: "text", text: part.text });
        const binding = citation(block, part, partIndex, "text");
        if (binding) citations.push(binding);
        continue;
      }

      const supported =
        part.type === "image"
          ? input.descriptor.modalities.includes("image")
          : input.descriptor.modalities.includes("file");
      if (!supported) {
        content.push(fallbackPart(part));
        fallbacks.push({
          blockId: block.id,
          partIndex,
          mediaType: part.type,
          reason:
            part.type === "image"
              ? "model-image-unsupported"
              : "model-file-unsupported",
        });
        const binding = citation(block, part, partIndex, "text-fallback");
        if (binding) citations.push(binding);
        continue;
      }
      if (!input.assetResolver) {
        throw new ContextMediaError("CONTEXT_ASSET_RESOLVER_UNAVAILABLE");
      }

      let resolved: ResolvedContextAsset;
      try {
        resolved = await input.assetResolver.resolve({
          ownerId: input.request.ownerId,
          assetHandle: part.assetHandle,
          maximumBytes: mediaBudgets.maximumBytesPerPart,
          signal: input.request.abortSignal,
        });
      } catch (error) {
        if (error instanceof ContextMediaError) throw error;
        throw new ContextMediaError("CONTEXT_ASSET_RESOLUTION_FAILED");
      }
      throwIfAborted(input.request.abortSignal);
      if (resolved.ownerId !== input.request.ownerId) {
        throw new ContextMediaError("CONTEXT_ASSET_OWNER_MISMATCH");
      }
      if (
        resolved.mime.toLowerCase() !== part.mime ||
        resolved.byteSize !== resolved.bytes.byteLength
      ) {
        throw new ContextMediaError("CONTEXT_ASSET_METADATA_MISMATCH");
      }
      if (
        resolved.byteSize <= 0 ||
        resolved.byteSize > mediaBudgets.maximumBytesPerPart ||
        mediaUsage.bytes + resolved.byteSize > mediaBudgets.maximumTotalBytes
      ) {
        throw new ContextMediaError("CONTEXT_MEDIA_BYTE_LIMIT");
      }
      // Keep the exact immutable copy that passed all checks; provider adapters
      // never receive a resolver-owned buffer that could later be mutated.
      const verifiedBytes = new Uint8Array(resolved.bytes);
      if (digest(verifiedBytes) !== part.evidence.digest) {
        throw new ContextMediaError("CONTEXT_ASSET_DIGEST_MISMATCH");
      }
      if (!hasMagicBytes(verifiedBytes, part.mime)) {
        throw new ContextMediaError("CONTEXT_ASSET_UNSAFE_BYTES");
      }

      let pixels = 0;
      if (part.type === "image") {
        pixels = await validateImage(
          verifiedBytes,
          mediaBudgets.maximumPixelsPerImage,
        );
        content.push({
          type: "image",
          image: verifiedBytes,
          mediaType: part.mime,
        });
      } else {
        await validateOnePagePdf(
          new Uint8Array(verifiedBytes),
          mediaBudgets.maximumPixelsPerImage,
        );
        content.push({
          type: "file",
          data: verifiedBytes,
          mediaType: part.mime,
          filename: `page-${page(part.evidence.locator) ?? "unknown"}.pdf`,
        });
      }
      mediaUsage.parts += 1;
      mediaUsage.bytes += resolved.byteSize;
      mediaUsage.pixels += pixels;
      const binding = citation(block, part, partIndex, "media");
      if (binding) citations.push(binding);
    }
    messages.push({ role: "user", content });
  }

  return {
    system: system.filter(Boolean).join("\n\n"),
    messages,
    citations,
    fallbacks,
    mediaUsage,
  };
}
