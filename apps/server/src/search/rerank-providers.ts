import type {
  RerankCandidate,
  RerankProvider,
  RerankScore,
  RerankSpaceDescriptor,
} from "@avermate/agent-contracts";
import { safeModelFetchResponse } from "../agent/model-endpoint-policy";
import {
  boundedProviderJson,
  providerSignal,
  redactedProviderHttpError,
  type ProviderFetcher,
  utf8Bytes,
} from "./provider-transport";
import { canonicalJson, sha256 } from "./values";

const COHERE_ORIGIN = "https://api.cohere.com";
const COHERE_ENDPOINT = `${COHERE_ORIGIN}/v2/rerank`;
const MAX_RERANK_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_CANDIDATE_BYTES = 32 * 1024;
const MAX_TOTAL_DOCUMENT_BYTES = 1024 * 1024;

export const COHERE_RERANK_DISCLOSURE_REVISION =
  "cohere-rerank-school-content/1";
export const GTE_MULTILINGUAL_RERANK_MODEL =
  "Alibaba-NLP/gte-multilingual-reranker-base";

function descriptor(input: Omit<RerankSpaceDescriptor, "id">) {
  return { id: `rerank_${sha256(canonicalJson(input))}`, ...input };
}

function validateInput(input: {
  operationId: string;
  query: string;
  candidates: readonly RerankCandidate[];
  topN: number;
}, maximumCandidates: number, maximumTokens: number) {
  if (!input.operationId.trim() || input.operationId.length > 256) {
    throw new Error("RERANK_INVALID_OPERATION_ID");
  }
  if (!input.query.trim() || utf8Bytes(input.query) > 16 * 1024) {
    throw new Error("RERANK_QUERY_LIMIT");
  }
  if (
    input.candidates.length < 1 ||
    input.candidates.length > maximumCandidates ||
    !Number.isSafeInteger(input.topN) ||
    input.topN < 1 ||
    input.topN > input.candidates.length
  ) {
    throw new Error("RERANK_CANDIDATE_LIMIT");
  }
  const ids = new Set<string>();
  let totalBytes = 0;
  for (const candidate of input.candidates) {
    if (ids.has(candidate.id)) throw new Error("RERANK_DUPLICATE_CANDIDATE_ID");
    ids.add(candidate.id);
    const bytes = utf8Bytes(candidate.text);
    totalBytes += bytes;
    if (
      bytes < 1 ||
      bytes > MAX_CANDIDATE_BYTES ||
      candidate.tokenEstimate > maximumTokens
    ) {
      throw new Error("RERANK_CANDIDATE_DOCUMENT_LIMIT");
    }
  }
  if (totalBytes > MAX_TOTAL_DOCUMENT_BYTES) {
    throw new Error("RERANK_TOTAL_PAYLOAD_LIMIT");
  }
}

function resultRows(value: unknown, key: "results" | "ranks") {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return null;
  const rows = (value as Record<string, unknown>)[key];
  return Array.isArray(rows) ? rows : null;
}

function scoresFromIndices(input: {
  operationId: string;
  candidates: readonly RerankCandidate[];
  rows: readonly unknown[];
  topN: number;
  scoreKey: "relevance_score" | "score";
  requireEveryCandidate: boolean;
}) {
  const expected = input.requireEveryCandidate
    ? input.candidates.length
    : input.topN;
  if (input.rows.length !== expected) {
    throw new Error("RERANK_RESULT_COUNT_MISMATCH");
  }
  const indices = new Set<number>();
  const scores: RerankScore[] = [];
  input.rows.forEach((raw, rank) => {
    if (!raw || typeof raw !== "object") {
      throw new Error("RERANK_MALFORMED_RESULT");
    }
    const row = raw as Record<string, unknown>;
    const index = Number(row.index);
    const score = Number(row[input.scoreKey]);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= input.candidates.length ||
      indices.has(index) ||
      !Number.isFinite(score)
    ) {
      throw new Error("RERANK_INVALID_OR_DUPLICATE_RESULT_INDEX");
    }
    indices.add(index);
    scores.push({
      operationId: input.operationId,
      candidateId: input.candidates[index]!.id,
      score,
      rank,
    });
  });
  if (input.requireEveryCandidate && indices.size !== input.candidates.length) {
    throw new Error("RERANK_MISSING_CANDIDATE_RESULT");
  }
  return scores.slice(0, input.topN);
}

export type CohereRerankProviderOptions = {
  apiKey: string;
  model: "rerank-v4.0-pro" | "rerank-v4.0-fast";
  modelRevision?: string;
  fetch?: ProviderFetcher;
  deadlineMs?: number;
};

export class CohereRerankProvider implements RerankProvider {
  readonly #descriptor: RerankSpaceDescriptor;
  readonly #fetch: ProviderFetcher;
  readonly #deadlineMs: number;

  constructor(private readonly options: CohereRerankProviderOptions) {
    if (!options.apiKey.trim()) throw new Error("COHERE_API_KEY_REQUIRED");
    this.#deadlineMs = Math.min(options.deadlineMs ?? 15_000, 60_000);
    this.#descriptor = descriptor({
      provider: "cohere",
      model: options.model,
      modelRevision: options.modelRevision ?? options.model,
      languages: ["multilingual"],
      modalities: ["text"],
      maximumCandidates: 1_000,
      maximumTokensPerCandidate: 4_096,
      scoreSemantics: "relevance-ordered",
      placement: "core",
      costUnit: "search-unit",
    });
    this.#fetch =
      options.fetch ??
      ((url, init) =>
        safeModelFetchResponse(url, {
          policy: { placement: "hosted-core", allowedOrigins: [COHERE_ORIGIN] },
          credential: {
            origin: COHERE_ORIGIN,
            headerName: "authorization",
            value: `Bearer ${options.apiKey}`,
          },
          method: init?.method,
          headers: init?.headers,
          body: init?.body,
          signal: init?.signal ?? undefined,
          maxResponseBytes: MAX_RERANK_RESPONSE_BYTES,
        }));
  }

  descriptor() {
    return { ...this.#descriptor, languages: [...this.#descriptor.languages] };
  }

  async rerank(input: {
    operationId: string;
    query: string;
    candidates: readonly RerankCandidate[];
    topN: number;
    signal: AbortSignal;
  }) {
    validateInput(
      input,
      this.#descriptor.maximumCandidates,
      this.#descriptor.maximumTokensPerCandidate,
    );
    input.signal.throwIfAborted();
    const response = await this.#fetch(COHERE_ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        query: input.query,
        documents: input.candidates.map((candidate) => candidate.text),
        top_n: input.topN,
        max_tokens_per_doc: this.#descriptor.maximumTokensPerCandidate,
      }),
      signal: providerSignal(input.signal, this.#deadlineMs),
    });
    if (!response.ok) throw redactedProviderHttpError("COHERE_RERANK", response);
    const body = await boundedProviderJson(response, MAX_RERANK_RESPONSE_BYTES);
    const rows = resultRows(body, "results");
    if (!rows) throw new Error("COHERE_RERANK_MALFORMED_RESPONSE");
    return scoresFromIndices({
      ...input,
      rows,
      scoreKey: "relevance_score",
      requireEveryCandidate: false,
    });
  }
}

export type TeiRerankProviderOptions = {
  /** Paired-node capability transport; direct Core-to-LAN fetch is forbidden. */
  fetch: ProviderFetcher;
  baseUrl: string;
  modelRevision: string;
  imageDigest: string;
  teiRevision: string;
  deadlineMs?: number;
};

function immutableRevision(value: string) {
  return /^[a-f0-9]{40,64}$/u.test(value);
}

/** Node-private TEI adapter pinned to the Apache-2.0 multilingual GTE model. */
export class TeiRerankProvider implements RerankProvider {
  readonly #descriptor: RerankSpaceDescriptor;
  readonly #endpoint: string;
  readonly #deadlineMs: number;

  constructor(private readonly options: TeiRerankProviderOptions) {
    const url = new URL(options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("TEI_RERANK_INVALID_NODE_ENDPOINT");
    }
    if (
      !immutableRevision(options.modelRevision) ||
      !immutableRevision(options.teiRevision) ||
      !/^sha256:[a-f0-9]{64}$/u.test(options.imageDigest)
    ) {
      throw new Error("TEI_RERANK_IMMUTABLE_PIN_REQUIRED");
    }
    this.#endpoint = `${url.toString().replace(/\/$/u, "")}/rerank`;
    this.#deadlineMs = Math.min(options.deadlineMs ?? 20_000, 60_000);
    this.#descriptor = descriptor({
      provider: "tei",
      model: GTE_MULTILINGUAL_RERANK_MODEL,
      modelRevision: `${options.modelRevision}+tei.${options.teiRevision}+${options.imageDigest}`,
      languages: ["multilingual"],
      modalities: ["text"],
      maximumCandidates: 128,
      maximumTokensPerCandidate: 8_192,
      scoreSemantics: "sigmoid-relevance",
      placement: "node",
      costUnit: "compute-token",
    });
  }

  descriptor() {
    return { ...this.#descriptor, languages: [...this.#descriptor.languages] };
  }

  async rerank(input: {
    operationId: string;
    query: string;
    candidates: readonly RerankCandidate[];
    topN: number;
    signal: AbortSignal;
  }) {
    validateInput(
      input,
      this.#descriptor.maximumCandidates,
      this.#descriptor.maximumTokensPerCandidate,
    );
    const response = await this.options.fetch(this.#endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        query: input.query,
        texts: input.candidates.map((candidate) => candidate.text),
        truncate: false,
        raw_scores: false,
        return_text: false,
      }),
      signal: providerSignal(input.signal, this.#deadlineMs),
    });
    if (!response.ok) throw redactedProviderHttpError("TEI_RERANK", response);
    const body = await boundedProviderJson(response, MAX_RERANK_RESPONSE_BYTES);
    const rows = resultRows(body, "ranks");
    if (!rows) throw new Error("TEI_RERANK_MALFORMED_RESPONSE");
    return scoresFromIndices({
      ...input,
      rows,
      scoreKey: "score",
      requireEveryCandidate: true,
    });
  }
}

export const qwen3RerankProfile = {
  model: "Qwen/Qwen3-Reranker-0.6B",
  advertised: false,
  reason:
    "purpose-built-worker-and-checked-in-transformers-scorer-parity-required",
} as const;

export class DisabledRerankProvider implements RerankProvider {
  descriptor(): RerankSpaceDescriptor {
    return descriptor({
      provider: "disabled",
      model: "none",
      modelRevision: "none",
      languages: ["none"],
      modalities: ["text"],
      maximumCandidates: 1,
      maximumTokensPerCandidate: 1,
      scoreSemantics: "relevance-ordered",
      placement: "core",
      costUnit: "none",
    });
  }

  async rerank(): Promise<readonly RerankScore[]> {
    throw new Error("RERANK_PROVIDER_DISABLED");
  }
}
