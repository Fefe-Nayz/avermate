import { describe, expect, test } from "bun:test";
import type {
  AssistantModelPreference,
  AssistantRunModelPolicy,
  ModelCapability,
  ModelGateway,
  ModelRequest,
} from "@avermate/agent-contracts";
import { contextAssetHandleSchema } from "@avermate/agent-contracts";
import {
  decideAssistantModelPolicy,
  PolicyConstrainedModelGateway,
} from "./model-policy";
import { streamExplicitModelAttempts } from "./model-attempts";
import type {
  AssistantGatewaySelection,
  AssistantRunExecutionControl,
} from "./run-service";

function capability(
  modelKey: string,
  placement: ModelCapability["placement"],
  providerKey = `${placement}-provider`,
): ModelCapability {
  return {
    modelKey,
    providerKey,
    label: modelKey,
    placement,
    modalities: ["text"],
    supportsTools: true,
    supportsReasoningSummary: false,
    contextTokens: 100_000,
    maxOutputTokens: 4_096,
    estimatedInputPrice: null,
    estimatedOutputPrice: null,
    currency: null,
    contentLeavesPlacement: placement !== "node",
    privacyUrl: null,
  };
}

function preference(
  overrides: Partial<AssistantModelPreference> = {},
): AssistantModelPreference {
  return {
    defaultModelKey: "core-model",
    route: "selected-only",
    fallback: "none",
    maximumInputTokens: null,
    maximumOutputTokens: null,
    maximumEstimatedCostMinor: null,
    currency: null,
    revision: 4,
    updatedAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

function request(): ModelRequest {
  return {
    ownerId: "owner-1",
    runId: "run-1",
    modelId: "model",
    messages: [
      {
        id: "context-1",
        trust: "user-instruction",
        mediaType: "text/plain",
        content: "bonjour",
        sourceRef: null,
        redactions: [],
      },
    ],
    tools: [],
  };
}

function policy(
  overrides: Partial<AssistantRunModelPolicy> = {},
): AssistantRunModelPolicy {
  return {
    preferenceRevision: 4,
    requestedModelKey: "node-model",
    selectedModelKey: "node-model",
    route: "prefer-node",
    fallback: "configured-routes",
    orderedFallbackModelKeys: ["core-model"],
    maximumInputTokens: 1_000,
    maximumOutputTokens: 12,
    maximumEstimatedCostMinor: 5,
    currency: "EUR",
    frozenAt: "2026-08-22T00:00:00.000Z",
    ...overrides,
  };
}

describe("assistant model run policy", () => {
  test("applies preferred placement and freezes ordered explicit fallbacks", () => {
    const decision = decideAssistantModelPolicy({
      preference: preference({
        route: "prefer-node",
        fallback: "configured-routes",
      }),
      requestedModelKey: "core-model",
      available: [
        capability("core-model", "core"),
        capability("node-model", "node"),
        capability("managed-model", "managed"),
      ],
      now: new Date("2026-08-22T00:00:00.000Z"),
    });

    expect(decision.selectedModelKey).toBe("node-model");
    expect(decision.policy).toMatchObject({
      requestedModelKey: "core-model",
      selectedModelKey: "node-model",
      route: "prefer-node",
      orderedFallbackModelKeys: ["core-model"],
      preferenceRevision: 4,
    });
  });

  test("never adds an implicit managed fallback to a non-managed primary", () => {
    const decision = decideAssistantModelPolicy({
      preference: preference({
        route: "prefer-core",
        fallback: "configured-routes",
      }),
      available: [
        capability("core-model", "core"),
        capability("managed-model", "managed"),
      ],
    });

    expect(decision.policy.orderedFallbackModelKeys).toEqual([]);
  });

  test("does not invent a fallback when policy says none", () => {
    expect(() =>
      decideAssistantModelPolicy({
        preference: preference({
          defaultModelKey: "offline-model",
          fallback: "none",
        }),
        available: [capability("core-model", "core")],
      }),
    ).toThrow("MODEL_POLICY_PRIMARY_ROUTE_UNAVAILABLE");
  });

  test("enforces frozen input/output/cost budgets on the exact gateway", async () => {
    const observed: ModelRequest[] = [];
    const delegate: ModelGateway = {
      async listModels() {
        return [];
      },
      async *stream(input) {
        observed.push(input);
        yield {
          type: "usage",
          usage: {
            inputTokens: 10,
            outputTokens: 10,
            reasoningTokens: 0,
            cachedReadTokens: 0,
            cachedWriteTokens: 0,
          },
        } as const;
        yield { type: "finish", reason: "stop" } as const;
      },
      async embed() {
        throw new Error("unused");
      },
      async transcribe() {
        throw new Error("unused");
      },
      async estimate() {
        return {
          usage: {
            inputTokens: 10,
            outputTokens: 12,
            reasoningTokens: 0,
            cachedReadTokens: 0,
            cachedWriteTokens: 0,
          },
          estimatedCostMinor: 4,
          currency: "EUR",
        };
      },
    };
    const client = {
      async execute() {
        return {
          rows: [{ modelKey: "node-model", modelPolicyJson: policy() }],
          columns: [],
          rowsAffected: 0,
        };
      },
    } as never;
    const gateway = new PolicyConstrainedModelGateway(
      delegate,
      client,
      "node-model",
    );

    const events = [];
    for await (const event of gateway.stream(request())) events.push(event);
    expect(events.at(-1)).toEqual({ type: "finish", reason: "stop" });
    expect(observed[0]?.maximumOutputTokens).toBe(12);
  });

  test("fails closed when a configured cost budget cannot be estimated", async () => {
    const delegate: ModelGateway = {
      async listModels() {
        return [];
      },
      async *stream() {},
      async embed() {
        throw new Error("unused");
      },
      async transcribe() {
        throw new Error("unused");
      },
      async estimate() {
        return {
          usage: {
            inputTokens: "unknown",
            outputTokens: "unknown",
            reasoningTokens: "unknown",
            cachedReadTokens: "unknown",
            cachedWriteTokens: "unknown",
          },
          estimatedCostMinor: "unknown",
          currency: "unknown",
        };
      },
    };
    const gateway = new PolicyConstrainedModelGateway(
      delegate,
      {
        async execute() {
          return {
            rows: [{ modelKey: "node-model", modelPolicyJson: policy() }],
            columns: [],
            rowsAffected: 0,
          };
        },
      } as never,
      "node-model",
    );

    await expect(async () => {
      for await (const _event of gateway.stream(request())) {
        // no-op
      }
    }).toThrow("MODEL_POLICY_COST_ESTIMATE_UNAVAILABLE");
  });

  test("applies the same frozen budget to an explicitly listed fallback", async () => {
    const delegate: ModelGateway = {
      async listModels() {
        return [];
      },
      async *stream() {
        throw new Error("must not dispatch");
      },
      async embed() {
        throw new Error("unused");
      },
      async transcribe() {
        throw new Error("unused");
      },
      async estimate() {
        return {
          usage: {
            inputTokens: 1,
            outputTokens: 1,
            reasoningTokens: 0,
            cachedReadTokens: 0,
            cachedWriteTokens: 0,
          },
          estimatedCostMinor: 6,
          currency: "EUR",
        };
      },
    };
    const gateway = new PolicyConstrainedModelGateway(
      delegate,
      {
        async execute() {
          return {
            rows: [{ modelKey: "node-model", modelPolicyJson: policy() }],
            columns: [],
            rowsAffected: 0,
          };
        },
      } as never,
      "core-model",
    );

    await expect(async () => {
      for await (const _event of gateway.stream(request())) {
        // no-op
      }
    }).toThrow("MODEL_POLICY_ESTIMATED_COST_LIMIT_EXCEEDED");
  });
});

function attemptSelection(input: {
  modelKey: string;
  providerKey: string;
  events?: ModelGateway["stream"];
}): AssistantGatewaySelection {
  const gateway: ModelGateway = {
    async listModels() {
      return [];
    },
    stream:
      input.events ??
      async function* () {
        yield { type: "finish", reason: "stop" } as const;
      },
    async embed() {
      throw new Error("unused");
    },
    async transcribe() {
      throw new Error("unused");
    },
    async estimate() {
      return {
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          reasoningTokens: 0,
          cachedReadTokens: 0,
          cachedWriteTokens: 0,
        },
        estimatedCostMinor: 0,
        currency: "EUR",
      };
    },
  };
  return {
    capability: capability(input.modelKey, "core", input.providerKey),
    descriptor: {
      id: `${input.modelKey}-id`,
      provider: input.providerKey,
      displayName: input.modelKey,
      modalities: ["text"],
      capabilities: {
        tools: true,
        reasoningSummary: false,
        cachedUsage: false,
        structuredOutput: false,
      },
      contextWindow: 16_384,
    },
    gateway,
    modelRevision: `${input.modelKey}/revision-1`,
    providerRevision: `${input.providerKey}/revision-1`,
    modelPlacement: { kind: "core", instanceId: input.providerKey },
    providerSupportsStableRequestKey: false,
  };
}

function attemptControl() {
  const claims: Array<{
    attempt: number;
    modelKey: string;
    providerKey: string;
    requestDigest: string;
  }> = [];
  const transitions: Array<{ attempt: number; state: string }> = [];
  const control: AssistantRunExecutionControl = {
    approvalMode: "read-only",
    async claimDispatch(input) {
      claims.push({
        attempt: input.attempt ?? 0,
        modelKey: input.selection.capability.modelKey,
        providerKey: input.selection.capability.providerKey,
        requestDigest: input.requestDigest,
      });
    },
    async transitionDispatch(input) {
      transitions.push({
        attempt: input.attempt ?? 0,
        state: input.state,
      });
    },
    async freezeContextManifest() {},
    async cancellationRequested() {
      return false;
    },
    async suspendForApproval() {},
  };
  return { control, claims, transitions };
}

function visualAttemptMessages(): ModelRequest["messages"] {
  return [
    {
      id: "visual-context",
      trust: "retrieved-untrusted",
      mediaType: "application/vnd.avermate.evidence+json",
      content: "cited text fallback",
      sourceRef: "chunk-visual",
      redactions: [],
      parts: [
        {
          type: "text",
          text: "cited text fallback",
          mime: "application/vnd.avermate.evidence+json",
          evidence: {
            chunkId: "chunk-visual",
            locator: { kind: "pdf", page: 7 },
            digest: "a".repeat(64),
          },
        },
        {
          type: "image",
          assetHandle: contextAssetHandleSchema.parse(`cah1.${"M".repeat(32)}`),
          mime: "image/png",
          fallbackText: "bounded OCR fallback",
          evidence: {
            chunkId: "chunk-visual",
            locator: { kind: "pdf", page: 7 },
            digest: "b".repeat(64),
          },
        },
      ],
    },
  ];
}

describe("explicit model fallback execution", () => {
  test("binds dispatch claims to immutable media evidence, not randomized handles", async () => {
    const selection = attemptSelection({
      modelKey: "media-model",
      providerKey: "media-provider",
    });
    const claimedDigest = async (
      assetSuffix: string,
      evidenceDigest: string,
    ) => {
      const { control, claims } = attemptControl();
      const message: ModelRequest["messages"][number] = {
        id: "visual",
        trust: "retrieved-untrusted",
        mediaType: "multipart/mixed",
        content: "same fallback",
        sourceRef: "chunk-1",
        redactions: [],
        parts: [
          {
            type: "image",
            assetHandle: contextAssetHandleSchema.parse(
              `cah1.${assetSuffix.repeat(32)}`,
            ),
            mime: "image/png",
            fallbackText: "same fallback",
            evidence: {
              chunkId: "chunk-1",
              locator: { kind: "pdf", page: 1 },
              digest: evidenceDigest,
            },
          },
        ],
      };
      for await (const _attempted of streamExplicitModelAttempts({
        selection,
        ownerId: "owner-1",
        runId: "run-media",
        round: 0,
        messages: [message],
        tools: [],
        signal: new AbortController().signal,
        control,
      })) {
        // consume the terminal event
      }
      return claims[0]!.requestDigest;
    };

    const first = await claimedDigest("a", "b".repeat(64));
    const sameEvidenceNewHandle = await claimedDigest("c", "b".repeat(64));
    const differentEvidence = await claimedDigest("d", "e".repeat(64));

    expect(sameEvidenceNewHandle).toBe(first);
    expect(differentEvidence).not.toBe(first);
  });

  test("projects Core multimodal context to cited text before a Node fallback", async () => {
    const coreRequests: ModelRequest[] = [];
    const nodeRequests: ModelRequest[] = [];
    const fallbackBase = attemptSelection({
      modelKey: "node-text-fallback",
      providerKey: "node-provider",
      events: async function* (request) {
        nodeRequests.push(request);
        yield { type: "finish", reason: "stop" };
      },
    });
    const fallback: AssistantGatewaySelection = {
      ...fallbackBase,
      capability: capability("node-text-fallback", "node", "node-provider"),
      modelPlacement: {
        kind: "node",
        nodeId: "paired-node",
        capabilityRevision: "node-revision-1",
      },
    };
    const primaryBase = attemptSelection({
      modelKey: "core-vision-primary",
      providerKey: "core-provider",
      events: async function* (request) {
        coreRequests.push(request);
        yield { type: "error", code: "CORE_BUSY", retryable: true };
      },
    });
    const primary: AssistantGatewaySelection = {
      ...primaryBase,
      descriptor: { ...primaryBase.descriptor, modalities: ["text", "image"] },
      contextMediaDelivery: "server-resolved",
      fallbackSelections: [fallback],
    };
    const { control, claims } = attemptControl();

    for await (const _event of streamExplicitModelAttempts({
      selection: primary,
      ownerId: "owner-1",
      runId: "run-core-to-node",
      round: 0,
      messages: visualAttemptMessages(),
      tools: [],
      signal: new AbortController().signal,
      control,
    })) {
      // consume the fallback response
    }

    expect(coreRequests[0]?.messages[0]?.parts?.[1]).toMatchObject({
      type: "image",
      assetHandle: `cah1.${"M".repeat(32)}`,
      evidence: { digest: "b".repeat(64) },
    });
    expect(nodeRequests[0]?.messages[0]?.parts).toMatchObject([
      { type: "text", text: "cited text fallback" },
    ]);
    expect(JSON.stringify(nodeRequests[0])).not.toContain("cah1.");
    expect(claims).toHaveLength(2);
    expect(claims[0]?.requestDigest).not.toBe(claims[1]?.requestDigest);
  });

  test("keeps Node text-only while delivering the same visual handle to a Core fallback", async () => {
    const nodeRequests: ModelRequest[] = [];
    const coreRequests: ModelRequest[] = [];
    const coreBase = attemptSelection({
      modelKey: "core-vision-fallback",
      providerKey: "core-provider",
      events: async function* (request) {
        coreRequests.push(request);
        yield { type: "finish", reason: "stop" };
      },
    });
    const coreFallback: AssistantGatewaySelection = {
      ...coreBase,
      descriptor: { ...coreBase.descriptor, modalities: ["text", "image"] },
      contextMediaDelivery: "server-resolved",
    };
    const nodeBase = attemptSelection({
      modelKey: "node-text-primary",
      providerKey: "node-provider",
      events: async function* (request) {
        nodeRequests.push(request);
        yield { type: "error", code: "NODE_BUSY", retryable: true };
      },
    });
    const primary: AssistantGatewaySelection = {
      ...nodeBase,
      capability: capability("node-text-primary", "node", "node-provider"),
      modelPlacement: {
        kind: "node",
        nodeId: "paired-node",
        capabilityRevision: "node-revision-1",
      },
      fallbackSelections: [coreFallback],
    };
    const { control, claims } = attemptControl();

    for await (const _event of streamExplicitModelAttempts({
      selection: primary,
      ownerId: "owner-1",
      runId: "run-node-to-core",
      round: 0,
      messages: visualAttemptMessages(),
      tools: [],
      signal: new AbortController().signal,
      control,
    })) {
      // consume the fallback response
    }

    expect(nodeRequests[0]?.messages[0]?.parts).toMatchObject([
      { type: "text", text: "cited text fallback" },
    ]);
    expect(JSON.stringify(nodeRequests[0])).not.toContain("cah1.");
    expect(coreRequests[0]?.messages[0]?.parts?.[1]).toMatchObject({
      type: "image",
      assetHandle: `cah1.${"M".repeat(32)}`,
      evidence: { digest: "b".repeat(64) },
    });
    expect(claims).toHaveLength(2);
    expect(claims[0]?.requestDigest).not.toBe(claims[1]?.requestDigest);
  });

  test("claims and executes only the next frozen route after a retryable pre-output error", async () => {
    let fallbackCalls = 0;
    const fallback = attemptSelection({
      modelKey: "core-fallback",
      providerKey: "core-provider",
      events: async function* () {
        fallbackCalls += 1;
        yield { type: "content-delta", delta: "ok" };
        yield { type: "finish", reason: "stop" };
      },
    });
    const primary = {
      ...attemptSelection({
        modelKey: "node-primary",
        providerKey: "node-provider",
        events: async function* () {
          yield { type: "error", code: "NODE_OFFLINE", retryable: true };
        },
      }),
      fallbackSelections: [fallback],
    };
    const { control, claims, transitions } = attemptControl();
    const observed = [];
    for await (const attempted of streamExplicitModelAttempts({
      selection: primary,
      ownerId: "owner-1",
      runId: "run-1",
      round: 2,
      messages: request().messages,
      tools: [],
      signal: new AbortController().signal,
      control,
    })) {
      observed.push({
        modelKey: attempted.selection.capability.modelKey,
        attempt: attempted.attempt,
        type: attempted.event.type,
      });
    }

    expect(fallbackCalls).toBe(1);
    expect(
      claims.map(({ attempt, modelKey, providerKey }) => ({
        attempt,
        modelKey,
        providerKey,
      })),
    ).toEqual([
      { attempt: 0, modelKey: "node-primary", providerKey: "node-provider" },
      { attempt: 1, modelKey: "core-fallback", providerKey: "core-provider" },
    ]);
    expect(claims[0]?.requestDigest).not.toBe(claims[1]?.requestDigest);
    expect(transitions).toContainEqual({ attempt: 0, state: "failed" });
    expect(observed).toEqual([
      { modelKey: "core-fallback", attempt: 1, type: "content-delta" },
      { modelKey: "core-fallback", attempt: 1, type: "finish" },
    ]);
  });

  test("does not fall back after semantic output", async () => {
    let fallbackCalls = 0;
    const primary = {
      ...attemptSelection({
        modelKey: "primary",
        providerKey: "provider-a",
        events: async function* () {
          yield { type: "content-delta", delta: "partial" };
          yield { type: "error", code: "LATE_FAILURE", retryable: true };
        },
      }),
      fallbackSelections: [
        attemptSelection({
          modelKey: "fallback",
          providerKey: "provider-b",
          events: async function* () {
            fallbackCalls += 1;
          },
        }),
      ],
    };
    const { control, claims } = attemptControl();

    await expect(async () => {
      for await (const _attempted of streamExplicitModelAttempts({
        selection: primary,
        ownerId: "owner-1",
        runId: "run-1",
        round: 0,
        messages: request().messages,
        tools: [],
        signal: new AbortController().signal,
        control,
      })) {
        // consume the partial event
      }
    }).toThrow("LATE_FAILURE");
    expect(fallbackCalls).toBe(0);
    expect(claims).toHaveLength(1);
  });

  test("does not fall back after a thrown transport error", async () => {
    let fallbackCalls = 0;
    const primary = {
      ...attemptSelection({
        modelKey: "primary",
        providerKey: "provider-a",
        events: async function* () {
          throw new Error("transport outcome unknown");
        },
      }),
      fallbackSelections: [
        attemptSelection({
          modelKey: "fallback",
          providerKey: "provider-b",
          events: async function* () {
            fallbackCalls += 1;
          },
        }),
      ],
    };
    const { control } = attemptControl();

    await expect(async () => {
      for await (const _attempted of streamExplicitModelAttempts({
        selection: primary,
        ownerId: "owner-1",
        runId: "run-1",
        round: 0,
        messages: request().messages,
        tools: [],
        signal: new AbortController().signal,
        control,
      })) {
        // no-op
      }
    }).toThrow("transport outcome unknown");
    expect(fallbackCalls).toBe(0);
  });
});
