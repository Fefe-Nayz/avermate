import {
  deleteStorageObject,
  headStorageObject,
  putStorageObject,
  readStorageObject,
  storageDriver,
  type ManagedStorageProvider,
} from "../lib/storage-backend";
import type { ConversationCheckpointBlobStore } from "./checkpoint-store";

/** Private object-store adapter. No signed URL or browser-readable file row exists. */
export class ManagedCheckpointBlobStore implements ConversationCheckpointBlobStore {
  constructor(
    private readonly provider: ManagedStorageProvider = storageDriver(),
  ) {}

  async put(key: string, bytes: Uint8Array) {
    try {
      await putStorageObject({
        provider: this.provider,
        storageKey: key,
        // This controls private bucket/cache semantics only. Checkpoints never
        // get a `files` row and cannot be exchanged for a file URL.
        purpose: "document-artifact",
        file: new File([Uint8Array.from(bytes).buffer], "checkpoint.bin", {
          type: "application/octet-stream",
        }),
        mimeType: "application/octet-stream",
      });
    } catch (error) {
      // Idempotent content-addressed promotion may race or resume after a crash.
      const current = await this.head(key);
      if (!current || current.byteLength !== bytes.byteLength) throw error;
    }
  }

  async get(key: string, maxBytes: number) {
    return new Uint8Array(
      await readStorageObject(this.provider, key, { maxBytes }),
    );
  }

  async head(key: string) {
    try {
      const value = await headStorageObject(this.provider, key);
      return { byteLength: value.byteSize };
    } catch {
      return null;
    }
  }

  delete(key: string) {
    return deleteStorageObject(this.provider, key);
  }
}
