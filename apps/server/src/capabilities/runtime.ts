import {
  capabilityPurposeSchema,
  type CapabilityKind,
} from "@avermate/agent-contracts";
import { env } from "../lib/env";
import { capabilityShadowDiagnostics } from "./shadow-diagnostics";

export type CapabilityExecutionMode = "legacy" | "shadow" | "registry";

const executionModes: Record<CapabilityKind, CapabilityExecutionMode> = {
  "speech.synthesize": env.CAPABILITY_TTS_EXECUTION,
  "speech.transcribe": env.CAPABILITY_STT_EXECUTION,
  "document.ocr": env.CAPABILITY_OCR_EXECUTION,
  "document.extract": env.CAPABILITY_DOCUMENT_EXTRACTION_EXECUTION,
  "rerank.score": env.CAPABILITY_RERANK_EXECUTION,
  "embedding.generate": env.CAPABILITY_EMBEDDING_EXECUTION,
  "language.generate": env.CAPABILITY_LANGUAGE_EXECUTION,
  // These capability families are not migrated in this vertical yet.
  "image.generate": "legacy",
  "video.generate": "legacy",
};

const executionModeEnvironmentKeys: Partial<Record<CapabilityKind, string>> = {
  "speech.synthesize": "CAPABILITY_TTS_EXECUTION",
  "speech.transcribe": "CAPABILITY_STT_EXECUTION",
  "document.ocr": "CAPABILITY_OCR_EXECUTION",
  "document.extract": "CAPABILITY_DOCUMENT_EXTRACTION_EXECUTION",
  "rerank.score": "CAPABILITY_RERANK_EXECUTION",
  "embedding.generate": "CAPABILITY_EMBEDDING_EXECUTION",
  "language.generate": "CAPABILITY_LANGUAGE_EXECUTION",
};

export function resolveCapabilityExecutionMode(input: {
  capability: CapabilityKind;
  configuredMode: CapabilityExecutionMode;
  masterShadow: boolean;
  explicitlyConfigured: boolean;
}): CapabilityExecutionMode {
  if (input.explicitlyConfigured || input.configuredMode !== "legacy") {
    return input.configuredMode;
  }
  return input.masterShadow ? "shadow" : "legacy";
}

export function capabilityExecutionMode(capability: CapabilityKind) {
  const environmentKey = executionModeEnvironmentKeys[capability];
  return resolveCapabilityExecutionMode({
    capability,
    configuredMode: executionModes[capability],
    masterShadow: env.CAPABILITY_REGISTRY_SHADOW,
    explicitlyConfigured: Boolean(
      environmentKey && process.env[environmentKey]?.trim(),
    ),
  });
}

export type CapabilityRouteSelection = {
  offeringId: string | null;
  routeKey: string | null;
  provider: string | null;
  modelId: string | null;
  reason: string;
};

export type CapabilityShadowObservation = {
  ownerId: string;
  capability: CapabilityKind;
  purpose: string;
  legacy: CapabilityRouteSelection | null;
  registry: CapabilityRouteSelection | null;
  match: boolean | null;
  safeErrorCode: "SHADOW_RESOLUTION_FAILED" | null;
};

export type CapabilityExecutionPath<T> = {
  execute(): Promise<T>;
  /** Route resolution only. This function must never dispatch a provider. */
  resolve?(): Promise<CapabilityRouteSelection>;
};

export type CapabilityStreamingPath<T> = {
  stream(): AsyncIterable<T>;
  /** Route resolution only. This function must never dispatch a provider. */
  resolve?(): Promise<CapabilityRouteSelection>;
};

type RuntimeDependencies = {
  modeFor?: (capability: CapabilityKind) => CapabilityExecutionMode;
  observeShadow?: (observation: CapabilityShadowObservation) => Promise<void>;
};

/**
 * Compatibility facade used while workflows move capability-by-capability.
 *
 * `shadow` resolves both routes and executes legacy once. `registry` executes
 * only the registry path; an unavailable/failed registry path never falls back
 * to legacy behind the user's policy.
 */
export class CapabilityRuntime {
  readonly #modeFor: NonNullable<RuntimeDependencies["modeFor"]>;
  readonly #observeShadow?: RuntimeDependencies["observeShadow"];

  constructor(dependencies: RuntimeDependencies = {}) {
    this.#modeFor = dependencies.modeFor ?? capabilityExecutionMode;
    this.#observeShadow = dependencies.observeShadow;
  }

  async invoke<T>(input: {
    ownerId: string;
    capability: CapabilityKind;
    purpose: string;
    legacy: CapabilityExecutionPath<T>;
    registry?: CapabilityExecutionPath<T>;
  }): Promise<T> {
    this.#validate(input);
    const mode = this.#modeFor(input.capability);
    if (mode === "legacy") return input.legacy.execute();
    if (mode === "registry") {
      if (!input.registry) {
        throw new Error(
          `CAPABILITY_REGISTRY_EXECUTOR_UNAVAILABLE:${input.capability}`,
        );
      }
      return input.registry.execute();
    }
    await this.#shadow(input);
    return input.legacy.execute();
  }

  async *stream<T>(input: {
    ownerId: string;
    capability: CapabilityKind;
    purpose: string;
    legacy: CapabilityStreamingPath<T>;
    registry?: CapabilityStreamingPath<T>;
  }): AsyncIterable<T> {
    this.#validate(input);
    const mode = this.#modeFor(input.capability);
    if (mode === "legacy") {
      yield* input.legacy.stream();
      return;
    }
    if (mode === "registry") {
      if (!input.registry) {
        throw new Error(
          `CAPABILITY_REGISTRY_EXECUTOR_UNAVAILABLE:${input.capability}`,
        );
      }
      yield* input.registry.stream();
      return;
    }
    await this.#shadow(input);
    yield* input.legacy.stream();
  }

  #validate(input: {
    ownerId: string;
    capability: CapabilityKind;
    purpose: string;
  }) {
    if (!input.ownerId.trim() || input.ownerId.length > 256) {
      throw new Error("CAPABILITY_OWNER_ID_INVALID");
    }
    capabilityPurposeSchema.parse(input.purpose);
  }

  async #shadow(input: {
    ownerId: string;
    capability: CapabilityKind;
    purpose: string;
    legacy: { resolve?(): Promise<CapabilityRouteSelection> };
    registry?: { resolve?(): Promise<CapabilityRouteSelection> };
  }) {
    let legacy: CapabilityRouteSelection | null = null;
    let registry: CapabilityRouteSelection | null = null;
    let safeErrorCode: CapabilityShadowObservation["safeErrorCode"] = null;
    try {
      [legacy, registry] = await Promise.all([
        input.legacy.resolve?.() ?? Promise.resolve(null),
        input.registry?.resolve?.() ?? Promise.resolve(null),
      ]);
    } catch {
      // Shadow telemetry is deliberately non-authoritative and cannot regress
      // the legacy execution path or leak provider diagnostics.
      safeErrorCode = "SHADOW_RESOLUTION_FAILED";
    }
    const observation: CapabilityShadowObservation = {
      ownerId: input.ownerId,
      capability: input.capability,
      purpose: input.purpose,
      legacy,
      registry,
      match:
        legacy && registry ? legacy.routeKey === registry.routeKey : null,
      safeErrorCode,
    };
    await this.#observeShadow?.(observation).catch(() => undefined);
  }
}

export const capabilityRuntime = new CapabilityRuntime({
  observeShadow: (observation) => capabilityShadowDiagnostics.record(observation),
});
