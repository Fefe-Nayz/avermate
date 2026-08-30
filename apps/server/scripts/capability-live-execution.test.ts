import { expect, test } from "bun:test";
import { executeCapabilityLiveRequest } from "./capability-live-execution";

test("live language gate uses and fully drains the real streaming lane", async () => {
  const phases: string[] = [];
  const result = await executeCapabilityLiveRequest(
    {
      ownerId: "fixture",
      capability: "language.generate",
      purpose: "assistant.chat",
      idempotencyKey: "live:fixture",
      request: {
        schemaVersion: 1,
        messages: [
          { role: "user", parts: [{ type: "text", text: "Bonjour" }] },
        ],
        tools: [],
        maximumOutputTokens: 8,
        responseFormat: "text",
      },
    },
    {
      invoke: async () => {
        throw new Error("unary must not run");
      },
      async *streamLanguage(input) {
        expect(input.idempotencyKey).toBe("live:fixture");
        phases.push("dispatch");
        yield { type: "content-delta", delta: "Bonjour" };
        phases.push("completed");
        yield { type: "finish", reason: "stop" };
      },
    },
  );
  expect(phases).toEqual(["dispatch", "completed"]);
  expect(result).toBeNull();
});

test("live stream failure cannot be mistaken for successful partial evidence", async () => {
  await expect(
    executeCapabilityLiveRequest(
      {
        ownerId: "fixture",
        capability: "language.generate",
        purpose: "assistant.chat",
        idempotencyKey: "live:fixture",
        request: {
          schemaVersion: 1,
          messages: [
            { role: "user", parts: [{ type: "text", text: "Bonjour" }] },
          ],
          tools: [],
          maximumOutputTokens: 8,
          responseFormat: "text",
        },
      },
      {
        invoke: async () => {
          throw new Error("unary must not run");
        },
        async *streamLanguage() {
          yield { type: "content-delta", delta: "partial" };
          throw new Error("stream failed");
        },
      },
    ),
  ).rejects.toThrow("stream failed");
});
