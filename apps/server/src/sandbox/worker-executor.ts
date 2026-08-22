import {
  sandboxProfileIdSchema,
  sandboxResourceLimitsSchema,
  sandboxWorkspaceSnapshotRefSchema,
  type SandboxExecutionEvent,
  type SandboxExecutionProfile,
  type SandboxFileManifestEntry,
  type SandboxProvider,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { ObjectStorageManifestStore } from "../ingestion/object-manifest-store";
import { NonRetryableJobError } from "../lib/jobs";
import {
  adoptSandboxArtifacts,
  type TrustedArtifactObjectStore,
} from "./artifact-adoption";
import { SandboxUnavailableError } from "./errors";
import { assertResourceCeilings } from "./policy";
import {
  SANDBOX_WORKER_IDS,
  resolveSandboxWorkerDefinition,
  type SandboxWorkerDefinition,
} from "./worker-definitions";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const boundedId = z.string().trim().min(1).max(256);

export const sandboxJobPayloadV1Schema = z.strictObject({
  schemaVersion: z.literal(1),
  workerId: z.enum(SANDBOX_WORKER_IDS),
  ownerId: boundedId,
  threadId: boundedId,
  branchId: boundedId,
  inputManifestRef: z.string().trim().min(1).max(1_024),
  workspaceSnapshotRef: sandboxWorkspaceSnapshotRefSchema.nullable(),
  profileId: sandboxProfileIdSchema,
  profileVersion: z.string().trim().min(1).max(128),
  imageDigest: digestSchema,
  hostPolicyDigest: digestSchema,
  baselineEvidenceNonce: boundedId,
  executable: z.string().startsWith("/").max(512),
  argv: z.array(z.string().max(4_096)).max(128),
  resources: sandboxResourceLimitsSchema.partial(),
});
export type ParsedSandboxJobPayloadV1 = z.infer<
  typeof sandboxJobPayloadV1Schema
>;

export interface SandboxWorkerExecutionResult {
  readonly schemaVersion: 1;
  readonly workerId: string;
  readonly providerId: string;
  readonly profileId: string;
  readonly profileVersion: string;
  readonly imageDigest: string;
  readonly evidenceNonce: string;
  readonly output: unknown;
  readonly artifacts: readonly {
    readonly objectRef: string;
    readonly relativePath: string;
    readonly digest: string;
    readonly byteSize: number;
    readonly mimeType: string;
  }[];
  readonly progress: Readonly<{
    current: number;
    total: number;
    message: string | null;
  }> | null;
}

/**
 * Durable-job executor for the exact reviewed worker catalogue. It re-parses
 * the immutable input, repeats provider preflight/create, dispatches a fixed
 * executable/argv pair and adopts verified outputs before teardown.
 */
export class SandboxWorkerExecutor {
  readonly #profiles: ReadonlyMap<string, SandboxExecutionProfile>;

  constructor(
    private readonly dependencies: {
      provider: SandboxProvider;
      profiles: readonly SandboxExecutionProfile[];
      hostPolicyDigest: string;
      maxEvidenceAgeMs: number;
      manifests: ObjectStorageManifestStore;
      artifacts: (jobId: string) => TrustedArtifactObjectStore;
      now?: () => Date;
    },
  ) {
    this.#profiles = new Map(
      dependencies.profiles.map((profile) => [profile.id, profile]),
    );
  }

  async execute(
    payloadValue: unknown,
    context: { jobId: string; signal?: AbortSignal },
  ): Promise<SandboxWorkerExecutionResult> {
    const payload = sandboxJobPayloadV1Schema.parse(payloadValue);
    const definition = resolveSandboxWorkerDefinition(payload);
    const profile = this.requireProfile(payload, definition);
    const storedManifest = await this.dependencies.manifests.get({
      ownerId: payload.ownerId,
      manifestRef: payload.inputManifestRef,
    });
    definition.inputSchema.parse(storedManifest.value);
    const now = this.dependencies.now?.() ?? new Date();
    const preflight = await this.dependencies.provider.preflight({
      profile,
      expectedHostPolicyDigest: this.dependencies.hostPolicyDigest,
      maxEvidenceAgeMs: this.dependencies.maxEvidenceAgeMs,
      now,
    });
    if (!preflight.ok) {
      throw new SandboxUnavailableError(preflight.reason, preflight.message);
    }
    if (
      preflight.evidence.hostPolicyDigest !== payload.hostPolicyDigest ||
      preflight.evidence.imageDigest !== payload.imageDigest ||
      preflight.evidence.profileVersion !== payload.profileVersion
    ) {
      throw new SandboxUnavailableError(
        "EVIDENCE_FAILED",
        "Sandbox job evidence no longer matches the admitted profile",
      );
    }

    const handle = await this.dependencies.provider.create({
      operationId: context.jobId,
      ownerId: payload.ownerId,
      threadId: payload.threadId,
      branchId: payload.branchId,
      profile,
      expectedHostPolicyDigest: payload.hostPolicyDigest,
      maxEvidenceAgeMs: this.dependencies.maxEvidenceAgeMs,
      now,
      expiresAt: new Date(
        now.getTime() + Math.min(24 * 60 * 60_000, profile.resources.wallTimeMs + 60_000),
      ),
      ...(payload.workspaceSnapshotRef
        ? { workspaceSnapshotRef: payload.workspaceSnapshotRef }
        : {}),
    });
    let stopped = false;
    try {
      await this.dependencies.provider.putFiles(handle, [
        {
          relativePath: "input/request.json",
          bytes: storedManifest.bytes,
          digest: storedManifest.digest,
          mimeType: "application/json",
        },
      ]);
      const execution = await consumeExecutionEvents(
        this.dependencies.provider.execute({
          handle,
          executable: definition.executable,
          argv: definition.argv,
          resources: payload.resources,
          signal: context.signal,
        }),
        context.signal,
        Math.min(
          profile.resources.eventBytes,
          payload.resources.eventBytes ?? profile.resources.eventBytes,
        ),
        Math.min(
          profile.resources.outputBytes,
          payload.resources.outputBytes ?? profile.resources.outputBytes,
        ),
      );
      if (execution.exitCode !== 0) {
        throw new NonRetryableJobError(
          `SANDBOX_WORKER_FAILED:${definition.id}:${execution.exitCode}`,
        );
      }
      const resultEntry = await this.requireResultEntry(handle, definition);
      const resultBytes = await readVerifiedSandboxFile({
        provider: this.dependencies.provider,
        handle,
        entry: resultEntry,
        maximumBytes: Math.min(definition.maximumFileBytes, 8 * 1024 * 1024),
      });
      const output = definition.outputSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resultBytes)),
      );
      const paths = [...new Set(definition.outputPaths(output))];
      if (
        paths.length < 1 ||
        paths.length > definition.maximumFiles ||
        !paths.includes(definition.resultPath)
      ) {
        throw new NonRetryableJobError("SANDBOX_WORKER_OUTPUT_SET_INVALID");
      }
      const manifest = await this.dependencies.provider.getFiles(handle, paths);
      verifyOutputManifest(definition, output, manifest);
      const adopted = await adoptSandboxArtifacts({
        provider: this.dependencies.provider,
        handle,
        manifest,
        policy: {
          maxFiles: definition.maximumFiles,
          maxTotalBytes: Math.min(
            definition.maximumTotalBytes,
            profile.resources.outputBytes,
          ),
          maxFileBytes: Math.min(
            definition.maximumFileBytes,
            profile.resources.outputBytes,
          ),
          allowedPathPrefixes: ["output/"],
          allowedKinds: definition.allowedKinds,
        },
        store: this.dependencies.artifacts(context.jobId),
        provenance: {
          ownerId: payload.ownerId,
          purpose: `sandbox-worker/${definition.id}`,
          jobId: context.jobId,
          toolCallId: context.jobId,
          profileVersion: profile.version,
          imageDigest: profile.image.imageDigest,
          inputRevision: storedManifest.digest,
        },
      });
      return Object.freeze({
        schemaVersion: 1 as const,
        workerId: definition.id,
        providerId: handle.providerId,
        profileId: handle.profileId,
        profileVersion: handle.profileVersion,
        imageDigest: handle.image.imageDigest,
        evidenceNonce: handle.evidenceNonce,
        output,
        artifacts: Object.freeze(
          adopted.map((artifact) =>
            Object.freeze({
              objectRef: artifact.objectRef,
              relativePath: artifact.relativePath,
              digest: artifact.digest,
              byteSize: artifact.byteSize,
              mimeType: artifact.mimeType,
            }),
          ),
        ),
        progress: execution.progress,
      });
    } catch (error) {
      if (context.signal?.aborted) {
        await this.dependencies.provider.stop(handle).catch(() => undefined);
        stopped = true;
      }
      throw error;
    } finally {
      if (!stopped) {
        await this.dependencies.provider.stop(handle).catch(() => undefined);
      }
      await this.dependencies.provider.destroy(handle).catch(() => undefined);
    }
  }

  private requireProfile(
    payload: ParsedSandboxJobPayloadV1,
    definition: SandboxWorkerDefinition,
  ): SandboxExecutionProfile {
    const profile = this.#profiles.get(payload.profileId);
    if (
      !profile ||
      !profile.enabled ||
      profile.id !== definition.profileId ||
      profile.version !== payload.profileVersion ||
      profile.image.imageDigest !== payload.imageDigest ||
      payload.hostPolicyDigest !== this.dependencies.hostPolicyDigest
    ) {
      throw new SandboxUnavailableError(
        "PROFILE_DISABLED",
        "The sandbox worker profile changed after job admission",
      );
    }
    assertResourceCeilings(profile.resources, payload.resources);
    return profile;
  }

  private async requireResultEntry(
    handle: Parameters<SandboxProvider["getFiles"]>[0],
    definition: SandboxWorkerDefinition,
  ) {
    const entries = await this.dependencies.provider.getFiles(handle, [
      definition.resultPath,
    ]);
    const entry = entries[0];
    if (
      entries.length !== 1 ||
      !entry ||
      entry.relativePath !== definition.resultPath ||
      entry.kind !== "json" ||
      entry.mimeType !== "application/json"
    ) {
      throw new NonRetryableJobError("SANDBOX_WORKER_RESULT_MANIFEST_INVALID");
    }
    return entry;
  }
}

async function consumeExecutionEvents(
  events: AsyncIterable<SandboxExecutionEvent>,
  signal?: AbortSignal,
  maximumEventBytes = 8 * 1024 * 1024,
  maximumOutputBytes = 2 * 1024 ** 3,
) {
  let started = false;
  let exit: Extract<SandboxExecutionEvent, { type: "exited" }> | null = null;
  let progress: SandboxWorkerExecutionResult["progress"] = null;
  let eventBytes = 0;
  for await (const event of events) {
    signal?.throwIfAborted();
    eventBytes += new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (eventBytes > maximumEventBytes) {
      throw new NonRetryableJobError("SANDBOX_WORKER_EVENT_LIMIT_EXCEEDED");
    }
    if (event.type === "started") {
      if (started || exit) throw new NonRetryableJobError("SANDBOX_WORKER_EVENT_ORDER_INVALID");
      started = true;
      continue;
    }
    if (!started || exit) {
      throw new NonRetryableJobError("SANDBOX_WORKER_EVENT_ORDER_INVALID");
    }
    if (event.type === "progress") {
      if (
        !Number.isSafeInteger(event.current) ||
        !Number.isSafeInteger(event.total) ||
        event.current < 0 ||
        event.total < 1 ||
        event.current > event.total
      ) {
        throw new NonRetryableJobError("SANDBOX_WORKER_PROGRESS_INVALID");
      }
      progress = Object.freeze({
        current: event.current,
        total: event.total,
        message: event.message?.slice(0, 500) ?? null,
      });
    }
    if (event.type === "exited") {
      if (
        !Number.isSafeInteger(event.exitCode) ||
        event.exitCode < 0 ||
        !Number.isSafeInteger(event.outputBytes) ||
        event.outputBytes < 0 ||
        event.outputBytes > maximumOutputBytes
      ) {
        throw new NonRetryableJobError("SANDBOX_WORKER_EXIT_EVENT_INVALID");
      }
      exit = event;
    }
  }
  if (!exit) throw new Error("SANDBOX_WORKER_EXIT_EVENT_MISSING");
  return Object.freeze({ exitCode: exit.exitCode, progress });
}

async function readVerifiedSandboxFile(input: {
  provider: SandboxProvider;
  handle: Parameters<SandboxProvider["readFile"]>[0];
  entry: SandboxFileManifestEntry;
  maximumBytes: number;
}) {
  if (input.entry.byteSize > input.maximumBytes) {
    throw new NonRetryableJobError("SANDBOX_WORKER_RESULT_TOO_LARGE");
  }
  const bytes = new Uint8Array(input.entry.byteSize);
  const hash = createHash("sha256");
  let offset = 0;
  for await (const chunk of input.provider.readFile(
    input.handle,
    input.entry.relativePath,
  )) {
    if (offset + chunk.byteLength > bytes.byteLength) {
      throw new NonRetryableJobError("SANDBOX_WORKER_RESULT_SIZE_MISMATCH");
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
    hash.update(chunk);
  }
  if (
    offset !== input.entry.byteSize ||
    `sha256:${hash.digest("hex")}` !== input.entry.digest
  ) {
    throw new NonRetryableJobError("SANDBOX_WORKER_RESULT_DIGEST_MISMATCH");
  }
  return bytes;
}

function verifyOutputManifest(
  definition: SandboxWorkerDefinition,
  output: unknown,
  manifest: readonly SandboxFileManifestEntry[],
) {
  const declared = collectOutputDescriptors(output);
  const expectedPaths = new Set(definition.outputPaths(output));
  if (
    manifest.length !== expectedPaths.size ||
    new Set(manifest.map((entry) => entry.relativePath)).size !== manifest.length
  ) {
    throw new NonRetryableJobError("SANDBOX_WORKER_OUTPUT_MANIFEST_INVALID");
  }
  for (const entry of manifest) {
    if (!expectedPaths.has(entry.relativePath)) {
      throw new NonRetryableJobError("SANDBOX_WORKER_OUTPUT_PATH_UNEXPECTED");
    }
    if (entry.relativePath === definition.resultPath) continue;
    const descriptor = declared.get(entry.relativePath);
    if (
      !descriptor ||
      descriptor.digest !== entry.digest ||
      descriptor.byteSize !== entry.byteSize ||
      descriptor.mimeType !== entry.mimeType
    ) {
      throw new NonRetryableJobError("SANDBOX_WORKER_OUTPUT_DESCRIPTOR_MISMATCH");
    }
  }
}

function collectOutputDescriptors(value: unknown) {
  const found = new Map<
    string,
    { digest: string; byteSize: number; mimeType: string }
  >();
  const pending: unknown[] = [value];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    visited += 1;
    if (visited > 10_000) {
      throw new NonRetryableJobError("SANDBOX_WORKER_OUTPUT_STRUCTURE_TOO_LARGE");
    }
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      pending.push(...current);
      continue;
    }
    const record = current as Record<string, unknown>;
    if (
      typeof record.path === "string" &&
      typeof record.digest === "string" &&
      typeof record.byteSize === "number" &&
      typeof record.mimeType === "string"
    ) {
      if (found.has(record.path)) {
        throw new NonRetryableJobError("SANDBOX_WORKER_OUTPUT_DESCRIPTOR_DUPLICATE");
      }
      found.set(record.path, {
        digest: record.digest,
        byteSize: record.byteSize,
        mimeType: record.mimeType,
      });
    }
    pending.push(...Object.values(record));
  }
  return found;
}
