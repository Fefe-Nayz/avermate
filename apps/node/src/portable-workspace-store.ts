import {
  sandboxWorkspaceSnapshotRefSchema,
  type ObjectStorageProvider,
  type SandboxProviderId,
  type SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";

const FORMAT = "avermate-portable-workspace-v1";
const NAMESPACE = "sandbox-workspaces";
const MAX_MANIFEST_BYTES = 4 * 1024 * 1024;

export type NodePortableWorkspaceFile = {
  relativePath: string;
  bytes: Uint8Array;
  mode?: number;
};

type PortableManifest = {
  version: 1;
  ownerHash: string;
  files: Array<{
    relativePath: string;
    digest: `sha256:${string}`;
    byteLength: number;
    mode: number;
  }>;
};

function sha256(value: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
}

function ownerHash(ownerId: string) {
  return sha256(ownerId).slice("sha256:".length);
}

function assertSafePath(path: string) {
  if (
    path.length < 1 ||
    path.length > 1_024 ||
    path.startsWith("/") ||
    path.endsWith("/") ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("PORTABLE_WORKSPACE_PATH_INVALID");
  }
}

function bytesStream(bytes: Uint8Array) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

async function readAll(
  storage: ObjectStorageProvider,
  ownerId: string,
  key: string,
  maximumBytes: number,
) {
  const stream = await storage.get({
    ref: { ownerId, namespace: NAMESPACE, key },
    maxBytes: maximumBytes,
  });
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maximumBytes) {
        throw new Error("PORTABLE_WORKSPACE_READ_LIMIT_EXCEEDED");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** Owner-bound, content-addressed logical snapshots backed by Node storage. */
export class NodePortableWorkspaceSnapshotStore {
  constructor(private readonly storage: ObjectStorageProvider) {}

  async capture(input: {
    provider: SandboxProviderId;
    ownerId: string;
    files: readonly NodePortableWorkspaceFile[];
  }): Promise<SandboxWorkspaceSnapshotRef> {
    const prefix = ownerHash(input.ownerId);
    const paths = new Set<string>();
    const manifest: PortableManifest = {
      version: 1,
      ownerHash: prefix,
      files: [],
    };
    const sorted = [...input.files].toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );
    for (const file of sorted) {
      assertSafePath(file.relativePath);
      const folded = file.relativePath.normalize("NFC").toLocaleLowerCase("en-US");
      if (paths.has(folded)) throw new Error("PORTABLE_WORKSPACE_PATH_DUPLICATE");
      paths.add(folded);
    }
    for (const file of sorted) {
      const digest = sha256(file.bytes);
      await this.#put(
        input.ownerId,
        `blobs/${digest.slice("sha256:".length)}`,
        file.bytes,
        "application/octet-stream",
        digest,
      );
      manifest.files.push({
        relativePath: file.relativePath,
        digest,
        byteLength: file.bytes.byteLength,
        mode: file.mode ?? 0o600,
      });
    }
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    if (bytes.byteLength > MAX_MANIFEST_BYTES) {
      throw new Error("PORTABLE_WORKSPACE_MANIFEST_TOO_LARGE");
    }
    const digest = sha256(bytes);
    await this.#put(
      input.ownerId,
      `manifests/${digest.slice("sha256:".length)}.json`,
      bytes,
      "application/json",
      digest,
    );
    return sandboxWorkspaceSnapshotRefSchema.parse({
      provider: input.provider,
      digest,
      format: FORMAT,
    });
  }

  async restore(input: {
    ref: SandboxWorkspaceSnapshotRef;
    ownerId: string;
    maximumBytes: number;
    maximumFiles: number;
  }): Promise<readonly NodePortableWorkspaceFile[]> {
    const ref = sandboxWorkspaceSnapshotRefSchema.parse(input.ref);
    if (ref.format !== FORMAT) {
      throw new Error("PORTABLE_WORKSPACE_FORMAT_UNSUPPORTED");
    }
    const manifestBytes = await readAll(
      this.storage,
      input.ownerId,
      `manifests/${ref.digest.slice("sha256:".length)}.json`,
      MAX_MANIFEST_BYTES,
    );
    if (sha256(manifestBytes) !== ref.digest) {
      throw new Error("PORTABLE_WORKSPACE_MANIFEST_DIGEST_MISMATCH");
    }
    const manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
    ) as Partial<PortableManifest>;
    const prefix = ownerHash(input.ownerId);
    if (
      manifest.version !== 1 ||
      manifest.ownerHash !== prefix ||
      !Array.isArray(manifest.files) ||
      manifest.files.length > input.maximumFiles
    ) {
      throw new Error("PORTABLE_WORKSPACE_MANIFEST_INVALID");
    }
    const files: NodePortableWorkspaceFile[] = [];
    const paths = new Set<string>();
    let total = 0;
    for (const entry of manifest.files) {
      if (
        !entry ||
        typeof entry.relativePath !== "string" ||
        !/^sha256:[a-f0-9]{64}$/u.test(entry.digest ?? "") ||
        !Number.isSafeInteger(entry.byteLength) ||
        entry.byteLength < 0 ||
        !Number.isSafeInteger(entry.mode)
      ) {
        throw new Error("PORTABLE_WORKSPACE_MANIFEST_INVALID");
      }
      assertSafePath(entry.relativePath);
      const folded = entry.relativePath
        .normalize("NFC")
        .toLocaleLowerCase("en-US");
      if (paths.has(folded)) throw new Error("PORTABLE_WORKSPACE_PATH_DUPLICATE");
      paths.add(folded);
      total += entry.byteLength;
      if (total > input.maximumBytes) {
        throw new Error("PORTABLE_WORKSPACE_SIZE_LIMIT_EXCEEDED");
      }
      const bytes = await readAll(
        this.storage,
        input.ownerId,
        `blobs/${entry.digest.slice("sha256:".length)}`,
        entry.byteLength + 1,
      );
      if (bytes.byteLength !== entry.byteLength || sha256(bytes) !== entry.digest) {
        throw new Error("PORTABLE_WORKSPACE_BLOB_DIGEST_MISMATCH");
      }
      files.push({
        relativePath: entry.relativePath,
        bytes,
        mode: entry.mode,
      });
    }
    return Object.freeze(files);
  }

  async #put(
    ownerId: string,
    key: string,
    bytes: Uint8Array,
    mimeType: string,
    digest: `sha256:${string}`,
  ) {
    await this.storage.put({
      ref: { ownerId, namespace: NAMESPACE, key },
      body: bytesStream(bytes),
      byteSize: bytes.byteLength,
      mimeType,
      expectedDigest: digest,
      idempotencyKey: `portable-${digest.slice("sha256:".length)}`,
    });
  }
}
