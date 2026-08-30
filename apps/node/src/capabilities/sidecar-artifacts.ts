import { createHash } from "node:crypto";
import { z } from "zod";
import {
  capabilityArtifactRefSchema,
  nodeCapabilityResultDigestPayload,
  nodeCapabilityResultV1Schema,
  type CapabilityArtifactRef,
  type NodeCapabilityJobManifestV1,
  type NodeCapabilityRequestV1,
  type ObjectStorageProvider,
} from "@avermate/agent-contracts";
import { canonicalDigest, canonicalJson, sha256Digest } from "../canonical-json";
import type { NodeCapabilityAdapterContext } from "./registry";

/** Private Node↔sidecar wire format. Never part of the Core relay or manifest. */
const inlineResultSchema = z.strictObject({
  artifactProtocol: z.literal("inline-base64-v1"),
  result: nodeCapabilityResultV1Schema,
  artifacts: z.array(z.strictObject({
    artifact: capabilityArtifactRefSchema,
    bytesBase64: z.string().max(48 * 1024 * 1024),
  })).max(256),
});

export function sidecarWireLimit(logicalLimit: number) {
  return Math.min(Math.ceil(logicalLimit * 4 / 3) + 512 * 1024, 64 * 1024 * 1024);
}
const MAX_INLINE_ARTIFACT_BYTES = 32 * 1024 * 1024;

function rewrite(value: unknown, refs: ReadonlyMap<string, CapabilityArtifactRef>): unknown {
  if (!value || typeof value !== "object") return value;
  const artifact = capabilityArtifactRefSchema.safeParse(value);
  if (artifact.success) return refs.get(canonicalJson(artifact.data)) ?? artifact.data;
  if (Array.isArray(value)) return value.map((entry) => rewrite(entry, refs));
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, rewrite(entry, refs)]));
}

export class NodeSidecarArtifactIo {
  constructor(private readonly storage: ObjectStorageProvider) {}

  async request(
    context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1,
    maximumBytes: number,
  ) {
    maximumBytes = Math.min(maximumBytes, MAX_INLINE_ARTIFACT_BYTES);
    const artifacts = "inputArtifacts" in request ? request.inputArtifacts : request.inputs;
    if (artifacts.length === 0) return request;
    if (artifacts.reduce((sum, ref) => sum + ref.byteSize, 0) > maximumBytes) {
      throw new Error("NODE_CAPABILITY_SIDECAR_INPUT_LIMIT_EXCEEDED");
    }
    const inline = [];
    for (const artifact of artifacts) {
      context.signal.throwIfAborted();
      if (artifact.object.ownerId !== context.ownerId || artifact.object.namespace !== "capability-inputs") {
        throw new Error("NODE_CAPABILITY_SIDECAR_INPUT_AUTHORITY_INVALID");
      }
      const metadata = await this.storage.stat({ ref: artifact.object });
      if (!metadata || metadata.digest !== artifact.digest || metadata.byteSize !== artifact.byteSize || metadata.mimeType !== artifact.mimeType) {
        throw new Error("NODE_CAPABILITY_SIDECAR_INPUT_METADATA_MISMATCH");
      }
      const reader = (await this.storage.get({ ref: artifact.object })).getReader();
      const chunks: Uint8Array[] = [];
      let total = 0;
      const abort = () => { void reader.cancel(context.signal.reason).catch(() => undefined); };
      context.signal.addEventListener("abort", abort, { once: true });
      try {
        while (true) {
          context.signal.throwIfAborted();
          const chunk = await reader.read();
          if (chunk.done) break;
          total += chunk.value.byteLength;
          if (total > artifact.byteSize || total > maximumBytes) {
            await reader.cancel("artifact exceeds grant");
            throw new Error("NODE_CAPABILITY_SIDECAR_INPUT_LIMIT_EXCEEDED");
          }
          chunks.push(chunk.value);
        }
      } finally {
        context.signal.removeEventListener("abort", abort);
        reader.releaseLock();
      }
      context.signal.throwIfAborted();
      const bytes = Buffer.concat(chunks);
      if (total < 1 || total !== artifact.byteSize || sha256Digest(bytes) !== artifact.digest) {
        throw new Error("NODE_CAPABILITY_SIDECAR_INPUT_BYTES_MISMATCH");
      }
      inline.push({ artifact, bytesBase64: bytes.toString("base64") });
    }
    return { artifactProtocol: "inline-base64-v1" as const, request, artifacts: inline };
  }

  async result(
    context: NodeCapabilityAdapterContext,
    request: NodeCapabilityRequestV1 | NodeCapabilityJobManifestV1,
    raw: unknown,
    maximumBytes: number,
  ) {
    maximumBytes = Math.min(maximumBytes, MAX_INLINE_ARTIFACT_BYTES);
    const wrapped = inlineResultSchema.safeParse(raw);
    if (!wrapped.success) {
      const plain = nodeCapabilityResultV1Schema.parse(raw);
      if (plain.outputArtifacts.length > 0) throw new Error("NODE_CAPABILITY_SIDECAR_OUTPUT_BYTES_REQUIRED");
      return plain;
    }
    const { result, artifacts } = wrapped.data;
    if (result.operationId !== request.operationId || result.offeringId !== request.offeringId || result.requestDigest !== request.requestDigest || result.outputDigest !== canonicalDigest(nodeCapabilityResultDigestPayload(result))) {
      throw new Error("NODE_CAPABILITY_SIDECAR_RESULT_BINDING_INVALID");
    }
    const authority = artifacts.map((entry) => canonicalJson(entry.artifact));
    if (new Set(authority).size !== authority.length || canonicalJson([...authority].sort()) !== canonicalJson(result.outputArtifacts.map(canonicalJson).sort())) {
      throw new Error("NODE_CAPABILITY_SIDECAR_OUTPUT_AUTHORITY_INVALID");
    }
    const outputBytes = artifacts.reduce((sum, entry) => sum + entry.artifact.byteSize, 0) + Buffer.byteLength(canonicalJson(result.result));
    if (outputBytes > maximumBytes) throw new Error("NODE_CAPABILITY_SIDECAR_OUTPUT_LIMIT_EXCEEDED");
    // Validate every blob before committing any of them. Canonical base64 rejects
    // ignored garbage and truncated encodings accepted by permissive decoders.
    const checked = artifacts.map(({ artifact, bytesBase64 }) => {
      if (artifact.object.ownerId !== context.ownerId || artifact.byteSize < 1 || bytesBase64.length > Math.ceil(artifact.byteSize / 3) * 4) {
        throw new Error("NODE_CAPABILITY_SIDECAR_OUTPUT_AUTHORITY_INVALID");
      }
      const bytes = Buffer.from(bytesBase64, "base64");
      if (bytes.toString("base64") !== bytesBase64 || bytes.length !== artifact.byteSize || sha256Digest(bytes) !== artifact.digest) {
        throw new Error("NODE_CAPABILITY_SIDECAR_OUTPUT_BYTES_MISMATCH");
      }
      const operationKey = createHash("sha256").update(context.operationId).digest("hex");
      const ref = capabilityArtifactRefSchema.parse({
        ...artifact,
        object: { ownerId: context.ownerId, namespace: "capability-outputs", key: `${operationKey}/${canonicalDigest(artifact).slice(7)}` },
      });
      return { artifact, bytes, ref };
    });
    const replacements = new Map<string, CapabilityArtifactRef>();
    for (const { artifact, bytes, ref } of checked) {
      context.signal.throwIfAborted();
      const committed = await this.storage.put({
        ref: ref.object,
        body: new ReadableStream({ start(controller) { controller.enqueue(bytes); controller.close(); } }),
        byteSize: ref.byteSize,
        mimeType: ref.mimeType,
        expectedDigest: ref.digest,
        idempotencyKey: `capability-output-${canonicalDigest(ref).slice(7, 55)}`,
      });
      if (canonicalJson(committed.ref) !== canonicalJson(ref.object) || committed.digest !== ref.digest || committed.byteSize !== ref.byteSize || committed.mimeType !== ref.mimeType) {
        throw new Error("NODE_CAPABILITY_SIDECAR_OUTPUT_COMMIT_MISMATCH");
      }
      replacements.set(canonicalJson(artifact), ref);
    }
    const adopted = { ...result, result: rewrite(result.result, replacements), outputArtifacts: result.outputArtifacts.map((ref) => replacements.get(canonicalJson(ref))!) };
    return nodeCapabilityResultV1Schema.parse({ ...adopted, outputDigest: canonicalDigest(nodeCapabilityResultDigestPayload(adopted)) });
  }
}
