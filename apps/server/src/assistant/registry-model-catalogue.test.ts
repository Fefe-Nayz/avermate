import { describe, expect, test } from "bun:test";
import {
  modelCapabilitySchema,
  modelPlacementSchema,
  type ProviderConnectionPublicSnapshot,
} from "@avermate/agent-contracts";
import {
  languageOffering,
  openAICompatibleWorkflowPluginManifest,
} from "../capabilities/providers/plugins";
import { CapabilityRuntime } from "../capabilities/runtime";
import type { CapabilityRegistryInvoker } from "../capabilities/registry-invoker";
import {
  registryAssistantModelKey,
  registryAssistantSelection,
  registryAssistantSelections,
} from "./registry-model-catalogue";
import { streamExplicitModelAttempts } from "./model-attempts";

function offering(connectionId = "connection-1") {
  const connection: ProviderConnectionPublicSnapshot = {
    schemaVersion: 1,
    id: connectionId,
    ownerKind: "user",
    ownerId: "owner-1",
    pluginId: openAICompatibleWorkflowPluginManifest.id,
    pluginVersion: "1.0.0",
    displayName: "My private proxy",
    placement: { kind: "direct-byok", origin: "https://proxy.example" },
    configVersion: 1,
    config: {},
    configDigest: `sha256:${"a".repeat(64)}`,
    status: "ready",
    revision: 2,
    lastValidatedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    deletedAt: null,
  };
  return languageOffering({
    connection,
    manifest: openAICompatibleWorkflowPluginManifest,
    provider: "new-custom-provider",
    providerName: "Custom endpoint",
    modelId: "previously-unknown-model",
    modelRevision: "pinned-r1",
    contextWindow: 32_000,
    maximumOutputTokens: 2_000,
    tools: false,
    inputModalities: ["text"],
  });
}

describe("registry-authoritative assistant model catalogue", () => {
  test("selects an unknown provider model and freezes its exact connection offering", async () => {
    const first = offering();
    const second = offering("connection-2");
    const dispatched: Array<
      Parameters<CapabilityRegistryInvoker["streamLanguage"]>[0]
    > = [];
    const invoker: Pick<
      CapabilityRegistryInvoker,
      "listConfiguredOfferings" | "resolve" | "streamLanguage"
    > = {
      async listConfiguredOfferings(input) {
        expect(input.ownerId).toBe("owner-1");
        return [first, second];
      },
      async resolve() {
        throw new Error("shadow-only");
      },
      async *streamLanguage(input) {
        dispatched.push(input);
        yield { type: "finish", reason: "stop" };
      },
    };
    const catalogue = await registryAssistantSelections("owner-1", {}, invoker);
    expect(catalogue).toHaveLength(2);
    expect(catalogue[0]!.capability.modelKey).not.toBe(
      catalogue[1]!.capability.modelKey,
    );
    const selection = registryAssistantSelection(
      second,
      {},
      invoker,
      new CapabilityRuntime({ modeFor: () => "registry" }),
    );
    expect(selection.capability.modelKey).toBe(
      registryAssistantModelKey(second.id),
    );
    expect(selection.capability.supportsTools).toBe(false);
    expect(modelCapabilitySchema.parse(selection.capability).label).toContain(
      "previously-unknown-model",
    );
    expect(modelPlacementSchema.parse(selection.modelPlacement)).toEqual({
      kind: "direct-byok",
      origin: "https://proxy.example",
      credentialOwner: "user",
    });
    expect(
      await selection.gateway.listModels({
        ownerId: "owner-1",
        placement: "core",
        allowedOrigins: [],
      }),
    ).toEqual([selection.descriptor]);
    for await (const _event of streamExplicitModelAttempts({
      selection,
      ownerId: "owner-1",
      runId: "run-1",
      round: 0,
      messages: [
        {
          id: "message",
          trust: "user-instruction",
          mediaType: "text/plain",
          content: "Explain this",
          sourceRef: null,
          redactions: [],
        },
      ],
      tools: [
        {
          name: "not_supported",
          description: "Must not be forced on text-only model",
          inputSchema: {},
        },
      ],
      signal: new AbortController().signal,
    })) {
      /* consume */
    }
    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]!.route).toMatchObject({
      offeringId: second.id,
      modelId: second.modelId,
      modelRevision: second.modelRevision,
    });
    expect(dispatched[0]!.request.tools).toEqual([]);
    expect(dispatched[0]!.request.maximumOutputTokens).toBe(2_000);
    expect(dispatched[0]!.requirements?.requiredFeatures).not.toContain(
      "tools",
    );
  });

  test("maps Node and full-self-host placements without changing immutable offering keys", () => {
    const base = offering();
    const node = registryAssistantSelection({
      ...base,
      placement: {
        kind: "node",
        nodeId: "node-1",
        configRevision: `sha256:${"b".repeat(64)}`,
      },
    });
    expect(node.modelPlacement).toEqual({
      kind: "node",
      nodeId: "node-1",
      capabilityRevision: `sha256:${"b".repeat(64)}`,
    });
    const selfhost = registryAssistantSelection({
      ...base,
      placement: { kind: "full-self-host", instanceId: "selfhost-1" },
    });
    expect(selfhost.modelPlacement).toEqual({
      kind: "core",
      instanceId: "selfhost-1",
    });
    expect(selfhost.capability.modelKey).toBe(
      registryAssistantModelKey(base.id),
    );
  });
});
