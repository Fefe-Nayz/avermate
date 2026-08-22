import type {
  RerankCandidate,
  RerankProvider,
  RerankScore,
  RerankSpaceDescriptor,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";

type ProviderFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

const maximumResponseBytes = 2 * 1024 * 1024;
const maximumRequestBytes = 1024 * 1024;

function digest(input: unknown) {
  return createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
}

async function boundedJson(response: Response) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumResponseBytes) {
    throw new Error("NODE_RERANK_RESPONSE_TOO_LARGE");
  }
  const body = new Uint8Array(await response.arrayBuffer());
  if (body.byteLength > maximumResponseBytes) {
    throw new Error("NODE_RERANK_RESPONSE_TOO_LARGE");
  }
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body)) as unknown;
  } catch {
    throw new Error("NODE_RERANK_RESPONSE_INVALID");
  }
}

function exactRevision(value: string) {
  return /^[a-f0-9]{40,64}$/u.test(value);
}

export const reviewedQwen3TextRerankProfile = Object.freeze({
  provider: "qwen3",
  model: "Qwen/Qwen3-Reranker-0.6B",
  modelRevision: "e61197ed45024b0ed8a2d74b80b4d909f1255473",
  runtimeRevision: "sentence-transformers-5.4.0+transformers-4.57.3+torch-2.8.0",
  modalities: ["text"] as const,
  maximumCandidates: 128,
});

/**
 * Qwen3-VL is kept distinct from the text provider. The current RerankProvider
 * candidate contract accepts text only and the control lane cannot carry
 * bounded image/video object bodies, so this profile must not be advertised.
 */
export const reviewedQwen3VlProfiles = Object.freeze({
  embedding: {
    model: "Qwen/Qwen3-VL-Embedding-2B",
    modelRevision: "9f2f7e710d6d81056aa5c0a4f04764fec6bb7bda",
  },
  rerank: {
    model: "Qwen/Qwen3-VL-Reranker-2B",
    modelRevision: "4bd860ac4f15ad1897a214615cccc700f8f71818",
  },
  runtimeRevision: "qwen3-vl-worker-contract-pending-object-transfer-v1",
  modalities: ["text", "image", "video", "mixed"] as const,
  advertised: false,
  reason: "MULTIMODAL_OBJECT_TRANSFER_AND_PROVIDER_CONTRACT_NOT_CONFORMANT",
});

export class PairedNodeRerankProvider implements RerankProvider {
  readonly #descriptor: RerankSpaceDescriptor;
  readonly #endpoint: string;

  constructor(
    private readonly options: {
      fetch: ProviderFetcher;
      baseUrl: string;
      provider: "tei" | "qwen3";
      model: string;
      modelRevision: string;
      runtimeRevision: string;
      imageDigest: string;
      maximumCandidates?: number;
      maximumTokensPerCandidate?: number;
      deadlineMs?: number;
    },
  ) {
    const url = new URL(options.baseUrl);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    ) {
      throw new Error("NODE_RERANK_ENDPOINT_INVALID");
    }
    if (
      !exactRevision(options.modelRevision) ||
      !/^sha256:[a-f0-9]{64}$/u.test(options.imageDigest) ||
      !options.runtimeRevision.trim() ||
      /(?:^|[/:@._-])(latest|main|master|nightly|edge)(?:$|[/:@._-])/iu.test(
        options.runtimeRevision,
      )
    ) {
      throw new Error("NODE_RERANK_IMMUTABLE_PIN_REQUIRED");
    }
    const maximumCandidates = Math.min(options.maximumCandidates ?? 128, 128);
    const maximumTokensPerCandidate = Math.min(
      options.maximumTokensPerCandidate ?? 8_192,
      8_192,
    );
    this.#endpoint = `${url.toString().replace(/\/$/u, "")}/rerank`;
    const identity = {
      provider: options.provider,
      model: options.model,
      modelRevision: options.modelRevision,
      runtimeRevision: options.runtimeRevision,
      imageDigest: options.imageDigest,
      maximumCandidates,
      maximumTokensPerCandidate,
    };
    this.#descriptor = {
      id: `rerank_${digest(identity)}`,
      provider: options.provider,
      model: options.model,
      modelRevision: `${options.modelRevision}+${options.runtimeRevision}+${options.imageDigest}`,
      languages: ["multilingual"],
      modalities: ["text"],
      maximumCandidates,
      maximumTokensPerCandidate,
      scoreSemantics: "sigmoid-relevance",
      placement: "node",
      costUnit: "compute-token",
    };
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
  }): Promise<readonly RerankScore[]> {
    input.signal.throwIfAborted();
    if (
      !input.operationId ||
      input.operationId.length > 256 ||
      !input.query.trim() ||
      input.candidates.length < 1 ||
      input.candidates.length > this.#descriptor.maximumCandidates ||
      !Number.isSafeInteger(input.topN) ||
      input.topN < 1 ||
      input.topN > input.candidates.length
    ) {
      throw new Error("NODE_RERANK_INPUT_INVALID");
    }
    const candidateIds = new Set<string>();
    for (const candidate of input.candidates) {
      if (
        candidateIds.has(candidate.id) ||
        !candidate.text.trim() ||
        candidate.tokenEstimate > this.#descriptor.maximumTokensPerCandidate
      ) {
        throw new Error("NODE_RERANK_CANDIDATE_INVALID");
      }
      candidateIds.add(candidate.id);
    }
    const body = JSON.stringify({
      query: input.query,
      texts: input.candidates.map((candidate) => candidate.text),
      truncate: false,
      raw_scores: false,
      return_text: false,
    });
    if (new TextEncoder().encode(body).byteLength > maximumRequestBytes) {
      throw new Error("NODE_RERANK_REQUEST_TOO_LARGE");
    }
    const response = await this.options.fetch(this.#endpoint, {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body,
      signal: AbortSignal.any([
        input.signal,
        AbortSignal.timeout(Math.min(this.options.deadlineMs ?? 20_000, 60_000)),
      ]),
    });
    if (!response.ok) throw new Error(`NODE_RERANK_HTTP_${response.status}`);
    const payload = await boundedJson(response);
    const ranks =
      payload && typeof payload === "object"
        ? (payload as { ranks?: unknown }).ranks
        : null;
    if (!Array.isArray(ranks) || ranks.length !== input.candidates.length) {
      throw new Error("NODE_RERANK_RESULT_COUNT_MISMATCH");
    }
    const indices = new Set<number>();
    const scores = ranks.map((value, rank) => {
      if (!value || typeof value !== "object") {
        throw new Error("NODE_RERANK_RESULT_INVALID");
      }
      const index = Number((value as { index?: unknown }).index);
      const score = Number((value as { score?: unknown }).score);
      if (
        !Number.isSafeInteger(index) ||
        index < 0 ||
        index >= input.candidates.length ||
        indices.has(index) ||
        !Number.isFinite(score)
      ) {
        throw new Error("NODE_RERANK_RESULT_INVALID");
      }
      indices.add(index);
      return {
        operationId: input.operationId,
        candidateId: input.candidates[index]!.id,
        score,
        rank,
      };
    });
    return scores.slice(0, input.topN);
  }
}
