import { describe, expect, test } from "bun:test";
import { NodeConversationEnvelopeCodec } from "./routed-conversation-store";

const codec = new NodeConversationEnvelopeCodec(
  "test-only-node-conversation-envelope-secret-0001",
);

function messageContext(overrides: Partial<{
  ownerId: string;
  nodeId: string;
  threadId: string;
  messageId: string;
  role: "user" | "assistant" | "system" | "tool";
  parentMessageId: string | null;
}> = {}) {
  return {
    ownerId: "owner-a",
    nodeId: "node-a",
    threadId: "thread-a",
    messageId: "message-a",
    role: "user" as const,
    parentMessageId: null,
    ...overrides,
  };
}

describe("Node conversation recovery envelope", () => {
  test("binds message ciphertext to owner, node, thread, id, role and parent", () => {
    const parts = [{ type: "text" as const, id: "part-a", markdown: "secret-a" }];
    const sealed = codec.sealParts({ ...messageContext(), parts });
    expect(codec.openParts({ ...messageContext(), parts: sealed })).toEqual(parts);

    for (const changed of [
      messageContext({ ownerId: "owner-b" }),
      messageContext({ nodeId: "node-b" }),
      messageContext({ threadId: "thread-b" }),
      messageContext({ messageId: "message-b" }),
      messageContext({ role: "assistant" }),
      messageContext({ parentMessageId: "parent-b" }),
    ]) {
      expect(() => codec.openParts({ ...changed, parts: sealed })).toThrow(
        "NODE_CONVERSATION_ENVELOPE_AUTH_FAILED",
      );
    }
  });

  test("rejects swapped ciphertexts in the same thread", () => {
    const first = codec.sealParts({
      ...messageContext({ messageId: "message-a" }),
      parts: [{ type: "text", id: "part-a", markdown: "first" }],
    });
    const second = codec.sealParts({
      ...messageContext({ messageId: "message-b", parentMessageId: "message-a" }),
      parts: [{ type: "text", id: "part-b", markdown: "second" }],
    });
    expect(() =>
      codec.openParts({
        ...messageContext({ messageId: "message-a" }),
        parts: second,
      }),
    ).toThrow("NODE_CONVERSATION_ENVELOPE_AUTH_FAILED");
    expect(() =>
      codec.openParts({
        ...messageContext({ messageId: "message-b", parentMessageId: "message-a" }),
        parts: first,
      }),
    ).toThrow("NODE_CONVERSATION_ENVELOPE_AUTH_FAILED");
  });

  test("binds event ciphertext to run and event identity", () => {
    const context = {
      ownerId: "owner-a",
      nodeId: "node-a",
      threadId: "thread-a",
      runId: "run-a",
      eventId: "event-a",
    };
    const payload = { delta: "private-event" };
    const sealed = codec.sealEvent({ ...context, payload });
    expect(codec.openEvent({ ...context, payload: sealed })).toEqual(payload);
    expect(() =>
      codec.openEvent({ ...context, eventId: "event-b", payload: sealed }),
    ).toThrow("NODE_CONVERSATION_ENVELOPE_AUTH_FAILED");
  });
});
