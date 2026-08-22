import { createHash } from "node:crypto";
import { ManagedCheckpointBlobStore } from "../assistant/managed-checkpoint-blob-store";
import { open, seal } from "../lib/crypto";
import { env } from "../lib/env";
import {
  canonicalToolContinuation,
  InMemoryToolActionContinuationStore,
  toolActionContinuationSchema,
  type ToolActionContinuation,
  type ToolActionContinuationStore,
} from "./action-continuation";

const MAX_CONTINUATION_BYTES = 64 * 1024;

function continuationKey(userId: string, actionId: string): string {
  const ownerHash = createHash("sha256").update(userId).digest("hex");
  return `private/document-artifact/action-continuations/${ownerHash}/${encodeURIComponent(actionId)}.sealed`;
}

function isMissingObject(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as {
    code?: unknown;
    name?: unknown;
    statusCode?: unknown;
  };
  return (
    candidate.code === "ENOENT" ||
    candidate.name === "NoSuchKey" ||
    candidate.name === "NotFound" ||
    candidate.statusCode === 404
  );
}

/**
 * Private, sealed continuation storage. Raw tool arguments never enter the
 * action/audit tables and no browser-readable `files` row or signed URL is
 * created for this object.
 */
export class ManagedToolActionContinuationStore
  implements ToolActionContinuationStore
{
  constructor(private readonly blobs = new ManagedCheckpointBlobStore()) {}

  async stage(value: ToolActionContinuation): Promise<void> {
    const parsed = toolActionContinuationSchema.parse(value);
    const plaintext = JSON.stringify(parsed);
    if (plaintext === undefined) {
      throw new Error("Action continuation is not JSON serializable");
    }
    if (new TextEncoder().encode(plaintext).byteLength > MAX_CONTINUATION_BYTES) {
      throw new Error("Action continuation exceeds its private storage budget");
    }
    const existing = await this.load(parsed.userId, parsed.actionId);
    if (existing) {
      if (
        canonicalToolContinuation(existing) !==
        canonicalToolContinuation(parsed)
      ) {
        throw new Error("Action continuation replay diverged");
      }
      return;
    }
    const bytes = new TextEncoder().encode(seal(plaintext));
    await this.blobs.put(
      continuationKey(parsed.userId, parsed.actionId),
      bytes,
    );
    // Resolve a concurrent create race by comparing the authenticated payload,
    // never by trusting equal ciphertext length.
    const committed = await this.load(parsed.userId, parsed.actionId);
    if (
      !committed ||
      canonicalToolContinuation(committed) !==
        canonicalToolContinuation(parsed)
    ) {
      throw new Error("Action continuation promotion diverged");
    }
  }

  async load(
    userId: string,
    actionId: string,
  ): Promise<ToolActionContinuation | null> {
    try {
      const bytes = await this.blobs.get(
        continuationKey(userId, actionId),
        MAX_CONTINUATION_BYTES * 2,
      );
      const parsed = toolActionContinuationSchema.parse(
        JSON.parse(open(new TextDecoder().decode(bytes))),
      );
      if (parsed.userId !== userId || parsed.actionId !== actionId) {
        throw new Error("Action continuation ownership binding mismatch");
      }
      return parsed;
    } catch (error) {
      if (isMissingObject(error)) return null;
      throw error;
    }
  }

  discard(userId: string, actionId: string): Promise<void> {
    return this.blobs.delete(continuationKey(userId, actionId));
  }
}

export const managedToolActionContinuationStore: ToolActionContinuationStore =
  env.NODE_ENV === "test"
    ? new InMemoryToolActionContinuationStore()
    : new ManagedToolActionContinuationStore();
