import { describe, expect, test } from "bun:test";
import {
  languageGenerationResultV1Schema,
  type LanguageGenerationResultV1,
  type ModelGatewayEvent,
} from "@avermate/agent-contracts";
import { CapabilityRegistryInvoker } from "./registry-invoker";

const events: ModelGatewayEvent[] = [
  { type: "content-delta", delta: "Looking up grades" },
  { type: "tool-call-start", callId: "call-1", toolName: "grades_list" },
  { type: "tool-arguments-delta", callId: "call-1", delta: '{"classId":' },
  { type: "tool-arguments-delta", callId: "call-1", delta: '"1"}' },
  { type: "tool-call-end", callId: "call-1" },
  { type: "finish", reason: "tool-calls" },
];

function fixture() {
  let stored: LanguageGenerationResultV1 | null = null;
  let streams = 0;
  const invoker = new CapabilityRegistryInvoker({
    connections: {
      async list() {
        return [];
      },
    },
    policies: {
      async list() {
        return [];
      },
    },
    operations: {
      async reserve() {
        return {
          operation: {
            id: "operation",
            state: stored ? "completed" : "ready",
            revision: 1,
            routePlan: {},
          },
        };
      },
      async getResult() {
        return stored;
      },
    },
    executor: {
      async *stream(input: { finalize: () => LanguageGenerationResultV1 }) {
        streams += 1;
        yield* events;
        stored = languageGenerationResultV1Schema.parse(input.finalize());
      },
    },
  } as unknown as ConstructorParameters<typeof CapabilityRegistryInvoker>[0]);
  const collect = async () => {
    const result: ModelGatewayEvent[] = [];
    for await (const event of invoker.streamLanguage({
      ownerId: "owner",
      purpose: "assistant.chat",
      idempotencyKey: "round-1",
      request: {
        schemaVersion: 1,
        messages: [
          { role: "user", parts: [{ type: "text", text: "My grades?" }] },
        ],
        tools: [
          {
            name: "grades_list",
            description: "Read grades",
            inputSchema: { type: "object" },
          },
        ],
        maximumOutputTokens: 256,
        responseFormat: "text",
      },
    }))
      result.push(event);
    return result;
  };
  return {
    collect,
    streams: () => streams,
    result: () => stored,
    removeLegacyPayload() {
      if (stored) delete stored.toolCalls;
    },
  };
}

describe("registry language idempotent tool replay", () => {
  test("persists complete tool arguments and replays without another provider stream", async () => {
    const f = fixture();
    expect(await f.collect()).toEqual(events);
    expect(f.result()?.toolCalls).toEqual([
      {
        callId: "call-1",
        toolName: "grades_list",
        argumentsJson: '{"classId":"1"}',
      },
    ]);
    expect(await f.collect()).toEqual([
      events[0],
      events[1],
      {
        type: "tool-arguments-delta",
        callId: "call-1",
        delta: '{"classId":"1"}',
      },
      events[4],
      {
        type: "usage",
        usage: {
          inputTokens: "unknown",
          outputTokens: "unknown",
          reasoningTokens: "unknown",
          cachedReadTokens: "unknown",
          cachedWriteTokens: "unknown",
        },
      },
      events[5],
    ]);
    expect(f.streams()).toBe(1);
  });

  test("fails closed for an old completed tool stream without the tool payload", async () => {
    const f = fixture();
    await f.collect();
    f.removeLegacyPayload();
    await expect(f.collect()).rejects.toThrow(
      "CAPABILITY_TOOL_STREAM_REPLAY_PAYLOAD_UNAVAILABLE",
    );
    expect(f.streams()).toBe(1);
  });

  test("rejects malformed persisted arguments at the result contract boundary", async () => {
    const f = fixture();
    await f.collect();
    expect(() =>
      languageGenerationResultV1Schema.parse({
        ...f.result(),
        toolCalls: [
          {
            callId: "call-1",
            toolName: "grades_list",
            argumentsJson: "{broken",
          },
        ],
      }),
    ).toThrow();
  });
});
