import { describe, expect, test } from "bun:test";
import { simulateReadableStream } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import type {
  ModelDescriptor,
  ModelGatewayEvent,
  ModelRequest,
} from "@avermate/agent-contracts";
import {
  AiSdkDirectGateway,
  LiteLLMProxyGateway,
  OpenAICompatibleGateway,
  normalizeAiSdkStream,
} from "./model-gateways";

const descriptor: ModelDescriptor = {
  id: "mock-model",
  provider: "mock",
  displayName: "Mock model",
  modalities: ["text"],
  capabilities: {
    tools: true,
    reasoningSummary: true,
    cachedUsage: true,
    structuredOutput: false,
  },
  contextWindow: 8_192,
};

const request: ModelRequest = {
  ownerId: "owner-1",
  runId: "run-1",
  modelId: descriptor.id,
  messages: [
    {
      id: "message-1",
      trust: "user-instruction",
      mediaType: "text/plain",
      content: "Use the read tool",
      sourceRef: null,
      redactions: [],
    },
  ],
  tools: [
    {
      name: "grades.list",
      description: "List grades",
      inputSchema: { type: "object", properties: {} },
    },
  ],
};

const usage = {
  inputTokens: {
    total: 10,
    noCache: 6,
    cacheRead: 4,
    cacheWrite: undefined,
  },
  outputTokens: { total: 5, text: 3, reasoning: 2 },
};

function lowLevelChunks() {
  return [
    { type: "stream-start" as const, warnings: [] },
    { type: "text-start" as const, id: "text-1" },
    { type: "text-delta" as const, id: "text-1", delta: "Hello" },
    { type: "text-end" as const, id: "text-1" },
    {
      type: "tool-input-start" as const,
      id: "call-1",
      toolName: "grades.list",
    },
    { type: "tool-input-delta" as const, id: "call-1", delta: '{"' },
    { type: "tool-input-delta" as const, id: "call-1", delta: 'x":1}' },
    { type: "tool-input-end" as const, id: "call-1" },
    {
      type: "finish" as const,
      finishReason: { unified: "tool-calls" as const, raw: "tool_calls" },
      usage,
    },
  ];
}

async function collect(gateway: {
  stream(input: ModelRequest): AsyncIterable<ModelGatewayEvent>;
}) {
  const events = [];
  for await (const event of gateway.stream(request)) events.push(event);
  return events;
}

describe("model gateway normalization", () => {
  test("normalizes an AI SDK direct stream without external telemetry", async () => {
    const model = new MockLanguageModelV4({
      modelId: descriptor.id,
      doStream: {
        stream: simulateReadableStream({ chunks: lowLevelChunks() }),
      },
    });
    const gateway = new AiSdkDirectGateway({
      models: [descriptor],
      resolveModel: () => model,
    });
    expect(await collect(gateway)).toEqual([
      { type: "content-delta", delta: "Hello" },
      { type: "tool-call-start", callId: "call-1", toolName: "grades.list" },
      { type: "tool-arguments-delta", callId: "call-1", delta: '{"' },
      { type: "tool-arguments-delta", callId: "call-1", delta: 'x":1}' },
      { type: "tool-call-end", callId: "call-1" },
      {
        type: "usage",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          reasoningTokens: 2,
          cachedReadTokens: 4,
          cachedWriteTokens: "unknown",
        },
      },
      { type: "finish", reason: "tool-calls" },
    ]);
  });

  test("maps authorized summaries but never exposes opaque reasoning text", async () => {
    const chunks = [
      { type: "reasoning-start", id: "r1" },
      { type: "reasoning-delta", id: "r1", text: "Safe summary" },
      { type: "reasoning-end", id: "r1" },
    ];
    const authorized = [];
    for await (const event of normalizeAiSdkStream(
      simulateReadableStream({ chunks }),
      { reasoningSummaryAuthorized: true },
    )) {
      authorized.push(event);
    }
    expect(authorized).toEqual([
      {
        type: "reasoning-summary",
        summary: "Safe summary",
        providerAuthorized: true,
      },
    ]);

    const opaque = [];
    for await (const event of normalizeAiSdkStream(
      simulateReadableStream({ chunks }),
      { reasoningSummaryAuthorized: false },
    )) {
      opaque.push(event);
    }
    expect(opaque).toEqual([
      { type: "opaque-reasoning-state", continuationRef: "provider:r1" },
    ]);
    expect(JSON.stringify(opaque)).not.toContain("Safe summary");
  });

  test("normalizes an OpenAI-compatible SSE stream to the same stable events", async () => {
    const encoder = new TextEncoder();
    const sse =
      [
        {
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1,
          model: descriptor.id,
          choices: [
            {
              index: 0,
              delta: { role: "assistant", content: "Hello" },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1,
          model: descriptor.id,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call-1",
                    type: "function",
                    function: { name: "grades.list", arguments: '{"' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1,
          model: descriptor.id,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [{ index: 0, function: { arguments: 'x":1}' } }],
              },
              finish_reason: null,
            },
          ],
        },
        {
          id: "chatcmpl-1",
          object: "chat.completion.chunk",
          created: 1,
          model: descriptor.id,
          choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
            prompt_tokens_details: { cached_tokens: 4 },
            completion_tokens_details: { reasoning_tokens: 2 },
          },
        },
      ]
        .map((chunk) => `data: ${JSON.stringify(chunk)}\n\n`)
        .join("") + "data: [DONE]\n\n";
    let credentialForwarded = false;
    const gateway = new OpenAICompatibleGateway({
      baseUrl: "https://models.example.test/v1",
      providerName: "mock-compatible",
      credential: {
        origin: "https://models.example.test",
        headerName: "Authorization",
        value: "Bearer synthetic-test-value",
      },
      endpointPolicy: {
        placement: "hosted-core",
        allowedOrigins: ["https://models.example.test"],
        lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      },
      models: [descriptor],
      async transport(_url, init) {
        credentialForwarded =
          new Headers(init.headers).get("authorization") ===
          "Bearer synthetic-test-value";
        return new Response(encoder.encode(sse), {
          headers: { "content-type": "text/event-stream" },
        });
      },
    });

    const events = await collect(gateway);
    expect(credentialForwarded).toBe(true);
    expect(events).toEqual([
      { type: "content-delta", delta: "Hello" },
      { type: "tool-call-start", callId: "call-1", toolName: "grades.list" },
      { type: "tool-arguments-delta", callId: "call-1", delta: '{"' },
      { type: "tool-arguments-delta", callId: "call-1", delta: 'x":1}' },
      { type: "tool-call-end", callId: "call-1" },
      {
        type: "usage",
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          reasoningTokens: 2,
          cachedReadTokens: 4,
          cachedWriteTokens: "unknown",
        },
      },
      { type: "finish", reason: "tool-calls" },
    ]);
  });

  test("normalizes provider errors and cancellation without raw details", async () => {
    const errorEvents = [];
    for await (const event of normalizeAiSdkStream(
      simulateReadableStream({
        chunks: [
          { type: "error", error: new Error("private provider detail") },
          { type: "abort", reason: "user" },
        ],
      }),
      { reasoningSummaryAuthorized: false },
    )) {
      errorEvents.push(event);
    }
    expect(errorEvents).toEqual([
      { type: "error", code: "provider_stream_error", retryable: true },
      { type: "error", code: "cancelled", retryable: true },
    ]);
    expect(JSON.stringify(errorEvents)).not.toContain(
      "private provider detail",
    );
  });

  test("keeps LiteLLM an explicit optional compatible placement", async () => {
    const gateway = new LiteLLMProxyGateway({
      baseUrl: "https://models.example.test/v1",
      endpointPolicy: {
        placement: "hosted-core",
        allowedOrigins: ["https://models.example.test"],
        lookup: async () => [{ address: "8.8.8.8", family: 4 }],
      },
      models: [descriptor],
    });
    expect(
      await gateway.listModels({
        ownerId: "owner-1",
        placement: "core",
        allowedOrigins: ["https://models.example.test"],
      }),
    ).toEqual([descriptor]);
  });
});
