import { createHash } from "node:crypto";
import type {
  EmbeddingProvider,
  EmbeddingRequestContext,
  EmbeddingSpaceDescriptor,
  EmbeddingVector,
  MediaEmbeddingInput,
  TextEmbeddingInput,
} from "@avermate/agent-contracts";
import sharp from "sharp";
import { getDocumentProxy } from "unpdf";
import { safeModelFetchResponse } from "../agent/model-endpoint-policy";
import {
  boundedProviderJson,
  providerSignal,
  redactedProviderHttpError,
  type ProviderFetcher,
  utf8Bytes,
} from "./provider-transport";
import { canonicalJson, sha256 } from "./values";

export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-2";
export const GEMINI_EMBEDDING_ORIGIN =
  "https://generativelanguage.googleapis.com";
export const GEMINI_EMBEDDING_DISCLOSURE_REVISION =
  "gemini-embedding-school-content/3";

const MODEL_RESOURCE = `models/${GEMINI_EMBEDDING_MODEL}`;
const BATCH_ENDPOINT = `${GEMINI_EMBEDDING_ORIGIN}/v1beta/${MODEL_RESOURCE}:batchEmbedContents`;
const SINGLE_ENDPOINT = `${GEMINI_EMBEDDING_ORIGIN}/v1beta/${MODEL_RESOURCE}:embedContent`;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_TEXT_BYTES = 32 * 1024;
const MAX_TEXT_BATCH_BYTES = 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_INLINE_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_INLINE_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_INLINE_PDF_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_PIXELS = 16_777_216;

export type ResolvedEmbeddingMedia = {
  bytes: Uint8Array;
  mediaType: string;
};

export type GeminiEmbeddingProviderOptions = {
  apiKey: string;
  dimensions: 768 | 1536 | 3072;
  modelRevision?: string;
  deadlineMs?: number;
  fetch?: ProviderFetcher;
  resolveMedia?: (
    input: MediaEmbeddingInput,
    signal: AbortSignal,
  ) => Promise<ResolvedEmbeddingMedia>;
};

export function geminiEmbeddingSpaceDescriptor(
  dimensions: 768 | 1536 | 3072,
  modelRevision = "stable-2026-04",
): EmbeddingSpaceDescriptor {
  const identity = {
    provider: "gemini",
    model: GEMINI_EMBEDDING_MODEL,
    modelRevision,
    dimensions,
    modalities: ["text", "image", "pdf-page", "audio", "video"] as const,
    normalization: "provider-unit" as const,
    preprocessingRevision: "avermate-retrieval-prefixes-and-media-v1",
    placement: "core" as const,
  };
  return {
    id: `emb_${sha256(canonicalJson(identity))}`,
    ...identity,
    modalities: [...identity.modalities],
  };
}

type GeminiUsage = {
  promptTokenCount?: unknown;
  totalTokenCount?: unknown;
};

function contentDigest(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex");
}

function assertConsent(context: EmbeddingRequestContext | undefined) {
  if (
    !context ||
    context.consent.provider !== "gemini" ||
    context.consent.capability !== "embedding" ||
    context.consent.disclosureRevision !== GEMINI_EMBEDDING_DISCLOSURE_REVISION
  ) {
    throw new Error("GEMINI_EMBEDDING_EXPLICIT_CONSENT_REQUIRED");
  }
  context.signal.throwIfAborted();
}

function usageMetadata(
  usage: GeminiUsage | undefined,
  response: Response,
): EmbeddingVector["usage"] {
  const raw = usage?.totalTokenCount ?? usage?.promptTokenCount;
  const tokens = Number(raw);
  return {
    inputTokens: Number.isSafeInteger(tokens) && tokens >= 0 ? tokens : null,
    providerRequestId:
      response.headers.get("x-request-id") ??
      response.headers.get("x-goog-request-id"),
  };
}

function vectorValues(value: unknown, dimensions: number) {
  if (!value || typeof value !== "object") {
    throw new Error("GEMINI_EMBEDDING_MALFORMED_VECTOR");
  }
  const values = (value as { values?: unknown }).values;
  if (!Array.isArray(values) || values.length !== dimensions) {
    throw new Error("GEMINI_EMBEDDING_INVALID_DIMENSIONS");
  }
  const numbers = values.map(Number);
  if (!numbers.every(Number.isFinite)) {
    throw new Error("GEMINI_EMBEDDING_NON_FINITE_VECTOR");
  }
  return numbers;
}

function uniqueContentHashes(
  input: readonly { contentHash: string }[],
  limit: number,
) {
  if (input.length < 1 || input.length > limit) {
    throw new Error("GEMINI_EMBEDDING_BATCH_LIMIT");
  }
  if (new Set(input.map((entry) => entry.contentHash)).size !== input.length) {
    throw new Error("GEMINI_EMBEDDING_DUPLICATE_INPUT");
  }
}

function retrievalText(input: TextEmbeddingInput) {
  const text = input.text.replaceAll("\0", "").trim();
  if (!text || utf8Bytes(text) > MAX_TEXT_BYTES) {
    throw new Error("GEMINI_EMBEDDING_TEXT_LIMIT");
  }
  if (input.purpose === "query") {
    return `task: search result | query: ${text}`;
  }
  const title = input.title?.replaceAll("|", " ").trim() || "none";
  return `title: ${title} | text: ${text}`;
}

function requestUsage(value: unknown) {
  return value && typeof value === "object"
    ? (value as GeminiUsage)
    : undefined;
}

async function assertOnePagePdf(bytes: Uint8Array) {
  // PDF.js may transfer/detach the supplied ArrayBuffer. Validate a defensive
  // copy so the exact bytes that passed the digest check remain available for
  // the provider request.
  const pdf = await getDocumentProxy(Uint8Array.from(bytes), {
    maxImageSize: MAX_IMAGE_PIXELS,
    stopAtErrors: false,
  });
  try {
    if (pdf.numPages !== 1) {
      throw new Error("GEMINI_EMBEDDING_PDF_MUST_CONTAIN_ONE_PAGE");
    }
  } finally {
    await pdf.cleanup().catch(() => undefined);
  }
}

async function validateResolvedMedia(
  input: MediaEmbeddingInput,
  media: ResolvedEmbeddingMedia,
) {
  if (media.mediaType !== input.mediaType) {
    throw new Error("GEMINI_EMBEDDING_MEDIA_TYPE_MISMATCH");
  }
  if (
    media.bytes.byteLength !== input.byteLength ||
    contentDigest(media.bytes) !== input.contentHash
  ) {
    throw new Error("GEMINI_EMBEDDING_MEDIA_DIGEST_MISMATCH");
  }
  if (
    !Number.isSafeInteger(input.estimatedInputTokens) ||
    input.estimatedInputTokens < 1 ||
    input.estimatedInputTokens > 8192
  ) {
    throw new Error("GEMINI_EMBEDDING_TOKEN_LIMIT");
  }
  if (input.modality === "pdf-page") {
    if (
      input.mediaType !== "application/pdf" ||
      input.locator.kind !== "pdf" ||
      media.bytes.byteLength > MAX_INLINE_PDF_BYTES
    ) {
      throw new Error("GEMINI_EMBEDDING_INVALID_PDF_PAGE");
    }
    await assertOnePagePdf(media.bytes);
    return;
  }
  if (input.modality === "image") {
    if (
      !["image/png", "image/jpeg"].includes(input.mediaType) ||
      media.bytes.byteLength > MAX_INLINE_IMAGE_BYTES
    ) {
      throw new Error("GEMINI_EMBEDDING_INVALID_IMAGE");
    }
    const metadata = await sharp(media.bytes, {
      limitInputPixels: MAX_IMAGE_PIXELS,
    }).metadata();
    const pixels = Number(metadata.width ?? 0) * Number(metadata.height ?? 0);
    if (!pixels || pixels > MAX_IMAGE_PIXELS) {
      throw new Error("GEMINI_EMBEDDING_IMAGE_PIXEL_LIMIT");
    }
    return;
  }
  if (input.modality === "audio") {
    if (
      !["audio/mpeg", "audio/wav", "audio/x-wav"].includes(input.mediaType) ||
      media.bytes.byteLength > MAX_INLINE_AUDIO_BYTES ||
      input.locator.kind !== "audio" ||
      !input.durationMs ||
      input.durationMs > 180_000
    ) {
      throw new Error("GEMINI_EMBEDDING_INVALID_AUDIO_SEGMENT");
    }
    return;
  }
  if (
    !["video/mp4", "video/quicktime"].includes(input.mediaType) ||
    media.bytes.byteLength > MAX_INLINE_VIDEO_BYTES ||
    input.locator.kind !== "video" ||
    !input.durationMs ||
    input.durationMs > 120_000
  ) {
    throw new Error("GEMINI_EMBEDDING_INVALID_VIDEO_SEGMENT");
  }
}

/** Stable Gemini Embedding 2 adapter; source handles are resolved server-side. */
export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly #descriptor: EmbeddingSpaceDescriptor;
  readonly #fetch: ProviderFetcher;
  readonly #deadlineMs: number;

  constructor(private readonly options: GeminiEmbeddingProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("GEMINI_API_KEY_REQUIRED");
    if (![768, 1536, 3072].includes(options.dimensions)) {
      throw new Error("GEMINI_EMBEDDING_UNAPPROVED_DIMENSIONS");
    }
    this.#deadlineMs = Math.min(options.deadlineMs ?? 30_000, 60_000);
    this.#descriptor = geminiEmbeddingSpaceDescriptor(
      options.dimensions,
      options.modelRevision,
    );
    this.#fetch =
      options.fetch ??
      ((url, init) =>
        safeModelFetchResponse(url, {
          policy: {
            placement: "hosted-core",
            allowedOrigins: [GEMINI_EMBEDDING_ORIGIN],
          },
          credential: {
            origin: GEMINI_EMBEDDING_ORIGIN,
            headerName: "x-goog-api-key",
            value: options.apiKey,
          },
          method: init?.method,
          headers: init?.headers,
          body: init?.body,
          signal: init?.signal ?? undefined,
          maxResponseBytes: MAX_RESPONSE_BYTES,
        }));
  }

  descriptor() {
    return {
      ...this.#descriptor,
      modalities: [...this.#descriptor.modalities],
    };
  }

  async embedText(
    input: readonly TextEmbeddingInput[],
    context?: EmbeddingRequestContext,
  ): Promise<EmbeddingVector[]> {
    assertConsent(context);
    uniqueContentHashes(input, 100);
    const prepared = input.map(retrievalText);
    if (
      prepared.reduce((sum, text) => sum + utf8Bytes(text), 0) >
      MAX_TEXT_BATCH_BYTES
    ) {
      throw new Error("GEMINI_EMBEDDING_TOTAL_TEXT_LIMIT");
    }
    await context?.authorize?.();
    const response = await this.#fetch(BATCH_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({
        requests: prepared.map((text) => ({
          model: MODEL_RESOURCE,
          content: { parts: [{ text }] },
          embedContentConfig: {
            autoTruncate: false,
            outputDimensionality: this.options.dimensions,
          },
        })),
      }),
      signal: providerSignal(context!.signal, this.#deadlineMs),
    });
    if (!response.ok)
      throw redactedProviderHttpError("GEMINI_EMBEDDING", response);
    const body = await boundedProviderJson(response, MAX_RESPONSE_BYTES);
    const object =
      body && typeof body === "object"
        ? (body as Record<string, unknown>)
        : null;
    const embeddings = object?.embeddings;
    if (!Array.isArray(embeddings) || embeddings.length !== input.length) {
      throw new Error("GEMINI_EMBEDDING_RESULT_COUNT_MISMATCH");
    }
    const usage = usageMetadata(requestUsage(object?.usageMetadata), response);
    return input.map((entry, index) => ({
      contentHash: entry.contentHash,
      values: vectorValues(embeddings[index], this.options.dimensions),
      usage,
    }));
  }

  async embedMedia(
    input: readonly MediaEmbeddingInput[],
    context: EmbeddingRequestContext,
  ): Promise<EmbeddingVector[]> {
    assertConsent(context);
    uniqueContentHashes(input, 16);
    if (!this.options.resolveMedia) {
      throw new Error("GEMINI_EMBEDDING_MEDIA_RESOLVER_REQUIRED");
    }
    // Resolve and validate every derivative before the first provider call so
    // an invalid later item cannot create a partially paid/published batch.
    const resolved: ResolvedEmbeddingMedia[] = [];
    for (const entry of input) {
      context.signal.throwIfAborted();
      const media = await this.options.resolveMedia(entry, context.signal);
      await validateResolvedMedia(entry, media);
      resolved.push(media);
    }
    const output: EmbeddingVector[] = [];
    for (let index = 0; index < input.length; index += 1) {
      context.signal.throwIfAborted();
      const entry = input[index]!;
      const media = resolved[index]!;
      await context.authorize?.();
      const response = await this.#fetch(SINGLE_ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          model: MODEL_RESOURCE,
          content: {
            parts: [
              {
                inline_data: {
                  mime_type: media.mediaType,
                  data: Buffer.from(media.bytes).toString("base64"),
                },
              },
            ],
          },
          embedContentConfig: {
            autoTruncate: false,
            outputDimensionality: this.options.dimensions,
          },
        }),
        signal: providerSignal(context.signal, this.#deadlineMs),
      });
      if (!response.ok)
        throw redactedProviderHttpError("GEMINI_EMBEDDING", response);
      const body = await boundedProviderJson(response, MAX_RESPONSE_BYTES);
      const object =
        body && typeof body === "object"
          ? (body as Record<string, unknown>)
          : null;
      if (!object?.embedding)
        throw new Error("GEMINI_EMBEDDING_RESULT_MISSING");
      output.push({
        contentHash: entry.contentHash,
        values: vectorValues(object.embedding, this.options.dimensions),
        usage: usageMetadata(requestUsage(object.usageMetadata), response),
      });
    }
    return output;
  }
}
