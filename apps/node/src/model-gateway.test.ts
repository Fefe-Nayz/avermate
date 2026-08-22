import { describe, expect, test } from "bun:test";
import type { ModelDescriptor, ModelGatewayEvent } from "@avermate/agent-contracts";
import {
  LiteLLMNodeGateway,
  OpenAICompatibleNodeGateway,
  normalizeOpenAIUsage,
} from "./model-gateway";

const models: ModelDescriptor[] = [
  {
    id: "reviewed-model@sha256:abc",
    provider: "fixture",
    displayName: "Fixture",
    modalities: ["text", "embedding", "audio"],
    capabilities: {
      tools: true,
      reasoningSummary: false,
      cachedUsage: true,
      structuredOutput: true,
    },
    contextWindow: 8_192,
  },
];

describe("OpenAICompatibleNodeGateway", () => {
  test("normalizes bounded SSE content, tools, usage and finish", async () => {
    const gateway = new OpenAICompatibleNodeGateway({
      baseUrl: "http://model.internal:4000",
      models,
      credential: async () => "owner-key",
      fetch: async (_url, init) => {
        expect(new Headers(init?.headers).get("authorization")).toBe(
          "Bearer owner-key",
        );
        const frames = [
          {
            choices: [
              {
                delta: {
                  content: "Bonjour",
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      function: { name: "lookup", arguments: '{"q":' },
                    },
                  ],
                },
                finish_reason: null,
              },
            ],
          },
          {
            choices: [
              {
                delta: {
                  tool_calls: [
                    { index: 0, function: { arguments: '"x"}' } },
                  ],
                },
                finish_reason: "tool_calls",
              },
            ],
            usage: {
              prompt_tokens: 12,
              completion_tokens: 3,
              prompt_tokens_details: { cached_tokens: 4 },
            },
          },
        ];
        return new Response(
          `${frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join("")}data: [DONE]\n\n`,
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      },
    });
    const events: ModelGatewayEvent[] = [];
    for await (const event of gateway.stream({
      ownerId: "owner-1",
      runId: "run-1",
      modelId: models[0]!.id,
      messages: [
        {
          id: "block-1",
          trust: "user-instruction",
          mediaType: "text/plain",
          content: "Bonjour",
          sourceRef: null,
          redactions: [],
        },
      ],
      tools: [
        { name: "lookup", description: "Lookup", inputSchema: { type: "object" } },
      ],
    })) {
      events.push(event);
    }
    expect(events.map((event) => event.type)).toEqual([
      "content-delta",
      "tool-call-start",
      "tool-arguments-delta",
      "tool-arguments-delta",
      "usage",
      "tool-call-end",
      "finish",
    ]);
    expect(events.at(-1)).toEqual({ type: "finish", reason: "tool-calls" });
  });

  test("validates embedding dimensions and usage", async () => {
    const gateway = new OpenAICompatibleNodeGateway({
      baseUrl: "http://model.internal:4000",
      models,
      fetch: async () =>
        Response.json({
          data: [
            { index: 1, embedding: [0, 1] },
            { index: 0, embedding: [1, 0] },
          ],
          usage: { prompt_tokens: 2, total_tokens: 2 },
        }),
    });
    const result = await gateway.embed({
      ownerId: "owner-1",
      modelId: models[0]!.id,
      inputs: ["a", "b"],
    });
    expect(result.vectors).toEqual([
      [1, 0],
      [0, 1],
    ]);
    expect(result.usage.inputTokens).toBe(2);
  });

  test("normalizes missing usage fields without inventing numbers", () => {
    expect(normalizeOpenAIUsage({ prompt_tokens: 2 })).toEqual({
      inputTokens: 2,
      outputTokens: "unknown",
      reasoningTokens: "unknown",
      cachedReadTokens: "unknown",
      cachedWriteTokens: "unknown",
    });
  });
});

describe("LiteLLMNodeGateway", () => {
  test("mints owner-isolated short-lived keys and never uses the admin key for inference", async () => {
    const calls: Array<{ url: string; authorization: string | null; body: unknown }> = [];
    const fetcher = async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({
        url,
        authorization: new Headers(init?.headers).get("authorization"),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      if (url.endsWith("/key/generate")) {
        return Response.json({
          key: `sk-virtual-${calls.length}-0123456789`,
          expires: new Date(Date.now() + 5 * 60_000).toISOString(),
        });
      }
      return new Response(
        `data: ${JSON.stringify({ choices: [{ delta: { content: "ok" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      );
    };
    const gateway = new LiteLLMNodeGateway({
      baseUrl: "http://litellm.internal:4000",
      models,
      adminKey: async () => "sk-admin-never-forward",
      virtualKeyTtlSeconds: 300,
      ownerBudgetMinor: 500,
      ownerRequestsPerMinute: 12,
      ownerTokensPerMinute: 34_000,
      fallbackChains: [],
      fetch: fetcher,
    });
    for (const ownerId of ["owner-1", "owner-2"]) {
      for await (const _event of gateway.stream({
        ownerId,
        runId: `run-${ownerId}`,
        modelId: models[0]!.id,
        messages: [],
        tools: [],
      })) {
        // consume
      }
    }
    const keyCalls = calls.filter((call) => call.url.endsWith("/key/generate"));
    const inferenceCalls = calls.filter((call) =>
      call.url.endsWith("/v1/chat/completions"),
    );
    expect(keyCalls).toHaveLength(2);
    expect(
      keyCalls.map((call) => (call.body as { user_id: string }).user_id),
    ).not.toEqual(["owner-1", "owner-2"]);
    expect(new Set(inferenceCalls.map((call) => call.authorization)).size).toBe(2);
    expect(inferenceCalls.some((call) => call.authorization?.includes("admin"))).toBe(false);
    for (const call of keyCalls) {
      expect(call.body).toMatchObject({
        models: [models[0]!.id],
        duration: "300s",
        max_budget: 5,
        rpm_limit: 12,
        tpm_limit: 34_000,
      });
      expect(
        (call.body as { metadata: Record<string, string> }).metadata,
      ).not.toHaveProperty("ownerId");
    }
  });

  test("accepts only an explicit acyclic catalogue fallback policy", () => {
    const fallback = { ...models[0]!, id: "reviewed-fallback@sha256:def" };
    expect(
      () =>
        new LiteLLMNodeGateway({
          baseUrl: "http://litellm.internal:4000",
          models: [models[0]!, fallback],
          adminKey: async () => "sk-admin-never-forward",
          virtualKeyTtlSeconds: 300,
          ownerBudgetMinor: 500,
          ownerRequestsPerMinute: 12,
          ownerTokensPerMinute: 34_000,
          fallbackChains: [
            {
              modelId: models[0]!.id,
              fallbackModelIds: [fallback.id],
            },
          ],
        }),
    ).not.toThrow();
    expect(
      () =>
        new LiteLLMNodeGateway({
          baseUrl: "http://litellm.internal:4000",
          models: [models[0]!, fallback],
          adminKey: async () => "sk-admin-never-forward",
          virtualKeyTtlSeconds: 300,
          ownerBudgetMinor: 500,
          ownerRequestsPerMinute: 12,
          ownerTokensPerMinute: 34_000,
          fallbackChains: [
            {
              modelId: models[0]!.id,
              fallbackModelIds: [fallback.id],
            },
            {
              modelId: fallback.id,
              fallbackModelIds: [models[0]!.id],
            },
          ],
        }),
    ).toThrow("LITELLM_FALLBACK_POLICY_INVALID");
  });
});
