import type {
  SandboxProviderId,
  SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { sandboxWorkspaceSnapshotRefSchema } from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import {
  headStorageObject,
  putStorageObject,
  readStorageObject,
  storageDriver,
  type ManagedStorageProvider,
} from "../lib/storage-backend";
import { assertSafeRelativePath } from "./policy";
import type {
  PortableWorkspaceFile,
  PortableWorkspaceSnapshotStore,
} from "./portable-workspace-contract";
export type {
  PortableWorkspaceFile,
  PortableWorkspaceSnapshotStore,
} from "./portable-workspace-contract";

const FORMAT = "avermate-portable-workspace-v1";

function sha256(bytes: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}` as const;
}

function ownerHash(ownerId: string) {
  return sha256(ownerId).slice("sha256:".length);
}

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

/** Private content-addressed logical snapshots, independent of runtime state. */
export class ObjectStoragePortableWorkspaceSnapshotStore
  implements PortableWorkspaceSnapshotStore
{
  constructor(
    private readonly provider: ManagedStorageProvider = storageDriver(),
  ) {}

  async capture(input: {
    provider: SandboxProviderId;
    ownerId: string;
    files: readonly PortableWorkspaceFile[];
  }) {
    const prefix = ownerHash(input.ownerId);
    const paths = new Set<string>();
    const sorted = [...input.files].toSorted((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    );
    const manifest: PortableManifest = {
      version: 1,
      ownerHash: prefix,
      files: [],
    };
    for (const file of sorted) {
      assertSafeRelativePath(file.relativePath);
      if (paths.has(file.relativePath)) {
        throw new Error("PORTABLE_WORKSPACE_PATH_DUPLICATE");
      }
      paths.add(file.relativePath);
      const digest = sha256(file.bytes);
      await this.#put(
        `sandbox-workspaces/${prefix}/blobs/${digest.slice(7)}`,
        file.bytes,
        "application/octet-stream",
      );
      manifest.files.push({
        relativePath: file.relativePath,
        digest,
        byteLength: file.bytes.byteLength,
        mode: file.mode ?? 0o600,
      });
    }
    const bytes = new TextEncoder().encode(JSON.stringify(manifest));
    const digest = sha256(bytes);
    await this.#put(
      `sandbox-workspaces/${prefix}/manifests/${digest.slice(7)}.json`,
      bytes,
      "application/json",
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
  }) {
    const ref = sandboxWorkspaceSnapshotRefSchema.parse(input.ref);
    if (ref.format !== FORMAT) {
      throw new Error("PORTABLE_WORKSPACE_FORMAT_UNSUPPORTED");
    }
    const prefix = ownerHash(input.ownerId);
    const manifestBytes = new Uint8Array(
      await readStorageObject(
        this.provider,
        `sandbox-workspaces/${prefix}/manifests/${ref.digest.slice(7)}.json`,
        { maxBytes: 4 * 1024 * 1024 },
      ),
    );
    if (sha256(manifestBytes) !== ref.digest) {
      throw new Error("PORTABLE_WORKSPACE_MANIFEST_DIGEST_MISMATCH");
    }
    const manifest = JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes),
    ) as Partial<PortableManifest>;
    if (
      manifest.version !== 1 ||
      manifest.ownerHash !== prefix ||
      !Array.isArray(manifest.files) ||
      manifest.files.length > input.maximumFiles
    ) {
      throw new Error("PORTABLE_WORKSPACE_MANIFEST_INVALID");
    }
    let total = 0;
    const output: PortableWorkspaceFile[] = [];
    for (const entry of manifest.files) {
      assertSafeRelativePath(entry.relativePath);
      if (
        !/^sha256:[a-f0-9]{64}$/u.test(entry.digest) ||
        !Number.isSafeInteger(entry.byteLength) ||
        entry.byteLength < 0
      ) {
        throw new Error("PORTABLE_WORKSPACE_MANIFEST_INVALID");
      }
      total += entry.byteLength;
      if (total > input.maximumBytes) {
        throw new Error("PORTABLE_WORKSPACE_SIZE_EXCEEDED");
      }
      const bytes = new Uint8Array(
        await readStorageObject(
          this.provider,
          `sandbox-workspaces/${prefix}/blobs/${entry.digest.slice(7)}`,
          { maxBytes: entry.byteLength },
        ),
      );
      if (bytes.byteLength !== entry.byteLength || sha256(bytes) !== entry.digest) {
        throw new Error("PORTABLE_WORKSPACE_BLOB_DIGEST_MISMATCH");
      }
      output.push({
        relativePath: entry.relativePath,
        bytes,
        mode: entry.mode,
      });
    }
    return output;
  }

  async #put(key: string, bytes: Uint8Array, mimeType: string) {
    try {
      await putStorageObject({
        provider: this.provider,
        storageKey: key,
        purpose: "document-artifact",
        file: new File([Uint8Array.from(bytes).buffer], "workspace.bin", {
          type: mimeType,
        }),
        mimeType,
      });
    } catch (error) {
      // Content-addressed promotion may race, but first-write failures are not
      // hidden: the resulting ref must already be readable at the exact size.
      try {
        const current = await headStorageObject(this.provider, key);
        if (current.byteSize !== bytes.byteLength) throw error;
      } catch {
        throw error;
      }
    }
  }
}
