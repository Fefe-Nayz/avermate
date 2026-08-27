import type {
  EmbeddingSpaceDescriptor,
  RerankSpaceDescriptor,
  RetrievalFallbackPolicy,
} from "@avermate/agent-contracts";

export type ProjectRetrievalMode = "lexical-only" | "advanced-auto";

export type ProjectRetrievalPolicyReason =
  | "lexical-unavailable"
  | "embedding-configuration-incomplete"
  | "embedding-credential-required"
  | "embedding-consent-required"
  | "embedding-runtime-unavailable"
  | "vector-index-unavailable"
  | "embedding-source-placement-unsupported"
  | "embedding-space-required"
  | "embedding-space-incompatible"
  | "embedding-reindex-required"
  | "rerank-configuration-incomplete"
  | "rerank-credential-required"
  | "rerank-consent-required"
  | "rerank-runtime-unavailable"
  | "rerank-space-required"
  | "rerank-space-incompatible";

export type ProjectRetrievalPolicyConfiguration = {
  projectId: string;
  revision: number;
  retrievalMode: ProjectRetrievalMode;
  fallbackPolicy: RetrievalFallbackPolicy;
  embeddingSpaceId: string | null;
  rerankSpaceId: string | null;
};

export type ProjectRetrievalPolicyEnvironment = {
  lexical: {
    available: boolean;
    implementation: string;
  };
  embedding: {
    configurationReady: boolean;
    provider: string | null;
    placement: string | null;
    sendsSourceContentToThirdParties: boolean;
    credentialReady: boolean;
    consentRequired: boolean;
    consentReady: boolean;
    runtimeReady: boolean;
    vectorAvailable: boolean;
    vectorImplementation: string;
    compatibleSpace:
      (EmbeddingSpaceDescriptor & { registered: boolean }) | null;
  };
  rerank: {
    configurationReady: boolean;
    provider: string | null;
    placement: string | null;
    credentialReady: boolean;
    consentRequired: boolean;
    consentReady: boolean;
    runtimeReady: boolean;
    compatibleSpace: RerankSpaceDescriptor | null;
  };
  generation: {
    id: string | null;
    state: "active" | null;
    eligibleVersionCount: number;
    indexedVersionCount: number;
    unsupportedVersionCount: number;
  };
};

function advancedReasons(
  configured: ProjectRetrievalPolicyConfiguration,
  environment: ProjectRetrievalPolicyEnvironment,
) {
  const reasons: ProjectRetrievalPolicyReason[] = [];
  if (!environment.lexical.available) reasons.push("lexical-unavailable");

  const embedding = environment.embedding;
  // Before the first immutable generation exists there is no collection to
  // probe yet. That is a rebuild-required bootstrap state, not evidence that
  // the configured vector backend is down.
  const vectorBootstrap = environment.generation.id === null;
  if (!embedding.configurationReady) {
    reasons.push("embedding-configuration-incomplete");
  }
  if (!embedding.credentialReady) reasons.push("embedding-credential-required");
  if (embedding.consentRequired && !embedding.consentReady) {
    reasons.push("embedding-consent-required");
  }
  if (!embedding.runtimeReady) reasons.push("embedding-runtime-unavailable");
  if (!embedding.vectorAvailable && !vectorBootstrap) {
    reasons.push("vector-index-unavailable");
  }
  if (environment.generation.unsupportedVersionCount > 0) {
    reasons.push("embedding-source-placement-unsupported");
  }
  if (!configured.embeddingSpaceId) {
    reasons.push("embedding-space-required");
  } else if (
    !embedding.compatibleSpace ||
    configured.embeddingSpaceId !== embedding.compatibleSpace.id
  ) {
    reasons.push("embedding-space-incompatible");
  }

  const generation = environment.generation;
  const generationReady =
    generation.state === "active" &&
    generation.indexedVersionCount === generation.eligibleVersionCount;
  if (
    embedding.runtimeReady &&
    (embedding.vectorAvailable || vectorBootstrap) &&
    embedding.compatibleSpace &&
    configured.embeddingSpaceId === embedding.compatibleSpace.id &&
    !generationReady
  ) {
    reasons.push("embedding-reindex-required");
  }

  const rerank = environment.rerank;
  if (!rerank.configurationReady) {
    reasons.push("rerank-configuration-incomplete");
  }
  if (!rerank.credentialReady) reasons.push("rerank-credential-required");
  if (rerank.consentRequired && !rerank.consentReady) {
    reasons.push("rerank-consent-required");
  }
  if (!rerank.runtimeReady) reasons.push("rerank-runtime-unavailable");
  if (!configured.rerankSpaceId) {
    reasons.push("rerank-space-required");
  } else if (
    !rerank.compatibleSpace ||
    configured.rerankSpaceId !== rerank.compatibleSpace.id
  ) {
    reasons.push("rerank-space-incompatible");
  }
  return [...new Set(reasons)];
}

export function deriveProjectRetrievalPolicyState(
  configured: ProjectRetrievalPolicyConfiguration,
  environment: ProjectRetrievalPolicyEnvironment,
) {
  const vectorBootstrap = environment.generation.id === null;
  const reasons =
    configured.retrievalMode === "advanced-auto"
      ? advancedReasons(configured, environment)
      : environment.lexical.available
        ? []
        : (["lexical-unavailable"] satisfies ProjectRetrievalPolicyReason[]);
  const reindexRequired = reasons.includes("embedding-reindex-required");
  const denseReady =
    !reasons.some(
      (reason) =>
        reason.startsWith("embedding-") ||
        reason === "vector-index-unavailable",
    ) && environment.lexical.available;
  const rerankReady = !reasons.some((reason) => reason.startsWith("rerank-"));
  const advancedReady =
    configured.retrievalMode === "advanced-auto" && denseReady && rerankReady;

  let effectiveMode: "lexical" | "hybrid" | "reranked" | "unavailable";
  if (configured.retrievalMode === "lexical-only") {
    effectiveMode = environment.lexical.available ? "lexical" : "unavailable";
  } else if (advancedReady) {
    effectiveMode = "reranked";
  } else if (
    configured.fallbackPolicy === "hybrid-without-rerank" &&
    denseReady
  ) {
    effectiveMode = "hybrid";
  } else if (
    configured.fallbackPolicy === "lexical-only" &&
    environment.lexical.available
  ) {
    effectiveMode = "lexical";
  } else {
    effectiveMode = "unavailable";
  }

  return {
    projectId: configured.projectId,
    revision: configured.revision,
    configured: {
      retrievalMode: configured.retrievalMode,
      fallbackPolicy: configured.fallbackPolicy,
      embeddingSpaceId: configured.embeddingSpaceId,
      rerankSpaceId: configured.rerankSpaceId,
    },
    status: reasons.length === 0 ? ("active" as const) : ("degraded" as const),
    effectiveMode,
    fallbackActive:
      configured.retrievalMode === "advanced-auto" && !advancedReady,
    reasons,
    lexical: environment.lexical,
    embedding: {
      configurationReady: environment.embedding.configurationReady,
      provider: environment.embedding.provider,
      placement: environment.embedding.placement,
      sendsSourceContentToThirdParties:
        environment.embedding.sendsSourceContentToThirdParties,
      credentialReady: environment.embedding.credentialReady,
      consentRequired: environment.embedding.consentRequired,
      consentReady: environment.embedding.consentReady,
      runtimeReady: environment.embedding.runtimeReady,
      vectorAvailable: environment.embedding.vectorAvailable,
      vectorImplementation: environment.embedding.vectorImplementation,
      selectedSpaceCompatible:
        configured.embeddingSpaceId !== null &&
        configured.embeddingSpaceId ===
          environment.embedding.compatibleSpace?.id,
      compatibleSpaces: environment.embedding.compatibleSpace
        ? [environment.embedding.compatibleSpace]
        : [],
    },
    rerank: {
      configurationReady: environment.rerank.configurationReady,
      provider: environment.rerank.provider,
      placement: environment.rerank.placement,
      credentialReady: environment.rerank.credentialReady,
      consentRequired: environment.rerank.consentRequired,
      consentReady: environment.rerank.consentReady,
      runtimeReady: environment.rerank.runtimeReady,
      selectedSpaceCompatible:
        configured.rerankSpaceId !== null &&
        configured.rerankSpaceId === environment.rerank.compatibleSpace?.id,
      compatibleSpaces: environment.rerank.compatibleSpace
        ? [environment.rerank.compatibleSpace]
        : [],
    },
    reindex: {
      required: reindexRequired,
      canReindex:
        environment.embedding.runtimeReady &&
        (environment.embedding.vectorAvailable || vectorBootstrap) &&
        environment.embedding.compatibleSpace !== null,
      eligibleVersionCount: environment.generation.eligibleVersionCount,
      indexedVersionCount: environment.generation.indexedVersionCount,
      unsupportedVersionCount: environment.generation.unsupportedVersionCount,
      generationId: environment.generation.id,
      generationState: environment.generation.state,
    },
  };
}
