import {
  rerankRequestV1Schema,
  rerankResultV1Schema,
  type CapabilityOfferingSnapshot,
  type RerankProvider,
  type RerankSpaceDescriptor,
  type UnaryCapabilityAdapter,
} from "@avermate/agent-contracts";
import {
  CohereRerankProvider,
  type CohereRerankProviderOptions,
} from "../../search/rerank-providers";
import type { ProviderFetcher } from "../../search/provider-transport";
import type { CapabilityRegistryInvoker } from "../registry-invoker";
import { capabilityRuntime, type CapabilityRuntime } from "../runtime";

export const COHERE_RERANK_CAPABILITY_ADAPTER_REVISION =
  "cohere-rerank-v2/capability-v1";

function tokenEstimate(text: string) {
  return Math.ceil(new TextEncoder().encode(text).byteLength / 4);
}

/** One Cohere request under the executor's credential, consent and operation fences. */
export class CohereRerankCapabilityAdapter
  implements UnaryCapabilityAdapter<"rerank.score">
{
  readonly kind = "rerank.score" as const;

  constructor(
    private readonly offering: CapabilityOfferingSnapshot<"rerank.score">,
    private readonly providerFetch?: ProviderFetcher,
  ) {
    if (
      offering.adapterRevision !== COHERE_RERANK_CAPABILITY_ADAPTER_REVISION ||
      offering.provider !== "cohere" ||
      !["rerank-v4.0-pro", "rerank-v4.0-fast"].includes(offering.modelId)
    ) {
      throw new Error("RERANK_CAPABILITY_ADAPTER_DESCRIPTOR_MISMATCH");
    }
  }

  descriptor() {
    return this.offering;
  }

  async invoke(
    context: Parameters<UnaryCapabilityAdapter<"rerank.score">["invoke"]>[0],
    rawInput: Parameters<UnaryCapabilityAdapter<"rerank.score">["invoke"]>[1],
  ) {
    const input = rerankRequestV1Schema.parse(rawInput);
    const specification = this.offering.specification;
    if (
      input.candidates.length > specification.maxCandidates ||
      input.topK > input.candidates.length ||
      (this.offering.limits.maxBatchSize !== null &&
        input.candidates.length > this.offering.limits.maxBatchSize)
    ) {
      throw new Error("RERANK_CAPABILITY_CANDIDATE_LIMIT_EXCEEDED");
    }
    const candidates = input.candidates.map((candidate) => ({
      id: candidate.id,
      text: candidate.text,
      tokenEstimate: tokenEstimate(candidate.text),
    }));
    if (
      candidates.some(
        (candidate) =>
          candidate.tokenEstimate > specification.maxTokensPerCandidate,
      )
    ) {
      throw new Error("RERANK_CAPABILITY_TOKEN_LIMIT_EXCEEDED");
    }
    const credential = await context.credential("apiKey");
    if (!credential) throw new Error("RERANK_CAPABILITY_CREDENTIAL_UNAVAILABLE");
    const options: CohereRerankProviderOptions = {
      apiKey: credential.secret,
      model: this.offering.modelId as CohereRerankProviderOptions["model"],
      modelRevision: this.offering.modelRevision,
      authorize: context.authorize,
      deadlineMs: Math.max(
        1,
        Math.min(60_000, context.deadline.getTime() - Date.now()),
      ),
      ...(this.providerFetch ? { fetch: this.providerFetch } : {}),
    };
    const scores = await new CohereRerankProvider(options).rerank({
      operationId: context.operationId,
      query: input.query,
      candidates,
      topN: input.topK,
      signal: context.signal,
    });
    return rerankResultV1Schema.parse({
      schemaVersion: 1,
      scores: scores.map((score) => ({
        id: score.candidateId,
        score: score.score,
        rank: score.rank,
      })),
      usage: {
        version: 1,
        items: [
          {
            unit: "candidate",
            quantity: String(input.candidates.length),
            source: "measured",
          },
        ],
        cost: {
          amountMinor: null,
          currency: null,
          authoritative: false,
          pricingSnapshotId: null,
        },
      },
      providerMetadata: {
        provider: this.offering.provider,
        modelId: this.offering.modelId,
      },
    });
  }
}

type RegistryRerankInvoker = Pick<
  CapabilityRegistryInvoker,
  "invoke" | "resolve"
>;

/** Capability facade for legacy and authoritative registry rerank paths. */
export class CapabilityBackedRerankProvider implements RerankProvider {
  constructor(
    private readonly ownerId: string,
    private readonly legacyDelegate: RerankProvider | null,
    private readonly space: RerankSpaceDescriptor = legacyDelegate!.descriptor(),
    private readonly runtime: Pick<CapabilityRuntime, "invoke"> =
      capabilityRuntime,
    private readonly registry?: RegistryRerankInvoker,
  ) {}

  async #registry() {
    return (
      this.registry ??
      (await import("../registry-invoker")).capabilityRegistryInvoker
    );
  }

  descriptor() {
    return {
      ...this.space,
      languages: [...this.space.languages],
      modalities: [...this.space.modalities] as ["text"],
    };
  }

  rerank(input: Parameters<RerankProvider["rerank"]>[0]) {
    const descriptor = this.descriptor();
    const route = {
      offeringId: descriptor.id,
      routeKey: `${descriptor.provider}:${descriptor.model}@${descriptor.modelRevision}`,
      provider: descriptor.provider,
      modelId: descriptor.model,
      reason: "pinned-rerank-space",
    };
    const routeConstraint = {
      provider: descriptor.provider,
      modelId: descriptor.model,
      modelRevision: descriptor.modelRevision,
    };
    return this.runtime.invoke({
      ownerId: this.ownerId,
      capability: "rerank.score",
      purpose: "corpus.reranking",
      legacy: {
        resolve: async () => route,
        execute: async () => {
          if (!this.legacyDelegate) {
            throw new Error("RERANK_LEGACY_EXECUTOR_UNAVAILABLE");
          }
          return this.legacyDelegate.rerank(input);
        },
      },
      registry: {
        resolve: async () =>
          (await this.#registry()).resolve({
            ownerId: this.ownerId,
            capability: "rerank.score",
            purpose: "corpus.reranking",
            route: routeConstraint,
            requirements: {
              requiredFeatures: ["modality.text"],
              batchSize: input.candidates.length,
              inputBytes: new TextEncoder().encode(
                `${input.query}\n${input.candidates.map((entry) => entry.text).join("\n")}`,
              ).byteLength,
            },
          }),
        execute: async () => {
          const result = await (await this.#registry()).invoke({
            ownerId: this.ownerId,
            capability: "rerank.score",
            purpose: "corpus.reranking",
            request: {
              schemaVersion: 1,
              query: input.query,
              candidates: input.candidates.map(({ id, text }) => ({ id, text })),
              topK: input.topN,
            },
            idempotencyKey: `rerank:${input.operationId}`,
            route: routeConstraint,
            requirements: {
              requiredFeatures: ["modality.text"],
              batchSize: input.candidates.length,
            },
            signal: input.signal,
          });
          return result.scores.map((score) => ({
            operationId: input.operationId,
            candidateId: score.id,
            score: score.score,
            rank: score.rank,
          }));
        },
      },
    });
  }
}
