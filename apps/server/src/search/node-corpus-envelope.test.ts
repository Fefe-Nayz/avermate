import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { NodeCorpusEnvelopeCodec } from "./node-corpus-envelope";

const SECRET = "node-corpus-test-secret-that-is-at-least-thirty-two-bytes";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function fixture(text = "Théorème de Pythagore : a² + b² = c²") {
  return {
    ownerId: "user-a",
    nodeId: "node-a",
    sourceId: "source-a",
    versionKey: "version-a",
    ordinal: 3,
    contentHash: sha256(text),
    chunk: {
      chunkId: "chunk-a",
      ordinal: 3,
      text,
      normalizedText: text.toLocaleLowerCase("fr"),
      tokenEstimate: 12,
      contentHash: sha256(text),
      locator: { kind: "pdf" as const, page: 4 },
      headingPath: ["Géométrie", "Triangles"],
      evidenceKind: "native-text" as const,
    },
  };
}

describe("NodeCorpusEnvelopeCodec", () => {
  test("round-trips a chunk without retaining readable body columns", () => {
    const codec = new NodeCorpusEnvelopeCodec(SECRET);
    const input = fixture();
    const sealed = codec.seal(input);

    expect(sealed.text).toStartWith("avermate-node-chunk:v1:");
    expect(sealed.text).not.toContain(input.chunk.text);
    expect(sealed.normalizedText).not.toContain(input.chunk.text);
    expect(sealed.headingPath).toBeNull();

    expect(
      codec.open({
        ...input,
        chunkId: input.chunk.chunkId,
        text: sealed.text,
        normalizedText: sealed.normalizedText,
      }),
    ).toEqual(input.chunk);
  });

  test("binds authentication to every ownership and chunk identity field", () => {
    const codec = new NodeCorpusEnvelopeCodec(SECRET);
    const input = fixture();
    const sealed = codec.seal(input);
    const base = {
      ...input,
      chunkId: input.chunk.chunkId,
      text: sealed.text,
      normalizedText: sealed.normalizedText,
    };
    const mutations = [
      { ...base, ownerId: "user-b" },
      { ...base, nodeId: "node-b" },
      { ...base, sourceId: "source-b" },
      { ...base, versionKey: "version-b" },
      { ...base, ordinal: 4 },
      { ...base, contentHash: "f".repeat(64) },
    ];
    for (const mutation of mutations) {
      expect(() => codec.open(mutation)).toThrow(
        "NODE_CORPUS_ENVELOPE_AUTH_FAILED",
      );
    }
  });

  test("rejects swapped halves, another key, and undersized secrets", () => {
    const codec = new NodeCorpusEnvelopeCodec(SECRET);
    const first = fixture("premier contenu");
    const second = fixture("second contenu");
    const firstSealed = codec.seal(first);
    const secondSealed = codec.seal(second);

    expect(() =>
      codec.open({
        ...first,
        text: firstSealed.text,
        normalizedText: secondSealed.normalizedText,
      }),
    ).toThrow("NODE_CORPUS_ENVELOPE_AUTH_FAILED");
    expect(() =>
      new NodeCorpusEnvelopeCodec(`${SECRET}-different`).open({
        ...first,
        text: firstSealed.text,
        normalizedText: firstSealed.normalizedText,
      }),
    ).toThrow("NODE_CORPUS_ENVELOPE_AUTH_FAILED");
    expect(() => new NodeCorpusEnvelopeCodec("too-short")).toThrow(
      "NODE_CORPUS_ENVELOPE_SECRET_TOO_SHORT",
    );
  });
});
