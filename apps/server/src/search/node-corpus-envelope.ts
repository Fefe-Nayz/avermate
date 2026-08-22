import {
  stagedContentChunkSchema,
  type StagedContentChunk,
} from "@avermate/agent-contracts";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";

const PREFIX = "avermate-node-chunk:v1:";
const MAX_COLUMN_CHARS = 262_144;
const MAX_CLEAR_BYTES = 600_000;

type EnvelopeContext = {
  ownerId: string;
  nodeId: string;
  sourceId: string;
  versionKey: string;
  ordinal: number;
  contentHash: string;
};

function aad(input: EnvelopeContext) {
  return [
    "avermate-node-corpus-envelope-v1",
    input.ownerId,
    input.nodeId,
    input.sourceId,
    input.versionKey,
    String(input.ordinal),
    input.contentHash,
  ].join("\0");
}

/** Encrypted Core recovery envelope; never used as an offline read fallback. */
export class NodeCorpusEnvelopeCodec {
  readonly #key: Buffer;

  constructor(secret: string) {
    if (new TextEncoder().encode(secret).byteLength < 32) {
      throw new Error("NODE_CORPUS_ENVELOPE_SECRET_TOO_SHORT");
    }
    this.#key = createHash("sha256")
      .update("avermate-node-corpus-envelope-key-v1\0")
      .update(secret)
      .digest();
  }

  seal(input: EnvelopeContext & { chunk: StagedContentChunk }) {
    const chunk = stagedContentChunkSchema.parse({
      ...input.chunk,
      chunkId: undefined,
    });
    const clear = Buffer.from(JSON.stringify(chunk), "utf8");
    if (clear.byteLength > MAX_CLEAR_BYTES) {
      throw new Error("NODE_CORPUS_ENVELOPE_CLEAR_LIMIT_EXCEEDED");
    }
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(Buffer.from(aad(input)));
    const ciphertext = Buffer.concat([
      cipher.update(gzipSync(clear)),
      cipher.final(),
    ]);
    const encoded = Buffer.concat([
      nonce,
      cipher.getAuthTag(),
      ciphertext,
    ]).toString("base64url");
    const split = Math.ceil(encoded.length / 2);
    const text = `${PREFIX}${encoded.slice(0, split)}`;
    const normalizedText = encoded.slice(split);
    if (
      text.length > MAX_COLUMN_CHARS ||
      normalizedText.length > MAX_COLUMN_CHARS
    ) {
      throw new Error("NODE_CORPUS_ENVELOPE_COLUMN_LIMIT_EXCEEDED");
    }
    return {
      ...chunk,
      text,
      normalizedText,
      headingPath: null,
    } satisfies StagedContentChunk;
  }

  open(
    input: EnvelopeContext & {
      chunkId?: string;
      text: string;
      normalizedText: string;
    },
  ) {
    if (!input.text.startsWith(PREFIX)) {
      throw new Error("NODE_CORPUS_ENVELOPE_REQUIRED");
    }
    let packed: Buffer;
    try {
      packed = Buffer.from(
        `${input.text.slice(PREFIX.length)}${input.normalizedText}`,
        "base64url",
      );
    } catch {
      throw new Error("NODE_CORPUS_ENVELOPE_INVALID");
    }
    if (packed.byteLength < 29) {
      throw new Error("NODE_CORPUS_ENVELOPE_INVALID");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        packed.subarray(0, 12),
      );
      decipher.setAAD(Buffer.from(aad(input)));
      decipher.setAuthTag(packed.subarray(12, 28));
      const compressed = Buffer.concat([
        decipher.update(packed.subarray(28)),
        decipher.final(),
      ]);
      const clear = gunzipSync(compressed, {
        maxOutputLength: MAX_CLEAR_BYTES,
      });
      const chunk = stagedContentChunkSchema.parse(JSON.parse(clear.toString("utf8")));
      if (
        chunk.ordinal !== input.ordinal ||
        chunk.contentHash !== input.contentHash
      ) {
        throw new Error("NODE_CORPUS_ENVELOPE_CONTEXT_MISMATCH");
      }
      return stagedContentChunkSchema.parse({
        ...chunk,
        ...(input.chunkId ? { chunkId: input.chunkId } : {}),
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message === "NODE_CORPUS_ENVELOPE_CONTEXT_MISMATCH"
      ) {
        throw error;
      }
      throw new Error("NODE_CORPUS_ENVELOPE_AUTH_FAILED");
    }
  }
}

export function isNodeCorpusEnvelope(text: string) {
  return text.startsWith(PREFIX);
}
