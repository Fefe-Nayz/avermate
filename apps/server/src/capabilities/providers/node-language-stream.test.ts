import { describe, expect, test } from "bun:test";
import {
  emptyCapabilityUsage,
  type NodeCapabilityEventV1,
} from "@avermate/agent-contracts";
import { nodeLanguageEvent } from "./node-language-stream";

function event(
  type: NodeCapabilityEventV1["type"],
  payload: unknown,
): NodeCapabilityEventV1 {
  return {
    schemaVersion: 1,
    operationId: "op",
    offeringId: "offer",
    sequence: 0,
    type,
    payload,
  };
}

describe("Node language wire normalization", () => {
  test("does not leak transport acknowledgements and validates textual and final payloads", () => {
    expect(nodeLanguageEvent(event("acknowledged", null))).toBeNull();
    expect(
      nodeLanguageEvent(
        event("chunk", { type: "content-delta", delta: "Bonjour" }),
      ),
    ).toEqual({ type: "content-delta", delta: "Bonjour" });
    expect(
      nodeLanguageEvent(event("completed", { finishReason: "stop" })),
    ).toEqual({ type: "finish", reason: "stop" });
    expect(() => nodeLanguageEvent(event("completed", null))).toThrow();
    expect(() =>
      nodeLanguageEvent(event("chunk", { type: "finish", reason: "stop" })),
    ).toThrow();
    expect(() =>
      nodeLanguageEvent(event("chunk", { type: "content-delta", delta: 42 })),
    ).toThrow();
  });

  test("preserves measured usage without inventing absent or ambiguous token counts", () => {
    const usage = emptyCapabilityUsage();
    usage.items.push(
      { unit: "input-token", quantity: "13", source: "provider" },
      { unit: "output-token", quantity: "0", source: "provider" },
      { unit: "cached-input-token", quantity: "5", source: "provider" },
    );
    expect(nodeLanguageEvent(event("usage", usage))).toEqual({
      type: "usage",
      usage: {
        inputTokens: 13,
        outputTokens: 0,
        cachedReadTokens: 5,
        reasoningTokens: "unknown",
        cachedWriteTokens: "unknown",
      },
    });
    usage.items.push({
      unit: "input-token",
      quantity: "3",
      source: "provider",
    });
    expect(nodeLanguageEvent(event("usage", usage))).toMatchObject({
      usage: { inputTokens: "unknown" },
    });
    expect(() =>
      nodeLanguageEvent(event("usage", { ...usage, version: 8 })),
    ).toThrow();
  });

  test("preserves tool payloads and accepts only provider-authorized reasoning summaries", () => {
    const payload = {
      type: "tool-call-start",
      callId: "call",
      toolName: "grades_list",
    } as const;
    expect(nodeLanguageEvent(event("chunk", payload))).toEqual(payload);
    expect(() =>
      nodeLanguageEvent(
        event("chunk", {
          type: "reasoning-summary",
          summary: "Untrusted",
          providerAuthorized: false,
        }),
      ),
    ).toThrow();
    expect(
      nodeLanguageEvent(
        event("chunk", {
          type: "reasoning-summary",
          summary: "Summary",
          providerAuthorized: true,
        }),
      ),
    ).toMatchObject({ type: "reasoning-summary", providerAuthorized: true });
  });
});
