import type { RerankProvider } from "@avermate/agent-contracts";
import { resolveProviderServiceKey } from "../lib/service-keys";
import {
  createPairedNodeProviderFetcher,
  createPairedNodeRerankProvider,
} from "../node/services";
import {
  PairedNodeRerankProvider,
  reviewedQwen3TextRerankProfile,
} from "../node/paired-node-rerank-provider";
import {
  COHERE_RERANK_DISCLOSURE_REVISION,
  CohereRerankProvider,
  GTE_MULTILINGUAL_RERANK_MODEL,
  TeiRerankProvider,
} from "./rerank-providers";
import { loadRetrievalProviderConsent } from "./vector-runtime";

export type CorpusRerankConfiguration = {
  enabled: boolean;
  complete: boolean;
  provider: string | null;
  model: string | null;
  modelRevision: string | null;
  placement: "core" | "node" | null;
  baseUrl: string | null;
  nodeId: string | null;
  imageDigest: string | null;
  runtimeRevision: string | null;
  descriptorId: string | null;
  reason: "disabled" | "incomplete" | "configured";
};

function setting(value: string | undefined) {
  return value?.trim() || null;
}

export function corpusRerankConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
): CorpusRerankConfiguration {
  const enabled = environment.CORPUS_RERANK_ENABLED === "true";
  const provider = setting(environment.CORPUS_RERANK_PROVIDER);
  const model = setting(environment.CORPUS_RERANK_MODEL);
  const rawPlacement = setting(environment.CORPUS_RERANK_PLACEMENT);
  const placement =
    rawPlacement === "core" || rawPlacement === "node" ? rawPlacement : null;
  const baseUrl = setting(environment.CORPUS_RERANK_BASE_URL);
  const nodeId = setting(environment.CORPUS_RERANK_NODE_ID);
  const modelRevision = setting(environment.CORPUS_RERANK_MODEL_REVISION);
  const imageDigest = setting(environment.CORPUS_RERANK_IMAGE_DIGEST);
  const teiRevision = setting(environment.CORPUS_RERANK_TEI_REVISION);
  const runtimeRevision = setting(environment.CORPUS_RERANK_RUNTIME_REVISION);
  const supportedModel =
    provider === "cohere" &&
    (model === "rerank-v4.0-pro" || model === "rerank-v4.0-fast");
  const teiDescriptor = (() => {
    if (
      provider !== "tei" ||
      placement !== "node" ||
      model !== GTE_MULTILINGUAL_RERANK_MODEL ||
      !baseUrl ||
      !modelRevision ||
      !imageDigest ||
      !teiRevision
    ) {
      return null;
    }
    try {
      return new TeiRerankProvider({
        fetch: () => Promise.reject(new Error("descriptor-only")),
        baseUrl,
        modelRevision,
        imageDigest,
        teiRevision,
      }).descriptor();
    } catch {
      return null;
    }
  })();
  const cohereDescriptor =
    provider === "cohere" && supportedModel && modelRevision
      ? new CohereRerankProvider({
          apiKey: "descriptor-only-not-used",
          model: model as "rerank-v4.0-pro" | "rerank-v4.0-fast",
          modelRevision,
        }).descriptor()
      : null;
  const qwen3Descriptor = (() => {
    if (
      provider !== "qwen3" ||
      placement !== "node" ||
      model !== reviewedQwen3TextRerankProfile.model ||
      !baseUrl ||
      !modelRevision ||
      !imageDigest ||
      !runtimeRevision
    ) {
      return null;
    }
    try {
      return new PairedNodeRerankProvider({
        fetch: () => Promise.reject(new Error("descriptor-only")),
        baseUrl,
        provider: "qwen3",
        model,
        modelRevision,
        imageDigest,
        runtimeRevision,
      }).descriptor();
    } catch {
      return null;
    }
  })();
  const complete = Boolean(
    enabled &&
    provider &&
    model &&
    placement &&
    ((provider === "cohere" && placement === "core" && cohereDescriptor) ||
      teiDescriptor ||
      qwen3Descriptor),
  );
  return {
    enabled,
    complete,
    provider,
    model,
    modelRevision,
    placement,
    baseUrl,
    nodeId,
    imageDigest,
    runtimeRevision: runtimeRevision ?? teiRevision,
    descriptorId: complete
      ? (cohereDescriptor?.id ??
        teiDescriptor?.id ??
        qwen3Descriptor?.id ??
        null)
      : null,
    reason: !enabled ? "disabled" : complete ? "configured" : "incomplete",
  };
}

/**
 * Explicit browser-safe projection. Endpoint URLs, paired-node identities,
 * image digests and other operator topology stay server-side even when an
 * invalid optional configuration cannot construct a runtime descriptor.
 */
export function publicCorpusRerankConfiguration(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const configuration = corpusRerankConfiguration(environment);
  return {
    enabled: configuration.enabled,
    complete: configuration.complete,
    provider: configuration.provider,
    model: configuration.model,
    modelRevision: configuration.modelRevision,
    placement: configuration.placement,
    descriptorId: configuration.descriptorId,
    reason: configuration.reason,
  };
}

/** Core can construct only Cohere BYOK; TEI is injected by the paired Node. */
export async function createOwnedConfiguredRerankProvider(
  ownerId: string,
  environment: NodeJS.ProcessEnv = process.env,
  dependencies: {
    createNodeProvider?: typeof createPairedNodeRerankProvider;
    createNodeFetcher?: typeof createPairedNodeProviderFetcher;
    resolveServiceKey?: typeof resolveProviderServiceKey;
    loadConsent?: typeof loadRetrievalProviderConsent;
  } = {},
): Promise<RerankProvider | null> {
  const state = corpusRerankConfiguration(environment);
  if (!state.complete) return null;
  if (state.provider === "tei") {
    const fetcher = await (
      dependencies.createNodeFetcher ?? createPairedNodeProviderFetcher
    )({
      ownerId,
      ...(state.nodeId ? { nodeId: state.nodeId } : {}),
      purpose: "rerank",
    });
    return new TeiRerankProvider({
      fetch: fetcher,
      baseUrl: state.baseUrl!,
      modelRevision: state.modelRevision!,
      imageDigest: state.imageDigest!,
      teiRevision: state.runtimeRevision!,
    });
  }
  if (state.provider === "qwen3") {
    return (dependencies.createNodeProvider ?? createPairedNodeRerankProvider)({
      ownerId,
      ...(state.nodeId ? { nodeId: state.nodeId } : {}),
      baseUrl: state.baseUrl!,
      provider: state.provider,
      model: state.model!,
      modelRevision: state.modelRevision!,
      runtimeRevision: state.runtimeRevision!,
      imageDigest: state.imageDigest!,
    });
  }
  if (state.provider !== "cohere") return null;
  const resolveServiceKey =
    dependencies.resolveServiceKey ?? resolveProviderServiceKey;
  const loadConsent = dependencies.loadConsent ?? loadRetrievalProviderConsent;
  const [credential, consent] = await Promise.all([
    resolveServiceKey(ownerId, "inference", "cohere"),
    loadConsent(ownerId, "cohere", "rerank", COHERE_RERANK_DISCLOSURE_REVISION),
  ]);
  if (!credential || !consent) return null;
  if (credential.source !== "user") {
    throw new Error("COHERE_OPERATOR_KEY_REQUIRES_MANAGED_METERED_ROUTER");
  }
  return new CohereRerankProvider({
    apiKey: credential.key,
    model: state.model as "rerank-v4.0-pro" | "rerank-v4.0-fast",
    modelRevision: state.modelRevision!,
    authorize: async () => {
      const [currentCredential, currentConsent] = await Promise.all([
        resolveServiceKey(ownerId, "inference", "cohere"),
        loadConsent(
          ownerId,
          "cohere",
          "rerank",
          COHERE_RERANK_DISCLOSURE_REVISION,
        ),
      ]);
      if (!currentConsent) {
        throw new Error("COHERE_RERANK_EXPLICIT_CONSENT_REQUIRED");
      }
      if (
        !currentCredential ||
        currentCredential.source !== "user" ||
        currentCredential.invalidationToken !== credential.invalidationToken
      ) {
        throw new Error("COHERE_RERANK_CREDENTIAL_CHANGED");
      }
    },
  });
}
