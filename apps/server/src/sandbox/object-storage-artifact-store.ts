import {
  objectSha256Schema,
  ownedObjectRefSchema,
  type ObjectStorageProvider,
} from "@avermate/agent-contracts";
import { open, mkdtemp, rm, stat, type FileHandle } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import type {
  ArtifactStagingUpload,
  TrustedArtifactObjectStore,
} from "./artifact-adoption";

const serializedArtifactRefSchema = z.strictObject({
  schemaVersion: z.literal(1),
  providerId: z.string().trim().min(1).max(128),
  ref: ownedObjectRefSchema,
  digest: objectSha256Schema,
});
type SerializedArtifactRef = z.infer<typeof serializedArtifactRefSchema>;

/**
 * Disk-bounded staging adapter over the common object-storage contract. The
 * temporary file is never exposed and is deleted after commit/abort.
 */
export class ObjectStorageTrustedArtifactStore
  implements TrustedArtifactObjectStore
{
  #index = 0;

  constructor(
    private readonly storage: ObjectStorageProvider,
    private readonly scope: string,
  ) {
    if (!/^[a-zA-Z0-9._-]{1,200}$/u.test(scope)) {
      throw new Error("Artifact staging scope is invalid");
    }
  }

  async begin(input: {
    ownerId: string;
    purpose: string;
    expectedMaxBytes: number;
  }): Promise<ArtifactStagingUpload> {
    if (
      !Number.isSafeInteger(input.expectedMaxBytes) ||
      input.expectedMaxBytes < 1 ||
      input.expectedMaxBytes > 2 * 1024 ** 3
    ) {
      throw new Error("Artifact staging byte limit is invalid");
    }
    const index = this.#index;
    this.#index += 1;
    const directory = await mkdtemp(join(tmpdir(), "avermate-adoption-"));
    const path = join(directory, "payload");
    const handle = await open(path, "wx", 0o600);
    let bytes = 0;
    let openHandle: FileHandle | null = handle;
    let terminal = false;
    const close = async () => {
      const current = openHandle;
      openHandle = null;
      await current?.close();
    };
    const cleanup = async () => {
      await close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    };

    return {
      write: async (chunk) => {
        if (terminal || !openHandle) throw new Error("Artifact staging upload is closed");
        bytes += chunk.byteLength;
        if (bytes > input.expectedMaxBytes) {
          terminal = true;
          await cleanup();
          throw new Error("Artifact staging upload exceeded its byte limit");
        }
        await openHandle.write(chunk);
      },
      commit: async (commit) => {
        if (terminal || !openHandle) throw new Error("Artifact staging upload is closed");
        terminal = true;
        const digest = objectSha256Schema.parse(commit.digest);
        if (commit.byteSize !== bytes || commit.byteSize > input.expectedMaxBytes) {
          await cleanup();
          throw new Error("Artifact staging size does not match verified output");
        }
        await close();
        const info = await stat(path);
        if (!info.isFile() || info.size !== commit.byteSize) {
          await cleanup();
          throw new Error("Artifact staging file changed before commit");
        }
        const purpose = input.purpose
          .toLowerCase()
          .replace(/[^a-z0-9._-]+/gu, "-")
          .replace(/^-+|-+$/gu, "")
          .slice(0, 80) || "worker";
        const ref = ownedObjectRefSchema.parse({
          ownerId: input.ownerId,
          namespace: "sandbox-outputs",
          key: `${purpose}/${this.scope}/${String(index).padStart(4, "0")}/${digest.slice(7)}`,
        });
        try {
          await this.storage.put({
            ref,
            body: Bun.file(path).stream(),
            byteSize: commit.byteSize,
            mimeType: commit.mimeType,
            expectedDigest: digest,
            idempotencyKey: `sandbox-output:${this.scope}:${index}`,
          });
          return JSON.stringify({
            schemaVersion: 1,
            providerId: this.storage.id,
            ref,
            digest,
          } satisfies SerializedArtifactRef);
        } finally {
          await cleanup();
        }
      },
      abort: async () => {
        if (terminal) return;
        terminal = true;
        await cleanup();
      },
    };
  }

  async revoke(value: string): Promise<void> {
    const decoded = serializedArtifactRefSchema.parse(JSON.parse(value));
    if (decoded.providerId !== this.storage.id) {
      throw new Error("Adopted artifact reference is invalid");
    }
    await this.storage.delete({
      ref: decoded.ref,
      expectedDigest: decoded.digest,
      idempotencyKey: `sandbox-output-revoke:${this.scope}:${decoded.digest.slice(7, 23)}`,
    });
  }
}
