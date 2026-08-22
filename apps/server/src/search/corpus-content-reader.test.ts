import { describe, expect, test } from "bun:test";
import type { NodeLexicalSearchTransport } from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import {
  RoutedCorpusContentReader,
  type AuthorizedCorpusChunkRow,
} from "./corpus-content-reader";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function row(input: {
  id: string;
  ownerId?: string;
  placement?: "core" | "node";
  nodeId?: string | null;
  text?: string;
}): AuthorizedCorpusChunkRow {
  const text = input.text ?? `local:${input.id}`;
  return {
    id: input.id,
    userId: input.ownerId ?? "owner-a",
    placement: input.placement ?? "core",
    placementRef: input.nodeId ?? null,
    text,
    normalizedText: text.toLowerCase(),
    contentHash: sha256(text),
    headingPathJson: JSON.stringify(["Cours"]),
  };
}

function transport(input: {
  online?: (nodeId: string) => boolean | Promise<boolean>;
  get?: NodeLexicalSearchTransport["getLexicalChunks"];
}) {
  return {
    online: async (nodeId: string) => input.online?.(nodeId) ?? true,
    getLexicalChunks:
      input.get ??
      (async ({ chunkIds }) =>
        chunkIds.map((chunkId) => {
          const text = `remote:${chunkId}`;
          return {
            chunkId,
            ordinal: 0,
            text,
            normalizedText: text,
            tokenEstimate: 1,
            contentHash: sha256(text),
            locator: { kind: "pdf" as const, page: 1 },
            headingPath: ["Cours"],
            evidenceKind: "native-text" as const,
          };
        })),
  } as unknown as NodeLexicalSearchTransport;
}

describe("RoutedCorpusContentReader", () => {
  test("reads Core plaintext locally without contacting a Node", async () => {
    let onlineCalls = 0;
    const reader = new RoutedCorpusContentReader(
      {} as never,
      transport({ online: () => (++onlineCalls, true) }),
    );
    const local = row({ id: "chunk-core", text: "cours local" });

    expect((await reader.hydrate([local])).get("chunk-core")?.text).toBe(
      "cours local",
    );
    expect(onlineCalls).toBe(0);
  });

  test("reads Node bodies only from the owner-bound exact relay", async () => {
    const calls: Array<{ nodeId: string; ownerId: string; chunkIds: string[] }> = [];
    const remoteText = "contenu canonique du nœud";
    const reader = new RoutedCorpusContentReader(
      {} as never,
      transport({
        get: async (input) => {
          calls.push({ ...input, chunkIds: [...input.chunkIds] });
          return input.chunkIds.map((chunkId, ordinal) => ({
            chunkId,
            ordinal,
            text: remoteText,
            normalizedText: remoteText,
            tokenEstimate: 8,
            contentHash: sha256(remoteText),
            locator: { kind: "pdf" as const, page: ordinal + 1 },
            headingPath: null,
            evidenceKind: "native-text" as const,
          }));
        },
      }),
    );
    const nodeRow = {
      ...row({
        id: "chunk-node",
        ownerId: "owner-node",
        placement: "node",
        nodeId: "node-a",
        text: "avermate-node-chunk:v1:ciphertext",
      }),
      contentHash: sha256(remoteText),
    } satisfies AuthorizedCorpusChunkRow;

    const body = (await reader.hydrate([nodeRow])).get("chunk-node");
    expect(body?.text).toBe(remoteText);
    expect(body?.text).not.toContain("ciphertext");
    expect(calls).toEqual([
      { nodeId: "node-a", ownerId: "owner-node", chunkIds: ["chunk-node"] },
    ]);
  });

  test("fails closed offline and never exposes a local Node envelope", async () => {
    let getCalls = 0;
    const reader = new RoutedCorpusContentReader(
      {} as never,
      transport({
        online: () => false,
        get: async () => {
          getCalls += 1;
          return [];
        },
      }),
    );
    await expect(
      reader.hydrate([
        row({
          id: "chunk-node",
          placement: "node",
          nodeId: "node-a",
          text: "avermate-node-chunk:v1:must-not-leak",
        }),
      ]),
    ).rejects.toThrow("NODE_RETRIEVAL_CAPABILITY_OFFLINE");
    expect(getCalls).toBe(0);
  });

  test("rejects partial, duplicate, or body-hash-mismatched Node replies", async () => {
    const requested = {
      ...row({ id: "chunk-a", placement: "node", nodeId: "node-a" }),
      contentHash: sha256("expected"),
    } satisfies AuthorizedCorpusChunkRow;
    const missing = new RoutedCorpusContentReader(
      {} as never,
      transport({ get: async () => [] }),
    );
    await expect(missing.hydrate([requested])).rejects.toThrow(
      "NODE_RETRIEVAL_CHUNK_RESULT_INCOMPLETE",
    );

    const altered = new RoutedCorpusContentReader(
      {} as never,
      transport({
        get: async () => [{
          chunkId: "chunk-a",
          ordinal: 0,
          text: "altered",
          normalizedText: "altered",
          tokenEstimate: 1,
          // A compromised relay cannot bless altered text with Core's digest.
          contentHash: sha256("expected"),
          locator: { kind: "pdf", page: 1 },
          headingPath: null,
          evidenceKind: "native-text",
        }],
      }),
    );
    await expect(altered.hydrate([requested])).rejects.toThrow(
      "NODE_RETRIEVAL_CHUNK_IDENTITY_MISMATCH",
    );
  });

  test("rejects a sealed payload attached to Core placement", async () => {
    const reader = new RoutedCorpusContentReader({} as never, transport({}));
    await expect(
      reader.hydrate([
        row({
          id: "chunk-corrupt",
          text: "avermate-node-chunk:v1:ciphertext",
        }),
      ]),
    ).rejects.toThrow("CORE_CORPUS_ENVELOPE_PLACEMENT_MISMATCH");
  });
});
