import { describe, expect, test } from "bun:test";
import {
  UnavailableNodeCitationResolver,
  UnavailableNodeConversationStore,
  UnavailableNodeLexicalSearchBackend,
  UnavailableNodeModelGateway,
  UnavailableNodeSandboxProvider,
  nodeCorpusPlacementAvailable,
} from "./fail-closed-adapters";

describe("unimplemented node placements fail closed", () => {
  test("never fabricates offline conversation history", async () => {
    const store = new UnavailableNodeConversationStore();
    const events: unknown[] = [];
    await expect(
      (async () => {
        for await (const event of store.replayEvents({
          ownerId: "user-1",
          threadId: "thread-1",
          branchId: "branch-1",
          runId: "run-1",
          afterSequence: 0,
          limit: 10,
        })) {
          events.push(event);
        }
      })(),
    ).rejects.toThrow("PLACEMENT_UNAVAILABLE");
    expect(events).toEqual([]);
  });

  test("does not advertise retrieval without the mandatory lexical backend", async () => {
    const lexical = new UnavailableNodeLexicalSearchBackend();
    expect((await lexical.capabilities()).available).toBe(false);
    expect(
      await nodeCorpusPlacementAvailable({
        corpusStore: {} as never,
        lexical,
        citations: new UnavailableNodeCitationResolver(),
      }),
    ).toBe(false);
  });

  test("advertises neither models nor sandbox before their adapters conform", async () => {
    const models = new UnavailableNodeModelGateway();
    expect(
      await models.listModels({
        ownerId: "user-1",
        placement: "node",
        allowedOrigins: [],
      }),
    ).toEqual([]);
    await expect(
      models.embed({ ownerId: "user-1", modelId: "missing", inputs: ["x"] }),
    ).rejects.toThrow("NODE_MODEL_GATEWAY_NOT_CONFORMANT");

    const sandbox = new UnavailableNodeSandboxProvider();
    expect(await sandbox.capabilities()).toEqual({
      providerId: "disabled",
      available: false,
      profiles: [],
    });
  });
});
