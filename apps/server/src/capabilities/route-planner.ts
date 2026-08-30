import {
  capabilityOfferingSchema,
  frozenCapabilityRoutePlanSchema,
  type CapabilityOffering,
  type FrozenCapabilityRoute,
  type FrozenCapabilityRoutePlan,
} from "@avermate/agent-contracts";
import type { ResolvedCapabilityPolicySnapshot } from "./policy-resolver";
import { capabilityRouteMetrics, type CapabilityRouteMetrics } from "./metrics";
import { capabilityDigest } from "./values";

const egressOrder = [
  "none",
  "owner-node",
  "avermate-managed",
  "external-provider",
] as const;

export type CapabilityRouteHealth = {
  state:
    | "unknown"
    | "validating"
    | "healthy"
    | "degraded"
    | "offline"
    | "unauthorized"
    | "disabled";
  latencyP50Ms: number | null;
};

export type CapabilityRouteRequirements = {
  requiredFeatures?: readonly string[];
  inputBytes?: number;
  outputBytes?: number;
  batchSize?: number;
  language?: string;
  voiceMode?: "exact" | "profile";
};

export type CapabilityCredentialReadiness = {
  ready: boolean;
  source: "user" | "managed" | "node-local" | "none";
  slots: Array<{ slot: string; expectedVersion: number }>;
};

export type CapabilityConsentReadiness = {
  ready: boolean;
  grants: Array<{ id: string; expectedRevision: number }>;
};

export class CapabilityRoutePlannerError extends Error {
  constructor(
    readonly code: "CAPABILITY_DISABLED" | "NO_COMPATIBLE_OFFERING",
    message: string,
  ) {
    super(message);
    this.name = "CapabilityRoutePlannerError";
  }
}

function featureSupported(offering: CapabilityOffering, feature: string) {
  switch (offering.capability) {
    case "language.generate": {
      const specification = (
        offering as Extract<
          CapabilityOffering,
          { capability: "language.generate" }
        >
      ).specification;
      if (feature === "tools") return specification.tools;
      if (feature === "parallel-tools") return specification.parallelTools;
      if (feature === "structured-output") return specification.structuredOutput;
      if (feature === "streaming") return specification.streaming;
      if (feature === "reasoning-summary") return specification.reasoningSummary;
      return feature.startsWith("modality.")
        ? specification.inputModalities.includes(
            feature.slice("modality.".length) as (typeof specification.inputModalities)[number],
          )
        : false;
    }
    case "embedding.generate": {
      const specification = (
        offering as Extract<
          CapabilityOffering,
          { capability: "embedding.generate" }
        >
      ).specification;
      return feature.startsWith("modality.")
        ? specification.modalities.includes(
            feature.slice("modality.".length) as (typeof specification.modalities)[number],
          )
        : false;
    }
    case "rerank.score": {
      const specification = (
        offering as Extract<CapabilityOffering, { capability: "rerank.score" }>
      ).specification;
      return feature.startsWith("modality.")
        ? specification.modalities.includes(
            feature.slice("modality.".length) as (typeof specification.modalities)[number],
          )
        : false;
    }
    case "speech.transcribe": {
      const specification = (
        offering as Extract<
          CapabilityOffering,
          { capability: "speech.transcribe" }
        >
      ).specification;
      if (feature === "diarization") return specification.diarization;
      if (feature === "language-detection") return specification.languageDetection;
      if (feature === "vocabulary-hints") return specification.vocabularyHints;
      if (feature.startsWith("timestamps.")) {
        return specification.timestamps.includes(
          feature.slice("timestamps.".length) as (typeof specification.timestamps)[number],
        );
      }
      return false;
    }
    case "speech.synthesize": {
      const specification = (
        offering as Extract<
          CapabilityOffering,
          { capability: "speech.synthesize" }
        >
      ).specification;
      if (feature === "streaming") return specification.streaming;
      if (feature === "speed-control") return specification.speedControl;
      if (feature === "pitch-control") return specification.pitchControl;
      if (feature === "style-control") return specification.styleControl;
      if (feature === "voice-cloning") return specification.voiceCloning;
      if (feature.startsWith("alignment.")) {
        return specification.alignment.includes(
          feature.slice("alignment.".length) as (typeof specification.alignment)[number],
        );
      }
      return false;
    }
    case "document.ocr": {
      const specification = (
        offering as Extract<CapabilityOffering, { capability: "document.ocr" }>
      ).specification;
      return (
        (feature === "native-pdf" && specification.nativePdf) ||
        (feature === "scanned-pdf" && specification.scannedPdf) ||
        (feature === "images" && specification.images) ||
        (feature === "handwriting" && specification.handwriting) ||
        (feature === "layout" && specification.layout) ||
        (feature === "tables" && specification.tables) ||
        (feature === "formulas" && specification.formulas) ||
        (feature === "embedded-images" && specification.embeddedImages)
      );
    }
    case "document.extract": {
      const specification = (
        offering as Extract<
          CapabilityOffering,
          { capability: "document.extract" }
        >
      ).specification;
      return (
        (feature === "deterministic" && specification.deterministic) ||
        (feature === "source-locators" && specification.preservesSourceLocators) ||
        (feature === "assets" && specification.supportsAssets)
      );
    }
    case "image.generate": {
      const specification = (
        offering as Extract<CapabilityOffering, { capability: "image.generate" }>
      ).specification;
      return feature.startsWith("modality.")
        ? specification.inputModalities.includes(
            feature.slice("modality.".length) as never,
          )
        : false;
    }
    case "video.generate": {
      const specification = (
        offering as Extract<CapabilityOffering, { capability: "video.generate" }>
      ).specification;
      return feature.startsWith("modality.")
        ? specification.inputModalities.includes(
            feature.slice("modality.".length) as never,
          )
        : false;
    }
  }
}

function deterministicScore(
  offering: CapabilityOffering,
  health: CapabilityRouteHealth,
  preferredLatency: "interactive" | "normal" | "batch",
  estimatedCostMinor: number | null,
) {
  const placement = {
    node: 50,
    "full-self-host": 45,
    core: 35,
    "direct-byok": 30,
    managed: 20,
  }[offering.placement.kind];
  const healthScore =
    health.state === "healthy"
      ? 30
      : health.state === "degraded"
        ? 5
        : health.state === "unknown"
          ? 0
          : -100;
  const latency =
    preferredLatency === "interactive" && health.latencyP50Ms !== null
      ? Math.max(-20, 20 - Math.floor(health.latencyP50Ms / 100))
      : 0;
  const cost = estimatedCostMinor === null ? 0 : Math.max(-30, -estimatedCostMinor);
  return placement + healthScore + latency + cost;
}

type EligibleRoute = {
  offering: CapabilityOffering;
  credentials: CapabilityCredentialReadiness;
  consent: CapabilityConsentReadiness;
  health: CapabilityRouteHealth;
  estimatedCostMinor: number | null;
  pricingSnapshotId: string | null;
  score: number;
};

export class CapabilityRoutePlanner {
  constructor(
    private readonly clock: () => Date = () => new Date(),
    private readonly metrics: CapabilityRouteMetrics = capabilityRouteMetrics,
  ) {}

  async plan(input: {
    operationId: string;
    ownerId: string;
    policy: ResolvedCapabilityPolicySnapshot;
    offerings: readonly CapabilityOffering[];
    requirements?: CapabilityRouteRequirements;
    credentialReadiness(offering: CapabilityOffering): Promise<CapabilityCredentialReadiness>;
    consentReadiness(offering: CapabilityOffering): Promise<CapabilityConsentReadiness>;
    health(offering: CapabilityOffering): Promise<CapabilityRouteHealth>;
    estimate?(offering: CapabilityOffering): Promise<{
      costMinor: number | null;
      pricingSnapshotId: string | null;
    }>;
  }): Promise<FrozenCapabilityRoutePlan> {
    if (input.policy.mode === "disabled") {
      throw new CapabilityRoutePlannerError(
        "CAPABILITY_DISABLED",
        "Capability is disabled by policy",
      );
    }
    const constraints = input.policy.constraints;
    const requiredFeatures = [
      ...new Set([
        ...constraints.requiredFeatures,
        ...(input.requirements?.requiredFeatures ?? []),
      ]),
    ];
    const preliminarilyEligible = input.offerings
      .map((offering) => capabilityOfferingSchema.parse(offering))
      .filter((offering) => offering.capability === input.policy.capability)
      .filter((offering) => offering.capabilityProtocolVersion === 1)
      .filter((offering) =>
        constraints.allowedPlacements.includes(offering.placement.kind),
      )
      .filter(
        (offering) =>
          constraints.allowedProviders === null ||
          constraints.allowedProviders.includes(offering.provider),
      )
      .filter((offering) => !constraints.deniedProviders.includes(offering.provider))
      .filter(
        (offering) =>
          egressOrder.indexOf(offering.dataHandling.egress) <=
          egressOrder.indexOf(constraints.maximumDataEgress),
      )
      .filter((offering) =>
        requiredFeatures.every((feature) => featureSupported(offering, feature)),
      )
      .filter(
        (offering) =>
          input.requirements?.inputBytes === undefined ||
          offering.limits.maxInputBytes === null ||
          input.requirements.inputBytes <= offering.limits.maxInputBytes,
      )
      .filter(
        (offering) =>
          input.requirements?.outputBytes === undefined ||
          offering.limits.maxOutputBytes === null ||
          input.requirements.outputBytes <= offering.limits.maxOutputBytes,
      )
      .filter(
        (offering) =>
          input.requirements?.batchSize === undefined ||
          offering.limits.maxBatchSize === null ||
          input.requirements.batchSize <= offering.limits.maxBatchSize,
      )
      .filter(
        (offering) =>
          !input.requirements?.language ||
          offering.supportedLanguages === "unknown" ||
          offering.supportedLanguages.includes(input.requirements.language),
      );

    const eligible: EligibleRoute[] = [];
    for (const offering of preliminarilyEligible) {
      const [credentials, consent, health, estimate] = await Promise.all([
        input.credentialReadiness(offering),
        input.consentReadiness(offering),
        input.health(offering),
        input.estimate?.(offering) ??
          Promise.resolve({ costMinor: null, pricingSnapshotId: null }),
      ]);
      if (!credentials.ready || !consent.ready) continue;
      if (["offline", "unauthorized", "disabled"].includes(health.state)) {
        continue;
      }
      if (
        constraints.requireUserCredential &&
        credentials.source !== "user" &&
        credentials.source !== "node-local"
      ) {
        continue;
      }
      if (
        !constraints.allowManagedCredential &&
        credentials.source === "managed"
      ) {
        continue;
      }
      if (constraints.requireHealthy && health.state !== "healthy") continue;
      if (
        constraints.maximumEstimatedCostMinor !== null &&
        estimate.costMinor !== null &&
        estimate.costMinor > constraints.maximumEstimatedCostMinor
      ) {
        continue;
      }
      eligible.push({
        offering,
        credentials,
        consent,
        health,
        estimatedCostMinor: estimate.costMinor,
        pricingSnapshotId: estimate.pricingSnapshotId,
        score: deterministicScore(
          offering,
          health,
          constraints.preferredLatencyClass,
          estimate.costMinor,
        ),
      });
    }

    const byId = new Map(eligible.map((candidate) => [candidate.offering.id, candidate]));
    let ordered: EligibleRoute[];
    if (input.policy.mode === "automatic") {
      ordered = [...eligible].sort(
        (left, right) =>
          right.score - left.score ||
          left.offering.provider.localeCompare(right.offering.provider) ||
          left.offering.modelId.localeCompare(right.offering.modelId) ||
          left.offering.id.localeCompare(right.offering.id),
      );
    } else {
      const configuredIds = [
        ...(input.policy.primaryOfferingId
          ? [input.policy.primaryOfferingId]
          : []),
        ...input.policy.fallbackOfferingIds,
      ];
      ordered = configuredIds.flatMap((id) => {
        const candidate = byId.get(id);
        return candidate ? [candidate] : [];
      });
    }
    if (input.policy.mode === "pinned") ordered = ordered.slice(0, 1);
    if (ordered.length === 0) {
      await this.metrics.emit({
        name: "capability_route_error_total",
        operationId: input.operationId,
        capability: input.policy.capability,
        outcome: "no-compatible-offering",
      });
      throw new CapabilityRoutePlannerError(
        "NO_COMPATIBLE_OFFERING",
        "No offering satisfies capability, privacy, credential, consent and health constraints",
      );
    }

    const primary = ordered[0]!;
    const primaryEgress = egressOrder.indexOf(primary.offering.dataHandling.egress);
    ordered = [
      primary,
      ...ordered.slice(1).filter((candidate) => {
        if (
          !constraints.allowPrivacyEscalationOnFallback &&
          egressOrder.indexOf(candidate.offering.dataHandling.egress) > primaryEgress
        ) {
          return false;
        }
        if (
          input.policy.capability === "embedding.generate" &&
          candidate.offering.capability === "embedding.generate" &&
          primary.offering.capability === "embedding.generate" &&
          candidate.offering.specification.embeddingSpaceId !==
            primary.offering.specification.embeddingSpaceId
        ) {
          return false;
        }
        if (
          input.policy.capability === "speech.synthesize" &&
          input.requirements?.voiceMode === "exact" &&
          candidate.offering.provider !== primary.offering.provider
        ) {
          return false;
        }
        return true;
      }),
    ];

    const frozen = ordered.map((candidate) => this.freeze(candidate));
    const payload = {
      version: 1 as const,
      operationId: input.operationId,
      ownerId: input.ownerId,
      capability: input.policy.capability,
      purpose: input.policy.purpose,
      policySnapshotDigest: input.policy.digest,
      primary: frozen[0]!,
      fallbacks: frozen.slice(1),
      constraints,
      createdAt: this.clock().toISOString(),
    };
    const plan = frozenCapabilityRoutePlanSchema.parse({
      ...payload,
      digest: capabilityDigest(payload),
    });
    await Promise.all([
      this.metrics.emit({
        name: "capability_route_planned_total",
        operationId: input.operationId,
        capability: input.policy.capability,
        value: ordered.length,
      }),
      this.metrics.emit({
        name: "capability_route_selected_total",
        operationId: input.operationId,
        capability: input.policy.capability,
        provider: primary.offering.provider,
        placement: primary.offering.placement.kind,
        outcome: "primary",
      }),
    ]);
    return plan;
  }

  private freeze(candidate: EligibleRoute): FrozenCapabilityRoute {
    const offering = candidate.offering;
    return {
      offeringId: offering.id,
      offeringDescriptorDigest: capabilityDigest(offering),
      connectionId: offering.connectionId,
      connectionRevision: offering.connectionRevision,
      credentialSlots: candidate.credentials.slots,
      consentGrants: candidate.consent.grants,
      pluginId: offering.pluginId,
      pluginVersion: offering.pluginVersion,
      adapterRevision: offering.adapterRevision,
      modelId: offering.modelId,
      modelRevision: offering.modelRevision,
      placement: offering.placement,
      dataEgress: offering.dataHandling.egress,
      pricingSnapshotId: candidate.pricingSnapshotId,
    };
  }
}
