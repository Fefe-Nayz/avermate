import {
  type SandboxExecutionProfile,
  type SandboxFileManifestEntry,
  type SandboxInputFile,
  type SandboxProvider,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { canonicalJson } from "../search/values";
import { SandboxUnavailableError } from "./errors";
import {
  SANDBOX_WORKER_DEFINITIONS,
  type SandboxWorkerId,
} from "./worker-definitions";

export interface InProcessSandboxWorkerResult {
  readonly output: unknown;
  readonly files: ReadonlyMap<string, Uint8Array>;
  readonly profileVersion: string;
  readonly imageDigest: string;
  readonly evidenceNonce: string;
}

/**
 * Synchronous composition seam for an existing durable job handler. It still
 * executes exclusively through SandboxProvider and a reviewed worker; the
 * caller never receives a shell/process surface.
 */
export class SandboxWorkerClient {
  readonly #profiles: ReadonlyMap<string, SandboxExecutionProfile>;

  constructor(
    private readonly dependencies: {
      provider: SandboxProvider;
      profiles: readonly SandboxExecutionProfile[];
      hostPolicyDigest: string;
      maxEvidenceAgeMs: number;
      now?: () => Date;
    },
  ) {
    this.#profiles = new Map(
      dependencies.profiles.map((profile) => [profile.id, profile]),
    );
  }

  async execute(input: {
    workerId: SandboxWorkerId;
    ownerId: string;
    threadId: string;
    branchId: string;
    operationId: string;
    manifest: unknown;
    inputFiles?: readonly SandboxInputFile[];
    maximumReturnBytes: number;
    signal?: AbortSignal;
  }): Promise<InProcessSandboxWorkerResult> {
    if (
      !Number.isSafeInteger(input.maximumReturnBytes) ||
      input.maximumReturnBytes < 1
    ) {
      throw new Error("SANDBOX_WORKER_RETURN_LIMIT_INVALID");
    }
    const definition = SANDBOX_WORKER_DEFINITIONS[input.workerId];
    const profile = this.#profiles.get(definition.profileId);
    if (!profile?.enabled) {
      throw new SandboxUnavailableError(
        "PROFILE_DISABLED",
        `The ${definition.profileId} sandbox profile is unavailable`,
      );
    }
    const parsedInput = definition.inputSchema.parse(input.manifest);
    const requestBytes = new TextEncoder().encode(canonicalJson(parsedInput));
    if (requestBytes.byteLength > 8 * 1024 * 1024) {
      throw new Error("SANDBOX_WORKER_INPUT_MANIFEST_TOO_LARGE");
    }
    const requestFile: SandboxInputFile = {
      relativePath: "input/request.json",
      bytes: requestBytes,
      digest: digestBytes(requestBytes),
      mimeType: "application/json",
    };
    const files = [requestFile, ...(input.inputFiles ?? [])];
    if (new Set(files.map((file) => file.relativePath)).size !== files.length) {
      throw new Error("SANDBOX_WORKER_INPUT_PATH_DUPLICATE");
    }
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
      preflight.evidence.hostPolicyDigest !== this.dependencies.hostPolicyDigest ||
      preflight.evidence.imageDigest !== profile.image.imageDigest ||
      preflight.evidence.profileVersion !== profile.version
    ) {
      throw new SandboxUnavailableError(
        "EVIDENCE_FAILED",
        "Sandbox worker evidence does not match the selected profile",
      );
    }
    const handle = await this.dependencies.provider.create({
      operationId: input.operationId,
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      profile,
      expectedHostPolicyDigest: this.dependencies.hostPolicyDigest,
      maxEvidenceAgeMs: this.dependencies.maxEvidenceAgeMs,
      now,
      expiresAt: new Date(
        now.getTime() + Math.min(24 * 60 * 60_000, profile.resources.wallTimeMs + 60_000),
      ),
    });
    let stopped = false;
    try {
      if (
        handle.profileId !== profile.id ||
        handle.profileVersion !== profile.version ||
        handle.image.imageDigest !== profile.image.imageDigest
      ) {
        throw new Error("SANDBOX_WORKER_HANDLE_PROFILE_MISMATCH");
      }
      await this.dependencies.provider.putFiles(handle, files);
      let exitCode: number | null = null;
      let started = false;
      let eventBytes = 0;
      for await (const event of this.dependencies.provider.execute({
        handle,
        executable: definition.executable,
        argv: definition.argv,
        signal: input.signal,
      })) {
        input.signal?.throwIfAborted();
        eventBytes += new TextEncoder().encode(JSON.stringify(event)).byteLength;
        if (eventBytes > profile.resources.eventBytes) {
          throw new Error("SANDBOX_WORKER_EVENT_LIMIT_EXCEEDED");
        }
        if (event.type === "started") {
          if (started || exitCode !== null) {
            throw new Error("SANDBOX_WORKER_EVENT_ORDER_INVALID");
          }
          started = true;
          continue;
        }
        if (!started || exitCode !== null) {
          throw new Error("SANDBOX_WORKER_EVENT_ORDER_INVALID");
        }
        if (
          event.type === "progress" &&
          (!Number.isSafeInteger(event.current) ||
            !Number.isSafeInteger(event.total) ||
            event.current < 0 ||
            event.total < 1 ||
            event.current > event.total)
        ) {
          throw new Error("SANDBOX_WORKER_PROGRESS_INVALID");
        }
        if (event.type === "exited") {
          exitCode = event.exitCode;
        }
      }
      if (exitCode === null) throw new Error("SANDBOX_WORKER_EXIT_EVENT_MISSING");
      if (exitCode !== 0) {
        throw new Error(`SANDBOX_WORKER_FAILED:${definition.id}:${exitCode}`);
      }
      const resultEntries = await this.dependencies.provider.getFiles(handle, [
        definition.resultPath,
      ]);
      const resultEntry = resultEntries[0];
      if (
        resultEntries.length !== 1 ||
        !resultEntry ||
        resultEntry.kind !== "json" ||
        resultEntry.relativePath !== definition.resultPath ||
        resultEntry.byteSize > 8 * 1024 * 1024
      ) {
        throw new Error("SANDBOX_WORKER_RESULT_MANIFEST_INVALID");
      }
      const resultBytes = await materializeFile(
        this.dependencies.provider,
        handle,
        resultEntry,
      );
      const output = definition.outputSchema.parse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(resultBytes)),
      );
      const paths = [...new Set(definition.outputPaths(output))];
      if (
        paths.length < 1 ||
        paths.length > definition.maximumFiles ||
        !paths.includes(definition.resultPath)
      ) {
        throw new Error("SANDBOX_WORKER_OUTPUT_SET_INVALID");
      }
      const outputManifest = await this.dependencies.provider.getFiles(handle, paths);
      const uniquePaths = new Set(
        outputManifest.map((entry) => entry.relativePath),
      );
      const maximumReturnBytes = Math.min(
        input.maximumReturnBytes,
        definition.maximumTotalBytes,
        profile.resources.outputBytes,
      );
      if (
        outputManifest.length !== paths.length ||
        uniquePaths.size !== outputManifest.length ||
        outputManifest.reduce((sum, entry) => sum + entry.byteSize, 0) >
          maximumReturnBytes
      ) {
        throw new Error("SANDBOX_WORKER_RETURN_LIMIT_EXCEEDED");
      }
      const descriptors = outputDescriptors(output);
      const returned = new Map<string, Uint8Array>();
      for (const entry of outputManifest) {
        if (
          !paths.includes(entry.relativePath) ||
          !definition.allowedKinds.includes(entry.kind) ||
          entry.nodeType !== "file" ||
          entry.byteSize > definition.maximumFileBytes
        ) {
          throw new Error("SANDBOX_WORKER_OUTPUT_PATH_UNEXPECTED");
        }
        if (
          entry.relativePath === definition.resultPath &&
          (entry.kind !== "json" || entry.mimeType !== "application/json")
        ) {
          throw new Error("SANDBOX_WORKER_RESULT_MANIFEST_INVALID");
        }
        if (entry.relativePath !== definition.resultPath) {
          const descriptor = descriptors.get(entry.relativePath);
          if (
            !descriptor ||
            descriptor.digest !== entry.digest ||
            descriptor.byteSize !== entry.byteSize ||
            descriptor.mimeType !== entry.mimeType
          ) {
            throw new Error("SANDBOX_WORKER_OUTPUT_DESCRIPTOR_MISMATCH");
          }
        }
        returned.set(
          entry.relativePath,
          entry.relativePath === definition.resultPath
            ? resultBytes
            : await materializeFile(this.dependencies.provider, handle, entry),
        );
      }
      return Object.freeze({
        output,
        files: returned,
        profileVersion: handle.profileVersion,
        imageDigest: handle.image.imageDigest,
        evidenceNonce: handle.evidenceNonce,
      });
    } catch (error) {
      if (input.signal?.aborted) {
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
}

async function materializeFile(
  provider: SandboxProvider,
  handle: Parameters<SandboxProvider["readFile"]>[0],
  entry: SandboxFileManifestEntry,
) {
  const bytes = new Uint8Array(entry.byteSize);
  const hash = createHash("sha256");
  let offset = 0;
  for await (const chunk of provider.readFile(handle, entry.relativePath)) {
    if (offset + chunk.byteLength > bytes.byteLength) {
      throw new Error("SANDBOX_WORKER_FILE_SIZE_MISMATCH");
    }
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
    hash.update(chunk);
  }
  if (offset !== entry.byteSize || digestHash(hash) !== entry.digest) {
    throw new Error("SANDBOX_WORKER_FILE_DIGEST_MISMATCH");
  }
  return bytes;
}

function outputDescriptors(value: unknown) {
  const descriptors = new Map<
    string,
    { digest: string; byteSize: number; mimeType: string }
  >();
  const pending: unknown[] = [value];
  let count = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    count += 1;
    if (count > 10_000) throw new Error("SANDBOX_WORKER_OUTPUT_TOO_COMPLEX");
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
      if (descriptors.has(record.path)) {
        throw new Error("SANDBOX_WORKER_OUTPUT_DESCRIPTOR_DUPLICATE");
      }
      descriptors.set(record.path, {
        digest: record.digest,
        byteSize: record.byteSize,
        mimeType: record.mimeType,
      });
    }
    pending.push(...Object.values(record));
  }
  return descriptors;
}

function digestBytes(bytes: Uint8Array) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function digestHash(hash: ReturnType<typeof createHash>) {
  return `sha256:${hash.digest("hex")}`;
}
