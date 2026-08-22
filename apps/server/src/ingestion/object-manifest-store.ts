import { createHash } from "node:crypto";
import type {
  ObjectStorageProvider,
  OwnedObjectRef,
} from "@avermate/agent-contracts";
import { canonicalJson } from "../search/values";

function stream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

/** Immutable, bounded JSON requests for sandbox workers. */
export class ObjectStorageManifestStore {
  constructor(
    private readonly storage: ObjectStorageProvider,
    private readonly maxBytes = 1024 * 1024,
  ) {}

  async put(input: {
    ownerId: string;
    namespace: string;
    kind: string;
    value: unknown;
    idempotencyKey: string;
  }) {
    const serialized = canonicalJson(input.value);
    const bytes = new TextEncoder().encode(serialized);
    if (bytes.byteLength > this.maxBytes) {
      throw new Error("Structured sandbox input exceeds its manifest limit");
    }
    const digest = createHash("sha256").update(bytes).digest("hex");
    const ref: OwnedObjectRef = {
      ownerId: input.ownerId,
      namespace: input.namespace,
      key: `${input.kind}/${digest}.json`,
    };
    const commit = await this.storage.put({
      ref,
      body: stream(bytes),
      byteSize: bytes.byteLength,
      mimeType: "application/json",
      expectedDigest: `sha256:${digest}`,
      idempotencyKey: input.idempotencyKey,
    });
    return Object.freeze({
      ref,
      digest,
      byteSize: bytes.byteLength,
      providerId: this.storage.id,
      manifestRef: `${this.storage.id}:${ref.namespace}:${ref.key}:sha256:${digest}`,
      replayed: commit.replayed,
    });
  }

  async get(input: { ownerId: string; manifestRef: string }) {
    const matched = /^([^:]{1,128}):([a-z0-9][a-z0-9-]{0,127}):([a-zA-Z0-9][a-zA-Z0-9._/-]{0,1023}):sha256:([a-f0-9]{64})$/u.exec(
      input.manifestRef,
    );
    if (!matched) throw new Error("Structured sandbox manifest reference is invalid");
    const [, providerId, namespace, key, digestHex] = matched;
    if (providerId !== this.storage.id || !namespace || !key || !digestHex) {
      throw new Error("Structured sandbox manifest provider is unavailable");
    }
    const ref: OwnedObjectRef = { ownerId: input.ownerId, namespace, key };
    const metadata = await this.storage.stat({ ref });
    const expectedDigest: `sha256:${string}` = `sha256:${digestHex}`;
    if (
      !metadata ||
      metadata.digest !== expectedDigest ||
      metadata.byteSize < 2 ||
      metadata.byteSize > this.maxBytes ||
      metadata.mimeType !== "application/json"
    ) {
      throw new Error("Structured sandbox manifest is missing or changed");
    }
    const bytes = await readBounded(
      await this.storage.get({ ref, maxBytes: this.maxBytes }),
      this.maxBytes,
    );
    const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    if (
      bytes.byteLength !== metadata.byteSize ||
      actualDigest !== expectedDigest
    ) {
      throw new Error("Structured sandbox manifest bytes failed verification");
    }
    const value = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes),
    ) as unknown;
    return Object.freeze({ ref, bytes, digest: expectedDigest, value });
  }
}

async function readBounded(
  stream: ReadableStream<Uint8Array>,
  maximum: number,
): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    length += part.value.byteLength;
    if (length > maximum) {
      await reader.cancel().catch(() => undefined);
      throw new Error("Structured sandbox manifest exceeds its read limit");
    }
    chunks.push(part.value.slice());
  }
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}
