import { describe, expect, test } from "bun:test";
import type { ProviderPluginManifest } from "@avermate/agent-contracts";
import { z } from "zod";
import {
  ProviderPluginRegistry,
  createStaticProviderPluginRegistry,
} from "./plugin-registry";

const fixtureManifest: ProviderPluginManifest = {
  apiVersion: "avermate.provider-plugin/v1",
  id: "fixture.speech",
  version: "1.0.0",
  displayName: "Fixture speech",
  executionTrust: "core-reviewed",
  capabilities: ["speech.transcribe", "speech.synthesize"],
  connectionSchemaVersion: 1,
  configurationFields: [],
  secretSlots: [
    {
      name: "apiKey",
      required: true,
      kind: "api-key",
      validation: "format",
    },
  ],
};

describe("ProviderPluginRegistry", () => {
  test("catalogues every reviewed current and target provider", () => {
    const registry = createStaticProviderPluginRegistry();
    expect(registry.list().map((entry) => entry.manifest.id)).toEqual([
      "ai-sdk.deepgram",
      "ai-sdk.elevenlabs",
      "ai-sdk.google",
      "ai-sdk.openai",
      "avermate.cohere",
      "avermate.huggingface-inference",
      "avermate.litellm",
      "avermate.mistral",
      "avermate.native-document",
      "avermate.node",
      "avermate.openai-compatible",
      "avermate.openrouter",
    ]);
    expect(registry.catalogueDigest()).toMatch(/^sha256:[a-f0-9]{64}$/u);
    expect(registry.catalogueDigest()).toBe(registry.catalogueDigest());
    expect(registry.require("avermate.node").instantiate).toBeFunction();
  });

  test("accepts a new multi-capability compiled fixture without registry edits", () => {
    const registry = new ProviderPluginRegistry();
    registry.register({
      source: "compiled",
      manifest: fixtureManifest,
      connectionConfigSchema: z.strictObject({}),
    });
    expect(registry.require("fixture.speech").manifest.capabilities).toEqual([
      "speech.transcribe",
      "speech.synthesize",
    ]);
  });

  test("rejects duplicate IDs and repeated manifest entries", () => {
    const registry = new ProviderPluginRegistry();
    const factory = {
      source: "compiled" as const,
      manifest: fixtureManifest,
      connectionConfigSchema: z.strictObject({}),
    };
    registry.register(factory);
    expect(() => registry.register(factory)).toThrow("already registered");
    expect(() =>
      new ProviderPluginRegistry().register({
        ...factory,
        manifest: {
          ...fixtureManifest,
          capabilities: ["speech.transcribe", "speech.transcribe"],
        },
      }),
    ).toThrow("repeats a capability");
  });

  test("parses bounded plugin config and validates custom origins", async () => {
    const registry = createStaticProviderPluginRegistry();
    expect(() =>
      registry.parseConnectionConfig("avermate.openai-compatible", {
        origin: "https://models.example.com",
        providerOptions: { arbitrary: true },
      }),
    ).toThrow();

    const observed: string[] = [];
    const parsed = await registry.validateConnectionConfig({
      pluginId: "avermate.openai-compatible",
      placement: "hosted-core",
      config: {
        origin: "https://models.example.com",
        modelId: "fixture-embedding-v1",
      },
      validateOrigin: async ({ origin }) => {
        observed.push(origin);
      },
    });
    expect(parsed).toEqual({
      origin: "https://models.example.com",
      modelId: "fixture-embedding-v1",
    });
    expect(observed).toEqual(["https://models.example.com"]);
  });
});
