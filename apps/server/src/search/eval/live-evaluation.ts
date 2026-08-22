import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  EmbeddingVector,
  MediaEmbeddingInput,
  RerankProvider,
  TextEmbeddingInput,
} from "@avermate/agent-contracts";
import { sourceLocatorV1Schema } from "@avermate/agent-contracts";
import { z } from "zod";
import {
  PairedNodeRerankProvider,
  reviewedQwen3TextRerankProfile,
} from "../../node/paired-node-rerank-provider";
import {
  GEMINI_EMBEDDING_DISCLOSURE_REVISION,
  GeminiEmbeddingProvider,
  type ResolvedEmbeddingMedia,
} from "../gemini-embedding";
import {
  COHERE_RERANK_DISCLOSURE_REVISION,
  CohereRerankProvider,
  GTE_MULTILINGUAL_RERANK_MODEL,
  TeiRerankProvider,
} from "../rerank-providers";
import { canonicalJson, sha256 } from "../values";
import { reciprocalRankFusion } from "../vector";
import {
  evaluateObservedRankings,
  type RetrievalEvaluationObservation,
} from "./evaluation";

export const LIVE_EVALUATION_SCHEMA_REVISION =
  "avermate-live-retrieval-evaluation/1" as const;

const LIVE_ABLATIONS = [
  "lexical-bm25",
  "dense-text",
  "dense-multimodal",
  "rrf-multimodal",
  "rrf-multimodal-reranked",
] as const;
type LiveAblation = (typeof LIVE_ABLATIONS)[number];

const MAX_MANIFEST_BYTES = 1024 * 1024;
const MAX_DOCUMENTS = 500;
const MAX_QUERIES = 200;
const MAX_DOCUMENT_TEXT_BYTES = 12 * 1024;
const MAX_QUERY_BYTES = 16 * 1024;
const MAX_TOTAL_TEXT_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_MEDIA_BYTES = 512 * 1024 * 1024;
const TEXT_BATCH_BYTES = 900 * 1024;
const TEXT_BATCH_ITEMS = 100;
const MEDIA_BATCH_ITEMS = 16;
const MINIMUM_LIVE_DOCUMENTS = 12;
const MINIMUM_LIVE_QUERIES = 8;
const WINDOWS_RESERVED_BASENAMES = new Set([
  "CON",
  "PRN",
  "AUX",
  "NUL",
  "COM1",
  "COM2",
  "COM3",
  "COM4",
  "COM5",
  "COM6",
  "COM7",
  "COM8",
  "COM9",
  "LPT1",
  "LPT2",
  "LPT3",
  "LPT4",
  "LPT5",
  "LPT6",
  "LPT7",
  "LPT8",
  "LPT9",
]);

const utf8 = new TextEncoder();

const safeIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\p{L}\p{N}][\p{L}\p{N}._-]*$/u);

const mediaModalitySchema = z.enum(["image", "pdf-page", "audio", "video"]);

const mediaTypeSchema = z.enum([
  "application/pdf",
  "image/png",
  "image/jpeg",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
  "video/mp4",
  "video/quicktime",
]);
const filesystemErrorSchema = z.object({ code: z.string() }).passthrough();

export function validateRelativeMediaPath(value: string) {
  if (
    !value ||
    value.includes("\0") ||
    path.isAbsolute(value) ||
    path.posix.isAbsolute(value) ||
    path.win32.isAbsolute(value) ||
    /[:*?"<>|]/u.test(value)
  ) {
    return false;
  }
  const segments = value.replaceAll("\\", "/").split("/");
  return segments.every((segment) => {
    const stem = segment.split(".")[0]?.toUpperCase();
    return (
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !/[.\s]$/u.test(segment) &&
      !WINDOWS_RESERVED_BASENAMES.has(stem ?? "")
    );
  });
}

const mediaSchema = z.strictObject({
  path: z.string().min(1).max(512).refine(validateRelativeMediaPath, {
    message: "media path must be a traversal-free relative path",
  }),
  mediaType: mediaTypeSchema,
  estimatedInputTokens: z.number().int().min(1).max(8_192),
});

const documentSchema = z
  .strictObject({
    id: safeIdSchema,
    sourceId: safeIdSchema,
    title: z.string().trim().min(1).max(512),
    text: z.string().trim().min(1),
    modality: z.enum(["text", ...mediaModalitySchema.options]),
    locator: sourceLocatorV1Schema,
    media: mediaSchema.optional(),
  })
  .superRefine((document, context) => {
    const textBytes = utf8.encode(document.text).byteLength;
    if (textBytes > MAX_DOCUMENT_TEXT_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "document text exceeds the reranker-safe byte limit",
      });
    }
    if ((document.modality === "text") !== !document.media) {
      context.addIssue({
        code: "custom",
        path: ["media"],
        message: "media is required exactly for non-text documents",
      });
    }
    if (document.media) {
      if (document.modality === "pdf-page") {
        if (
          document.media.mediaType !== "application/pdf" ||
          document.locator.kind !== "pdf"
        ) {
          context.addIssue({
            code: "custom",
            path: ["media"],
            message: "PDF-page media requires an exact PDF page locator",
          });
        }
      } else if (document.modality === "image") {
        if (!document.media.mediaType.startsWith("image/")) {
          context.addIssue({
            code: "custom",
            path: ["media", "mediaType"],
            message: "image modality requires an image media type",
          });
        }
      } else if (document.modality === "audio") {
        if (
          !document.media.mediaType.startsWith("audio/") ||
          document.locator.kind !== "audio" ||
          document.locator.endMs - document.locator.startMs > 180_000
        ) {
          context.addIssue({
            code: "custom",
            path: ["media"],
            message: "audio media requires a bounded exact time locator",
          });
        }
      } else if (
        !document.media.mediaType.startsWith("video/") ||
        document.locator.kind !== "video" ||
        document.locator.endMs - document.locator.startMs > 120_000
      ) {
        context.addIssue({
          code: "custom",
          path: ["media"],
          message: "video media requires a bounded exact time locator",
        });
      }
    }
  });

const querySchema = z
  .strictObject({
    id: safeIdSchema,
    query: z.string().trim().min(1),
    answerable: z.boolean(),
    relevance: z
      .array(
        z.strictObject({
          documentId: safeIdSchema,
          grade: z.number().int().min(1).max(3),
        }),
      )
      .max(MAX_DOCUMENTS),
  })
  .superRefine((query, context) => {
    if (utf8.encode(query.query).byteLength > MAX_QUERY_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["query"],
        message: "query exceeds the byte limit",
      });
    }
    if (query.answerable !== query.relevance.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["answerable"],
        message: "answerability must agree with reviewed relevance labels",
      });
    }
    if (
      new Set(query.relevance.map((entry) => entry.documentId)).size !==
      query.relevance.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["relevance"],
        message: "relevance document IDs must be unique",
      });
    }
  });

const liveQualityGateSchema = z.strictObject({
  minimumRecallAt10: z.number().min(0.5).max(1),
  minimumNdcgAt10: z.number().min(0.5).max(1),
  minimumCitationPrecisionAt10: z.number().min(0.5).max(1),
  minimumAbstentionAccuracy: z.number().min(0.5).max(1),
  minimumRecallImprovementOverLexical: z.number().positive().max(1),
  maximumP95LatencyMs: z.number().int().min(100).max(120_000),
  maximumQueryProviderCostMinor: z.number().nonnegative().optional(),
});

export const liveEvaluationManifestSchema = z
  .strictObject({
    schemaRevision: z.literal(LIVE_EVALUATION_SCHEMA_REVISION),
    corpusRevision: safeIdSchema,
    labelRevision: safeIdSchema,
    reviewedAt: z.iso.datetime({ offset: true }),
    language: z.literal("fr"),
    license: z.string().trim().min(1).max(512),
    qualityGate: liveQualityGateSchema,
    documents: z.array(documentSchema).min(2).max(MAX_DOCUMENTS),
    queries: z.array(querySchema).min(1).max(MAX_QUERIES),
  })
  .superRefine((manifest, context) => {
    const documentIds = new Set(
      manifest.documents.map((document) => document.id),
    );
    const queryIds = manifest.queries.map((query) => query.id);
    if (documentIds.size !== manifest.documents.length) {
      context.addIssue({
        code: "custom",
        path: ["documents"],
        message: "document IDs must be unique",
      });
    }
    if (new Set(queryIds).size !== queryIds.length) {
      context.addIssue({
        code: "custom",
        path: ["queries"],
        message: "query IDs must be unique",
      });
    }
    for (const [queryIndex, query] of manifest.queries.entries()) {
      for (const [relevanceIndex, relevance] of query.relevance.entries()) {
        if (!documentIds.has(relevance.documentId)) {
          context.addIssue({
            code: "custom",
            path: ["queries", queryIndex, "relevance", relevanceIndex],
            message: "relevance points to an unknown document",
          });
        }
      }
    }
    const totalTextBytes = manifest.documents.reduce(
      (total, document) => total + utf8.encode(document.text).byteLength,
      0,
    );
    if (totalTextBytes > MAX_TOTAL_TEXT_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["documents"],
        message: "aggregate corpus text exceeds the live-evaluation limit",
      });
    }
  });

export type LiveEvaluationManifest = z.infer<
  typeof liveEvaluationManifestSchema
>;

type LiveQualityGateThresholds = z.infer<typeof liveQualityGateSchema>;

export function evaluateLiveQualityGate(input: {
  final: ReturnType<typeof evaluateObservedRankings>;
  lexical: ReturnType<typeof evaluateObservedRankings>;
  thresholds: LiveQualityGateThresholds;
}) {
  const observed = {
    recallAt10: input.final.recallAt10,
    ndcgAt10: input.final.ndcgAt10,
    citationPrecisionAt10: input.final.citationPrecisionAt10,
    abstentionAccuracy: input.final.abstentionAccuracy,
    recallImprovementOverLexical:
      input.final.recallAt10 - input.lexical.recallAt10,
    p95LatencyMs: input.final.p95LatencyMs,
    queryProviderCostMinor: input.final.totalProviderCostMinor,
  };
  const reasons: string[] = [];
  if (observed.recallAt10 < input.thresholds.minimumRecallAt10)
    reasons.push("recall-at-10");
  if (observed.ndcgAt10 < input.thresholds.minimumNdcgAt10)
    reasons.push("ndcg-at-10");
  if (
    observed.citationPrecisionAt10 <
    input.thresholds.minimumCitationPrecisionAt10
  )
    reasons.push("citation-precision-at-10");
  if (observed.abstentionAccuracy < input.thresholds.minimumAbstentionAccuracy)
    reasons.push("abstention-accuracy");
  if (
    observed.recallImprovementOverLexical <
    input.thresholds.minimumRecallImprovementOverLexical
  )
    reasons.push("recall-improvement-over-lexical");
  if (observed.p95LatencyMs > input.thresholds.maximumP95LatencyMs)
    reasons.push("p95-latency");
  if (input.thresholds.maximumQueryProviderCostMinor !== undefined) {
    if (observed.queryProviderCostMinor === null)
      reasons.push("query-provider-cost-unavailable");
    else if (
      observed.queryProviderCostMinor >
      input.thresholds.maximumQueryProviderCostMinor
    )
      reasons.push("query-provider-cost");
  }
  return {
    passed: reasons.length === 0,
    reasons,
    thresholds: input.thresholds,
    observed,
  };
}

function isWithin(root: string, candidate: string) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export async function resolveEvaluationMediaPath(
  manifestDirectory: string,
  relativePath: string,
) {
  if (!validateRelativeMediaPath(relativePath)) {
    throw new Error("LIVE_EVAL_MEDIA_PATH_INVALID");
  }
  const root = await realpath(manifestDirectory);
  const lexicalCandidate = path.resolve(root, relativePath);
  if (!isWithin(root, lexicalCandidate)) {
    throw new Error("LIVE_EVAL_MEDIA_PATH_ESCAPE");
  }
  const [candidate, linkInfo] = await Promise.all([
    realpath(lexicalCandidate),
    lstat(lexicalCandidate),
  ]);
  if (!isWithin(root, candidate) || linkInfo.isSymbolicLink()) {
    throw new Error("LIVE_EVAL_MEDIA_PATH_ESCAPE");
  }
  const info = await stat(candidate);
  if (!info.isFile()) throw new Error("LIVE_EVAL_MEDIA_NOT_FILE");
  return { absolutePath: candidate, byteLength: info.size };
}

function startsWith(
  bytes: Uint8Array,
  expected: readonly number[],
  offset = 0,
) {
  return expected.every((value, index) => bytes[offset + index] === value);
}

export function assertEvaluationMediaSignature(
  mediaType: z.infer<typeof mediaTypeSchema>,
  bytes: Uint8Array,
) {
  const valid = (() => {
    if (mediaType === "application/pdf") {
      return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
    }
    if (mediaType === "image/png") {
      return startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10]);
    }
    if (mediaType === "image/jpeg") {
      return startsWith(bytes, [255, 216, 255]);
    }
    if (mediaType === "audio/wav" || mediaType === "audio/x-wav") {
      return (
        new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" &&
        new TextDecoder().decode(bytes.slice(8, 12)) === "WAVE"
      );
    }
    if (mediaType === "audio/mpeg") {
      return (
        new TextDecoder().decode(bytes.slice(0, 3)) === "ID3" ||
        (bytes[0] === 255 && ((bytes[1] ?? 0) & 0xe0) === 0xe0)
      );
    }
    return new TextDecoder().decode(bytes.slice(4, 8)) === "ftyp";
  })();
  if (!valid) throw new Error("LIVE_EVAL_MEDIA_SIGNATURE_MISMATCH");
}

export async function loadLiveEvaluationManifest(manifestPath: string) {
  const absoluteManifestPath = path.resolve(manifestPath);
  const info = await stat(absoluteManifestPath);
  if (!info.isFile() || info.size > MAX_MANIFEST_BYTES) {
    throw new Error("LIVE_EVAL_MANIFEST_SIZE_INVALID");
  }
  const bytes = await readFile(absoluteManifestPath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("LIVE_EVAL_MANIFEST_JSON_INVALID");
  }
  return {
    manifest: liveEvaluationManifestSchema.parse(parsed),
    manifestDirectory: path.dirname(absoluteManifestPath),
    manifestFileDigest: createHash("sha256").update(bytes).digest("hex"),
  };
}

export function assertLiveCorpusCoverage(manifest: LiveEvaluationManifest) {
  const modalities = new Set<string>(
    manifest.documents.map((entry) => entry.modality),
  );
  if (
    manifest.documents.length < MINIMUM_LIVE_DOCUMENTS ||
    manifest.queries.length < MINIMUM_LIVE_QUERIES ||
    !["text", "image", "pdf-page", "audio", "video"].every((modality) =>
      modalities.has(modality),
    ) ||
    !manifest.queries.some((query) => !query.answerable) ||
    !manifest.queries.some((query) => query.answerable)
  ) {
    throw new Error("LIVE_EVAL_CORPUS_COVERAGE_INCOMPLETE");
  }
}

function tokenizeFrench(value: string) {
  return (
    value
      .normalize("NFKC")
      .toLocaleLowerCase("fr")
      .match(/[\p{L}\p{N}]+/gu) ?? []
  );
}

export function rankDocumentsWithBm25(
  query: string,
  documents: readonly { id: string; text: string }[],
  options: { k1?: number; b?: number } = {},
) {
  const queryTerms = tokenizeFrench(query);
  const tokenized = documents.map((document) => ({
    id: document.id,
    tokens: tokenizeFrench(document.text),
  }));
  const averageLength =
    tokenized.reduce((total, document) => total + document.tokens.length, 0) /
    Math.max(1, tokenized.length);
  const documentFrequency = new Map<string, number>();
  for (const document of tokenized) {
    for (const term of new Set(document.tokens)) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const queryFrequency = new Map<string, number>();
  for (const term of queryTerms) {
    queryFrequency.set(term, (queryFrequency.get(term) ?? 0) + 1);
  }
  const k1 = options.k1 ?? 1.2;
  const b = options.b ?? 0.75;
  return tokenized
    .map((document) => {
      const frequencies = new Map<string, number>();
      for (const term of document.tokens) {
        frequencies.set(term, (frequencies.get(term) ?? 0) + 1);
      }
      let score = 0;
      for (const [term, queryCount] of queryFrequency) {
        const frequency = frequencies.get(term) ?? 0;
        if (!frequency) continue;
        const containing = documentFrequency.get(term) ?? 0;
        const inverseDocumentFrequency = Math.log(
          1 + (documents.length - containing + 0.5) / (containing + 0.5),
        );
        const normalization =
          frequency +
          k1 *
            (1 - b + b * (document.tokens.length / Math.max(1, averageLength)));
        score +=
          queryCount *
          inverseDocumentFrequency *
          ((frequency * (k1 + 1)) / normalization);
      }
      return { id: document.id, score };
    })
    .filter((entry) => entry.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    );
}

export function cosineSimilarity(
  left: readonly number[],
  right: readonly number[],
) {
  if (left.length !== right.length || left.length === 0) {
    throw new Error("LIVE_EVAL_VECTOR_DIMENSION_MISMATCH");
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!;
    const b = right[index]!;
    if (!Number.isFinite(a) || !Number.isFinite(b)) {
      throw new Error("LIVE_EVAL_VECTOR_NON_FINITE");
    }
    dot += a * b;
    leftNorm += a * a;
    rightNorm += b * b;
  }
  return leftNorm && rightNorm
    ? dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm))
    : 0;
}

export function rankDenseDocuments(
  queryVector: readonly number[],
  documents: readonly { id: string; vectors: readonly (readonly number[])[] }[],
) {
  if (documents.some((document) => document.vectors.length === 0)) {
    throw new Error("LIVE_EVAL_DOCUMENT_VECTOR_MISSING");
  }
  return documents
    .map((document) => ({
      id: document.id,
      score: Math.max(
        ...document.vectors.map((vector) =>
          cosineSimilarity(queryVector, vector),
        ),
      ),
    }))
    .sort(
      (left, right) =>
        right.score - left.score || left.id.localeCompare(right.id),
    );
}

export function batchTextEmbeddingInputs<
  T extends { text: string; title?: string | null },
>(inputs: readonly T[]) {
  const batches: T[][] = [];
  let current: T[] = [];
  let currentBytes = 0;
  for (const input of inputs) {
    const bytes =
      utf8.encode(input.text).byteLength +
      utf8.encode(input.title ?? "").byteLength +
      128;
    if (bytes > TEXT_BATCH_BYTES) {
      throw new Error("LIVE_EVAL_TEXT_EMBEDDING_ITEM_TOO_LARGE");
    }
    if (
      current.length > 0 &&
      (current.length >= TEXT_BATCH_ITEMS ||
        currentBytes + bytes > TEXT_BATCH_BYTES)
    ) {
      batches.push(current);
      current = [];
      currentBytes = 0;
    }
    current.push(input);
    currentBytes += bytes;
  }
  if (current.length) batches.push(current);
  return batches;
}

export function orderRerankedDocumentIds(input: {
  candidateIds: readonly string[];
  scores: readonly { candidateId: string; rank: number; score: number }[];
}) {
  const candidateIds = new Set(input.candidateIds);
  if (
    input.scores.length !== input.candidateIds.length ||
    new Set(input.scores.map((entry) => entry.candidateId)).size !==
      input.scores.length ||
    new Set(input.scores.map((entry) => entry.rank)).size !==
      input.scores.length ||
    input.scores.some(
      (entry) =>
        !candidateIds.has(entry.candidateId) ||
        !Number.isSafeInteger(entry.rank) ||
        entry.rank < 0 ||
        entry.rank >= input.scores.length ||
        !Number.isFinite(entry.score),
    )
  ) {
    throw new Error("LIVE_EVAL_RERANK_RESULT_INVALID");
  }
  return [...input.scores]
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        left.candidateId.localeCompare(right.candidateId),
    )
    .map((entry) => entry.candidateId);
}

type LoadedMedia = {
  documentId: string;
  input: MediaEmbeddingInput;
  resolved: ResolvedEmbeddingMedia;
  digest: string;
};

async function loadMedia(
  manifest: LiveEvaluationManifest,
  manifestDirectory: string,
) {
  const output: LoadedMedia[] = [];
  let totalBytes = 0;
  for (const document of manifest.documents) {
    if (!document.media || document.modality === "text") continue;
    const resolvedPath = await resolveEvaluationMediaPath(
      manifestDirectory,
      document.media.path,
    );
    const maximumBytes =
      document.modality === "video"
        ? 100 * 1024 * 1024
        : document.modality === "audio"
          ? 25 * 1024 * 1024
          : 20 * 1024 * 1024;
    if (resolvedPath.byteLength < 1 || resolvedPath.byteLength > maximumBytes) {
      throw new Error("LIVE_EVAL_MEDIA_ITEM_LIMIT");
    }
    totalBytes += resolvedPath.byteLength;
    if (totalBytes > MAX_TOTAL_MEDIA_BYTES) {
      throw new Error("LIVE_EVAL_TOTAL_MEDIA_LIMIT");
    }
    const bytes = new Uint8Array(await readFile(resolvedPath.absolutePath));
    assertEvaluationMediaSignature(document.media.mediaType, bytes);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const durationMs =
      document.locator.kind === "audio" || document.locator.kind === "video"
        ? document.locator.endMs - document.locator.startMs
        : undefined;
    const input: MediaEmbeddingInput = {
      contentHash: digest,
      modality: document.modality,
      mediaType: document.media.mediaType,
      opaqueFileHandle: `evaluation-media:${digest}`,
      locator: document.locator,
      byteLength: bytes.byteLength,
      estimatedInputTokens: document.media.estimatedInputTokens,
    };
    if (durationMs !== undefined) input.durationMs = durationMs;
    output.push({
      documentId: document.id,
      digest,
      resolved: { bytes, mediaType: document.media.mediaType },
      input,
    });
  }
  return output;
}

function required(environment: NodeJS.ProcessEnv, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`LIVE_EVAL_REQUIRED_ENV_MISSING:${name}`);
  return value;
}

function boundedInteger(
  environment: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  maximum: number,
) {
  const value = Number(required(environment, name));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`LIVE_EVAL_ENV_INVALID:${name}`);
  }
  return value;
}

function optionalRate(environment: NodeJS.ProcessEnv, name: string) {
  const raw = environment[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`LIVE_EVAL_ENV_INVALID:${name}`);
  }
  return value;
}

function boundedNumber(
  environment: NodeJS.ProcessEnv,
  name: string,
  minimum: number,
  maximum: number,
) {
  const value = Number(required(environment, name));
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`LIVE_EVAL_ENV_INVALID:${name}`);
  }
  return value;
}

function revision(environment: NodeJS.ProcessEnv, name: string) {
  const value = required(environment, name);
  if (
    value.length > 256 ||
    !/^[\p{L}\p{N}][\p{L}\p{N}._:+@/-]*$/u.test(value)
  ) {
    throw new Error(`LIVE_EVAL_ENV_INVALID:${name}`);
  }
  return value;
}

function consentDate(environment: NodeJS.ProcessEnv, name: string) {
  const value = required(environment, name);
  if (!z.iso.datetime({ offset: true }).safeParse(value).success) {
    throw new Error(`LIVE_EVAL_ENV_INVALID:${name}`);
  }
  return value;
}

function exactConsent(environment: NodeJS.ProcessEnv) {
  if (
    required(environment, "PLAN036_GEMINI_CONSENT") !==
    GEMINI_EMBEDDING_DISCLOSURE_REVISION
  ) {
    throw new Error("LIVE_EVAL_GEMINI_DISCLOSURE_NOT_ACCEPTED");
  }
  const grantedAt = consentDate(
    environment,
    "PLAN036_GEMINI_CONSENT_GRANTED_AT",
  );
  return {
    provider: "gemini" as const,
    capability: "embedding" as const,
    disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
    grantedAt,
  };
}

function buildReranker(environment: NodeJS.ProcessEnv): RerankProvider {
  const provider = required(environment, "PLAN036_EVAL_RERANKER");
  if (provider === "cohere") {
    if (
      required(environment, "PLAN036_COHERE_CONSENT") !==
      COHERE_RERANK_DISCLOSURE_REVISION
    ) {
      throw new Error("LIVE_EVAL_COHERE_DISCLOSURE_NOT_ACCEPTED");
    }
    consentDate(environment, "PLAN036_COHERE_CONSENT_GRANTED_AT");
    const model = required(environment, "CORPUS_RERANK_MODEL");
    if (model !== "rerank-v4.0-pro" && model !== "rerank-v4.0-fast") {
      throw new Error("LIVE_EVAL_COHERE_MODEL_INVALID");
    }
    return new CohereRerankProvider({
      apiKey: required(environment, "COHERE_API_KEY"),
      model,
      modelRevision: revision(environment, "CORPUS_RERANK_MODEL_REVISION"),
    });
  }
  const common = {
    baseUrl: required(environment, "CORPUS_RERANK_BASE_URL"),
    modelRevision: revision(environment, "CORPUS_RERANK_MODEL_REVISION"),
    imageDigest: required(environment, "CORPUS_RERANK_IMAGE_DIGEST"),
  };
  if (provider === "tei") {
    if (
      required(environment, "CORPUS_RERANK_MODEL") !==
      GTE_MULTILINGUAL_RERANK_MODEL
    ) {
      throw new Error("LIVE_EVAL_TEI_MODEL_INVALID");
    }
    return new TeiRerankProvider({
      fetch,
      ...common,
      teiRevision: revision(environment, "CORPUS_RERANK_TEI_REVISION"),
    });
  }
  if (provider === "qwen3") {
    if (
      required(environment, "CORPUS_RERANK_MODEL") !==
        reviewedQwen3TextRerankProfile.model ||
      common.modelRevision !== reviewedQwen3TextRerankProfile.modelRevision
    ) {
      throw new Error("LIVE_EVAL_QWEN3_MODEL_NOT_REVIEWED");
    }
    return new PairedNodeRerankProvider({
      fetch,
      ...common,
      provider: "qwen3",
      model: reviewedQwen3TextRerankProfile.model,
      runtimeRevision: revision(environment, "CORPUS_RERANK_RUNTIME_REVISION"),
    });
  }
  throw new Error("LIVE_EVAL_RERANKER_INVALID");
}

type UsageCounter = { known: boolean; inputTokens: number };

function observeUsage(
  counter: UsageCounter,
  vector: EmbeddingVector | undefined,
) {
  const tokens = vector?.usage?.inputTokens;
  if (tokens === null || tokens === undefined) counter.known = false;
  else counter.inputTokens += tokens;
}

function costForTokens(counter: UsageCounter, rate: number | null) {
  return counter.known && rate !== null
    ? (counter.inputTokens * rate) / 1_000_000
    : null;
}

function operationSignal(environment: NodeJS.ProcessEnv) {
  const seconds = boundedInteger(
    environment,
    "PLAN036_EVAL_TIMEOUT_SECONDS",
    60,
    3_600,
  );
  return AbortSignal.timeout(seconds * 1_000);
}

function embeddingDimensions(environment: NodeJS.ProcessEnv) {
  const value = boundedInteger(
    environment,
    "PLAN036_EVAL_GEMINI_DIMENSIONS",
    768,
    3_072,
  );
  if (value === 768 || value === 1536 || value === 3072) return value;
  throw new Error("LIVE_EVAL_GEMINI_DIMENSIONS_INVALID");
}

function reportDigestRows(
  observations: readonly RetrievalEvaluationObservation[],
) {
  return observations.map((observation) => ({
    queryIdDigest: sha256(observation.queryId),
    rankingDigest: sha256(canonicalJson(observation.rankedDocumentIds)),
    evidenceSetDigest: sha256(canonicalJson(observation.citationDocumentIds)),
    abstained: observation.abstained,
    latencyMs: observation.latencyMs,
    providerCostMinor: observation.providerCostMinor,
  }));
}

function textEmbeddingHash(document: { title: string; text: string }) {
  return sha256(
    canonicalJson({
      title: document.title.replaceAll("|", " ").trim() || "none",
      text: document.text.replaceAll("\0", "").trim(),
      purpose: "document",
    }),
  );
}

async function assertReportTargetAvailable(reportPath: string) {
  if (!path.isAbsolute(reportPath)) {
    throw new Error("LIVE_EVAL_REPORT_PATH_MUST_BE_ABSOLUTE");
  }
  try {
    await lstat(reportPath);
    throw new Error("LIVE_EVAL_REPORT_ALREADY_EXISTS");
  } catch (error) {
    const parsedError = filesystemErrorSchema.safeParse(error);
    const code = parsedError.success ? parsedError.data.code : null;
    if (code === "ENOENT") {
      const parent = await stat(path.dirname(reportPath));
      if (!parent.isDirectory())
        throw new Error("LIVE_EVAL_REPORT_PARENT_INVALID");
      return;
    }
    throw error;
  }
}

export function assertLiveEvaluationReportRedacted(
  serialized: string,
  sensitiveValues: readonly (string | undefined)[],
) {
  for (const sensitive of sensitiveValues) {
    if (sensitive && sensitive.length >= 16 && serialized.includes(sensitive)) {
      throw new Error("LIVE_EVAL_REPORT_REDACTION_FAILED");
    }
  }
}

export async function runLiveRetrievalEvaluation(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const manifestPath = required(environment, "PLAN036_EVAL_MANIFEST");
  const reportPath = required(environment, "PLAN036_EVAL_REPORT");
  if (!path.isAbsolute(manifestPath)) {
    throw new Error("LIVE_EVAL_MANIFEST_PATH_MUST_BE_ABSOLUTE");
  }
  await assertReportTargetAvailable(reportPath);
  const dimensions = embeddingDimensions(environment);
  const retrievalLimit = boundedInteger(
    environment,
    "PLAN036_EVAL_RETRIEVAL_LIMIT",
    20,
    100,
  );
  const evidenceLimit = boundedInteger(
    environment,
    "PLAN036_EVAL_EVIDENCE_LIMIT",
    1,
    10,
  );
  const consent = exactConsent(environment);
  const geminiApiKey = required(environment, "GEMINI_API_KEY");
  const geminiModelRevision = revision(
    environment,
    "PLAN036_EVAL_GEMINI_MODEL_REVISION",
  );
  const loaded = await loadLiveEvaluationManifest(manifestPath);
  assertLiveCorpusCoverage(loaded.manifest);
  const signal = operationSignal(environment);
  const reranker = buildReranker(environment);
  const rerankWindow = boundedInteger(
    environment,
    "PLAN036_EVAL_RERANK_WINDOW",
    20,
    Math.min(128, reranker.descriptor().maximumCandidates),
  );
  const abstentionScoreThreshold = boundedNumber(
    environment,
    "PLAN036_EVAL_ABSTENTION_SCORE_THRESHOLD",
    0,
    1,
  );
  const media = await loadMedia(loaded.manifest, loaded.manifestDirectory);
  const mediaByHandle = new Map(
    media.map((entry) => [entry.input.opaqueFileHandle, entry.resolved]),
  );
  const embedding = new GeminiEmbeddingProvider({
    apiKey: geminiApiKey,
    dimensions,
    modelRevision: geminiModelRevision,
    resolveMedia: async (input) => {
      signal.throwIfAborted();
      const resolved = mediaByHandle.get(input.opaqueFileHandle);
      if (!resolved) throw new Error("LIVE_EVAL_MEDIA_HANDLE_UNKNOWN");
      return resolved;
    },
  });
  const startedAt = new Date().toISOString();
  const indexingStarted = Date.now();
  const indexingUsage: UsageCounter = { known: true, inputTokens: 0 };
  const vectorByTextHash = new Map<string, readonly number[]>();
  const textDocumentsByHash = new Map<string, TextEmbeddingInput>();
  for (const document of loaded.manifest.documents) {
    const contentHash = textEmbeddingHash(document);
    if (!textDocumentsByHash.has(contentHash)) {
      textDocumentsByHash.set(contentHash, {
        contentHash,
        text: document.text,
        title: document.title,
        purpose: "document",
      });
    }
  }
  for (const batch of batchTextEmbeddingInputs([
    ...textDocumentsByHash.values(),
  ])) {
    signal.throwIfAborted();
    const vectors = await embedding.embedText(batch, {
      operationId: randomUUID(),
      signal,
      consent,
    });
    observeUsage(indexingUsage, vectors[0]);
    for (const vector of vectors)
      vectorByTextHash.set(vector.contentHash, vector.values);
  }
  const vectorByMediaHash = new Map<string, readonly number[]>();
  const uniqueMedia = new Map<string, LoadedMedia>();
  for (const entry of media) {
    const prior = uniqueMedia.get(entry.digest);
    if (
      prior &&
      (prior.input.mediaType !== entry.input.mediaType ||
        prior.input.modality !== entry.input.modality)
    ) {
      throw new Error("LIVE_EVAL_DUPLICATE_MEDIA_CONFIGURATION_CONFLICT");
    }
    if (!prior) uniqueMedia.set(entry.digest, entry);
  }
  const uniqueMediaRows = [...uniqueMedia.values()];
  for (
    let offset = 0;
    offset < uniqueMediaRows.length;
    offset += MEDIA_BATCH_ITEMS
  ) {
    signal.throwIfAborted();
    const rows = uniqueMediaRows.slice(offset, offset + MEDIA_BATCH_ITEMS);
    const vectors = await embedding.embedMedia!(
      rows.map((entry) => entry.input),
      { operationId: randomUUID(), signal, consent },
    );
    for (const vector of vectors) {
      observeUsage(indexingUsage, vector);
      vectorByMediaHash.set(vector.contentHash, vector.values);
    }
  }
  const mediaDigestByDocument = new Map(
    media.map((entry) => [entry.documentId, entry.digest]),
  );
  const denseDocuments = loaded.manifest.documents.map((document) => {
    const textVector = vectorByTextHash.get(textEmbeddingHash(document));
    if (!textVector) throw new Error("LIVE_EVAL_DOCUMENT_VECTOR_MISSING");
    const mediaDigest = mediaDigestByDocument.get(document.id);
    const mediaVector = mediaDigest
      ? vectorByMediaHash.get(mediaDigest)
      : undefined;
    if (mediaDigest && !mediaVector) {
      throw new Error("LIVE_EVAL_MEDIA_VECTOR_MISSING");
    }
    return {
      id: document.id,
      vectors: mediaVector ? [textVector, mediaVector] : [textVector],
    };
  });
  const textOnlyDenseDocuments = loaded.manifest.documents.map((document) => {
    const textVector = vectorByTextHash.get(textEmbeddingHash(document));
    if (!textVector) throw new Error("LIVE_EVAL_DOCUMENT_VECTOR_MISSING");
    return { id: document.id, vectors: [textVector] };
  });
  const indexingLatencyMs = Date.now() - indexingStarted;
  const observations: RetrievalEvaluationObservation[] = [];
  const emptyObservations = (): RetrievalEvaluationObservation[] => [];
  const ablationObservations = {
    "lexical-bm25": emptyObservations(),
    "dense-text": emptyObservations(),
    "dense-multimodal": emptyObservations(),
    "rrf-multimodal": emptyObservations(),
    "rrf-multimodal-reranked": emptyObservations(),
  } satisfies Record<LiveAblation, RetrievalEvaluationObservation[]>;
  const queryUsage: UsageCounter = { known: true, inputTokens: 0 };
  const geminiRate = optionalRate(
    environment,
    "PLAN036_EVAL_GEMINI_COST_MINOR_PER_MILLION_INPUT_TOKENS",
  );
  const rerankRate = optionalRate(
    environment,
    "PLAN036_EVAL_RERANK_COST_MINOR_PER_REQUEST",
  );
  const rawPricingRevision =
    environment.PLAN036_EVAL_PRICING_REVISION?.trim() || null;
  const pricingRevision = rawPricingRevision
    ? revision(environment, "PLAN036_EVAL_PRICING_REVISION")
    : null;
  const costCurrency = environment.PLAN036_EVAL_COST_CURRENCY?.trim() || null;
  if (
    (costCurrency && !/^[A-Z]{3}$/u.test(costCurrency)) ||
    (pricingRevision && pricingRevision.length > 128)
  ) {
    throw new Error("LIVE_EVAL_PRICING_METADATA_INVALID");
  }
  if (
    (geminiRate !== null || rerankRate !== null) &&
    (!pricingRevision || !costCurrency)
  ) {
    throw new Error("LIVE_EVAL_PRICING_METADATA_REQUIRED");
  }
  for (const query of loaded.manifest.queries) {
    signal.throwIfAborted();
    const queryStarted = Date.now();
    const lexical = rankDocumentsWithBm25(
      query.query,
      loaded.manifest.documents,
    );
    const lexicalRanking = lexical.map((entry) => entry.id);
    const lexicalLatencyMs = Date.now() - queryStarted;
    const [queryEmbedding] = await embedding.embedText(
      [
        {
          contentHash: sha256(query.query),
          text: query.query,
          purpose: "query",
        },
      ],
      { operationId: randomUUID(), signal, consent },
    );
    if (!queryEmbedding) throw new Error("LIVE_EVAL_QUERY_VECTOR_MISSING");
    const perQueryUsage: UsageCounter = { known: true, inputTokens: 0 };
    observeUsage(perQueryUsage, queryEmbedding);
    observeUsage(queryUsage, queryEmbedding);
    const denseText = rankDenseDocuments(
      queryEmbedding.values,
      textOnlyDenseDocuments,
    );
    const dense = rankDenseDocuments(queryEmbedding.values, denseDocuments);
    const denseTextRanking = denseText.map((entry) => entry.id);
    const denseRanking = dense.map((entry) => entry.id);
    const denseLatencyMs = Date.now() - queryStarted;
    const documentById = new Map(
      loaded.manifest.documents.map((document) => [document.id, document]),
    );
    const fused = reciprocalRankFusion({
      lexical: lexical.slice(0, retrievalLimit).map((entry) => ({
        sourceId: documentById.get(entry.id)!.sourceId,
        versionId: loaded.manifest.corpusRevision,
        chunkId: entry.id,
      })),
      vector: dense.slice(0, retrievalLimit).map((entry) => ({
        sourceId: documentById.get(entry.id)!.sourceId,
        versionId: loaded.manifest.corpusRevision,
        chunkId: entry.id,
      })),
    });
    const fusedRanking = fused.map((entry) => entry.chunkId);
    const fusionLatencyMs = Date.now() - queryStarted;
    const rerankIds = fused
      .slice(0, rerankWindow)
      .map((entry) => entry.chunkId);
    if (rerankIds.length < 1) throw new Error("LIVE_EVAL_EMPTY_RERANK_WINDOW");
    const scores = await reranker.rerank({
      operationId: randomUUID(),
      query: query.query,
      candidates: rerankIds.map((id) => {
        const document = documentById.get(id)!;
        return {
          id,
          text: document.text,
          tokenEstimate: Math.ceil(utf8.encode(document.text).byteLength / 3),
        };
      }),
      topN: rerankIds.length,
      signal,
    });
    const reranked = orderRerankedDocumentIds({
      candidateIds: rerankIds,
      scores,
    });
    const topScore = scores.find((score) => score.rank === 0)?.score;
    if (topScore === undefined || topScore < 0 || topScore > 1) {
      throw new Error("LIVE_EVAL_RERANK_SCORE_OUT_OF_RANGE");
    }
    const abstained = topScore < abstentionScoreThreshold;
    const rerankedSet = new Set(reranked);
    const finalRanking = [
      ...reranked,
      ...fused
        .map((entry) => entry.chunkId)
        .filter((id) => !rerankedSet.has(id)),
    ];
    const embeddingCost = costForTokens(perQueryUsage, geminiRate);
    const providerCostMinor =
      embeddingCost === null || rerankRate === null
        ? null
        : embeddingCost + rerankRate;
    const finalObservation = {
      queryId: query.id,
      rankedDocumentIds: finalRanking,
      // This gate evaluates retrieval, not answer generation. The selected
      // evidence set is therefore reported explicitly as a proxy below.
      citationDocumentIds: abstained
        ? []
        : finalRanking.slice(0, evidenceLimit),
      abstained,
      latencyMs: Date.now() - queryStarted,
      providerCostMinor,
    } satisfies RetrievalEvaluationObservation;
    observations.push(finalObservation);
    const proxy = (
      rankedDocumentIds: readonly string[],
      latencyMs: number,
      cost: number | null,
    ): RetrievalEvaluationObservation => ({
      queryId: query.id,
      rankedDocumentIds,
      citationDocumentIds: rankedDocumentIds.slice(0, evidenceLimit),
      abstained: rankedDocumentIds.length === 0,
      latencyMs,
      providerCostMinor: cost,
    });
    ablationObservations["lexical-bm25"].push(
      proxy(lexicalRanking, lexicalLatencyMs, 0),
    );
    ablationObservations["dense-text"].push(
      proxy(denseTextRanking, denseLatencyMs, embeddingCost),
    );
    ablationObservations["dense-multimodal"].push(
      proxy(denseRanking, denseLatencyMs, embeddingCost),
    );
    ablationObservations["rrf-multimodal"].push(
      proxy(fusedRanking, fusionLatencyMs, embeddingCost),
    );
    ablationObservations["rrf-multimodal-reranked"].push(finalObservation);
  }
  const metrics = evaluateObservedRankings({
    documents: loaded.manifest.documents,
    queries: loaded.manifest.queries,
    observations,
  });
  const mediaDigests = media.map((entry) => ({
    documentIdDigest: sha256(entry.documentId),
    mediaDigest: entry.digest,
    byteLength: entry.resolved.bytes.byteLength,
    modality: entry.input.modality,
    locatorDigest: sha256(canonicalJson(entry.input.locator)),
  }));
  const corpusDigest = sha256(
    canonicalJson({
      schemaRevision: loaded.manifest.schemaRevision,
      corpusRevision: loaded.manifest.corpusRevision,
      documents: loaded.manifest.documents.map((document) => ({
        id: document.id,
        sourceId: document.sourceId,
        titleDigest: sha256(document.title),
        textDigest: sha256(document.text),
        modality: document.modality,
        locator: document.locator,
        mediaDigest: mediaDigestByDocument.get(document.id) ?? null,
      })),
    }),
  );
  const labelDigest = sha256(
    canonicalJson({
      queries: loaded.manifest.queries.map((query) => ({
        id: query.id,
        queryDigest: sha256(query.query),
        answerable: query.answerable,
        relevance: query.relevance,
      })),
      qualityGate: loaded.manifest.qualityGate,
    }),
  );
  const indexingCostMinor = costForTokens(indexingUsage, geminiRate);
  const ablations = LIVE_ABLATIONS.map((configuration) => ({
    configuration,
    metrics: evaluateObservedRankings({
      documents: loaded.manifest.documents,
      queries: loaded.manifest.queries,
      observations: ablationObservations[configuration],
    }),
    observations: reportDigestRows(ablationObservations[configuration]),
  }));
  const lexicalMetrics = ablations.find(
    (entry) => entry.configuration === "lexical-bm25",
  )!.metrics;
  const qualityGate = evaluateLiveQualityGate({
    final: metrics,
    lexical: lexicalMetrics,
    thresholds: loaded.manifest.qualityGate,
  });
  const report = {
    schemaRevision: LIVE_EVALUATION_SCHEMA_REVISION,
    evidenceClass: "live-provider-labelled-corpus" as const,
    answerGeneration: "not-run" as const,
    citationMetricSemantics: "top-k-retrieved-evidence-proxy" as const,
    runId: randomUUID(),
    startedAt,
    completedAt: new Date().toISOString(),
    manifest: {
      schemaRevision: loaded.manifest.schemaRevision,
      corpusRevision: loaded.manifest.corpusRevision,
      labelRevision: loaded.manifest.labelRevision,
      reviewedAt: loaded.manifest.reviewedAt,
      language: loaded.manifest.language,
      licenseDigest: sha256(loaded.manifest.license),
      manifestFileDigest: loaded.manifestFileDigest,
      corpusDigest,
      labelDigest,
      documentCount: loaded.manifest.documents.length,
      queryCount: loaded.manifest.queries.length,
      mediaCount: media.length,
      mediaDigests,
    },
    pipeline: {
      lexical: {
        id: "bm25-french-nfkc-v1",
        k1: 1.2,
        b: 0.75,
      },
      embedding: embedding.descriptor(),
      fusion: {
        id: "weighted-rrf-k60-v1",
        lexicalWeight: 1,
        vectorWeight: 1,
        k: 60,
      },
      reranker: reranker.descriptor(),
      retrievalLimit,
      rerankWindow,
      evidenceLimit,
      abstentionScoreThreshold,
      configurationDigest: sha256(
        canonicalJson({
          embedding: embedding.descriptor(),
          reranker: reranker.descriptor(),
          retrievalLimit,
          rerankWindow,
          evidenceLimit,
          abstentionScoreThreshold,
        }),
      ),
    },
    performance: {
      indexingLatencyMs,
      queryP50LatencyMs: metrics.p50LatencyMs,
      queryP95LatencyMs: metrics.p95LatencyMs,
    },
    usage: {
      indexingInputTokens: indexingUsage.known
        ? indexingUsage.inputTokens
        : null,
      queryInputTokens: queryUsage.known ? queryUsage.inputTokens : null,
    },
    cost: {
      currency: costCurrency,
      indexingProviderCostMinor: indexingCostMinor,
      queryProviderCostMinor: metrics.totalProviderCostMinor,
      costKnown:
        indexingCostMinor !== null && metrics.totalProviderCostMinor !== null,
      pricingRevision,
    },
    metrics,
    qualityGate,
    ablations,
    observations: reportDigestRows(observations),
  };
  const serialized = `${JSON.stringify(report, null, 2)}\n`;
  assertLiveEvaluationReportRedacted(serialized, [
    ...loaded.manifest.documents.flatMap((document) => [
      document.title,
      document.text,
      document.media?.path,
    ]),
    ...loaded.manifest.queries.map((query) => query.query),
    environment.GEMINI_API_KEY,
    environment.COHERE_API_KEY,
  ]);
  await writeFile(reportPath, serialized, {
    encoding: "utf8",
    flag: "wx",
  });
  if (!qualityGate.passed) {
    throw new Error("LIVE_EVAL_QUALITY_GATE_FAILED");
  }
  return report;
}
