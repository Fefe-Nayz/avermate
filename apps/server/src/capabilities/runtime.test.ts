import { describe, expect, test } from "bun:test";
import {
  CapabilityRuntime,
  resolveCapabilityExecutionMode,
  type CapabilityShadowObservation,
} from "./runtime";

describe("CapabilityRuntime rollout facade", () => {
  test("master shadow only upgrades capabilities without an explicit override", () => {
    expect(
      resolveCapabilityExecutionMode({
        capability: "speech.synthesize",
        configuredMode: "legacy",
        masterShadow: true,
        explicitlyConfigured: false,
      }),
    ).toBe("shadow");
    expect(
      resolveCapabilityExecutionMode({
        capability: "speech.synthesize",
        configuredMode: "legacy",
        masterShadow: true,
        explicitlyConfigured: true,
      }),
    ).toBe("legacy");
    expect(
      resolveCapabilityExecutionMode({
        capability: "speech.synthesize",
        configuredMode: "registry",
        masterShadow: true,
        explicitlyConfigured: true,
      }),
    ).toBe("registry");
  });

  test("shadow resolves registry but executes the paid legacy path once", async () => {
    let legacyCalls = 0;
    let registryCalls = 0;
    const observations: CapabilityShadowObservation[] = [];
    const runtime = new CapabilityRuntime({
      modeFor: () => "shadow",
      observeShadow: async (observation) => {
        observations.push(observation);
      },
    });
    const result = await runtime.invoke({
      ownerId: "owner-1",
      capability: "speech.synthesize",
      purpose: "media.podcast-narration",
      legacy: {
        resolve: async () => ({
          offeringId: null,
          routeKey: "mistral:voxtral",
          provider: "mistral",
          modelId: "voxtral",
          reason: "legacy-env",
        }),
        execute: async () => {
          legacyCalls += 1;
          return "audio";
        },
      },
      registry: {
        resolve: async () => ({
          offeringId: "capoff-mistral",
          routeKey: "mistral:voxtral",
          provider: "mistral",
          modelId: "voxtral",
          reason: "registry-policy",
        }),
        execute: async () => {
          registryCalls += 1;
          return "second-paid-audio";
        },
      },
    });
    expect(result).toBe("audio");
    expect(legacyCalls).toBe(1);
    expect(registryCalls).toBe(0);
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ match: true });
  });

  test("registry failure is explicit and never falls back to legacy", async () => {
    let legacyCalls = 0;
    const runtime = new CapabilityRuntime({ modeFor: () => "registry" });
    await expect(
      runtime.invoke({
        ownerId: "owner-2",
        capability: "speech.transcribe",
        purpose: "recordings.course-transcription",
        legacy: {
          execute: async () => {
            legacyCalls += 1;
            return "legacy";
          },
        },
        registry: {
          execute: async () => {
            throw new Error("REGISTRY_ROUTE_FAILED");
          },
        },
      }),
    ).rejects.toThrow("REGISTRY_ROUTE_FAILED");
    expect(legacyCalls).toBe(0);
  });

  test("shadow resolution failures cannot change legacy execution", async () => {
    const observations: CapabilityShadowObservation[] = [];
    const runtime = new CapabilityRuntime({
      modeFor: () => "shadow",
      observeShadow: async (observation) => {
        observations.push(observation);
      },
    });
    await expect(
      runtime.invoke({
        ownerId: "owner-3",
        capability: "document.ocr",
        purpose: "materials.ocr",
        legacy: { execute: async () => "legacy-result" },
        registry: {
          resolve: async () => {
            throw new Error("do not expose registry internals");
          },
          execute: async () => "registry-result",
        },
      }),
    ).resolves.toBe("legacy-result");
    expect(observations[0]).toMatchObject({
      match: null,
      safeErrorCode: "SHADOW_RESOLUTION_FAILED",
    });
  });

  test("stream mode chooses one stream and never reads the other", async () => {
    let legacyReads = 0;
    let registryReads = 0;
    const runtime = new CapabilityRuntime({ modeFor: () => "registry" });
    const events: string[] = [];
    for await (const event of runtime.stream({
      ownerId: "owner-4",
      capability: "language.generate",
      purpose: "assistant.chat",
      legacy: {
        async *stream() {
          legacyReads += 1;
          yield "legacy";
        },
      },
      registry: {
        async *stream() {
          registryReads += 1;
          yield "registry";
        },
      },
    })) {
      events.push(event);
    }
    expect(events).toEqual(["registry"]);
    expect(legacyReads).toBe(0);
    expect(registryReads).toBe(1);
  });
});
