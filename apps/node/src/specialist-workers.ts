import type {
  NodeArtifactRef,
  NodeJobLimits,
  ObjectStorageProvider,
  SandboxExecutionEvent,
  SandboxExecutionProfile,
  SandboxFileManifestEntry,
  SandboxProvider,
  SpecialistWorkerId,
  SpecialistWorkerManifestV1,
  SpecialistWorkerOutputV1,
} from "@avermate/agent-contracts";
import {
  nodeArtifactRefSchema,
  sandboxExecutionProfileSchema,
  sandboxPreflightResultSchema,
  specialistWorkerManifestV1Schema,
  specialistWorkerOutputV1Schema,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { canonicalDigest, canonicalJson } from "./canonical-json";
import type { NodeConfig } from "./config";
import { bytesStream } from "./filesystem-storage";
import type { NodeJobHandler, NodeJobHandlerContext } from "./job-dispatcher";

const MIB = 1024 ** 2;
const GIB = 1024 ** 3;
const GIT = "/usr/bin/git";
const REQUEST_PATH = "input/request.json";
const RESULT_PATH = "output/result.json";
const PATCH_PATH = "output/review.patch";
const LOG_PATH = "output/worker.log";

export type SpecialistWorkerPolicy = {
  worker: SpecialistWorkerId;
  image: string;
  digest: `sha256:${string}`;
  license: string;
  network: "denied" | "allowlist";
  allowedHosts: readonly string[];
  egressPolicyDigest: `sha256:${string}`;
  commands: ReadonlyMap<string, readonly string[]>;
  maximumInputBytes: number;
  maximumOutputBytes: number;
  maximumCommands: number;
};

export interface SpecialistSandboxRunner {
  healthy(input: { policy: SpecialistWorkerPolicy }): Promise<boolean>;
  run(input: {
    manifest: SpecialistWorkerManifestV1;
    manifestBytes: Uint8Array;
    policy: SpecialistWorkerPolicy;
    jobLimits: NodeJobLimits;
    signal: AbortSignal;
    progress: NodeJobHandlerContext["progress"];
  }): Promise<{
    output: SpecialistWorkerOutputV1;
    resultArtifacts: readonly NodeArtifactRef[];
  }>;
}

export type SpecialistManifestReader = (input: {
  artifact: NodeArtifactRef;
  maximumBytes: number;
  signal: AbortSignal;
}) => Promise<Uint8Array>;

export function objectStorageManifestReader(
  storage: ObjectStorageProvider,
): SpecialistManifestReader {
  return async ({ artifact, maximumBytes, signal }) => {
    const metadata = await storage.stat({ ref: artifact.object });
    if (
      !metadata ||
      metadata.digest !== artifact.digest ||
      metadata.byteSize !== artifact.byteSize ||
      metadata.mimeType !== artifact.mimeType ||
      metadata.byteSize > maximumBytes
    ) {
      throw new Error("SPECIALIST_MANIFEST_STORAGE_MISMATCH");
    }
    const stream = await storage.get({
      ref: artifact.object,
      maxBytes: maximumBytes,
    });
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        if (signal.aborted) throw new Error("SPECIALIST_JOB_CANCELLED");
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > maximumBytes || total > artifact.byteSize) {
          throw new Error("SPECIALIST_MANIFEST_LIMIT_EXCEEDED");
        }
        chunks.push(next.value.slice());
      }
    } finally {
      reader.releaseLock();
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return bytes;
  };
}

export function specialistWorkerPolicy(
  worker: SpecialistWorkerId,
  config: NodeConfig["workers"][SpecialistWorkerId],
): SpecialistWorkerPolicy {
  if (
    !config.enabled ||
    !config.image ||
    !config.digest ||
    !config.license ||
    config.commandCatalogue.length === 0
  ) {
    throw new Error("SPECIALIST_WORKER_NOT_CONFIGURED");
  }
  const commands = new Map<string, readonly string[]>();
  for (const entry of config.commandCatalogue) {
    if (commands.has(entry.id)) throw new Error("SPECIALIST_COMMAND_DUPLICATE");
    if (
      !entry.argv[0]?.startsWith("/") ||
      !entry.argv.some((value) =>
        value.includes("/workspace/input/request.json"),
      )
    ) {
      throw new Error("SPECIALIST_COMMAND_CONTRACT_INVALID");
    }
    commands.set(entry.id, Object.freeze([...entry.argv]));
  }
  const allowedHosts = Object.freeze(
    [...new Set(config.allowedHosts.map((host) => host.toLowerCase()))].sort(),
  );
  return Object.freeze({
    worker,
    image: config.image,
    digest: config.digest as `sha256:${string}`,
    license: config.license,
    network: config.network,
    allowedHosts,
    egressPolicyDigest: canonicalDigest({
      network: config.network,
      allowedHosts,
    }),
    commands,
    maximumInputBytes: config.maximumInputBytes,
    maximumOutputBytes: config.maximumOutputBytes,
    maximumCommands: config.maximumCommands,
  });
}

/** The exact profile which must also be installed in the injected provider. */
export function createSpecialistSandboxProfile(
  worker: SpecialistWorkerId,
  config: NodeConfig["workers"][SpecialistWorkerId],
): SandboxExecutionProfile {
  const policy = specialistWorkerPolicy(worker, config);
  const policyRevision = sha256(
    new TextEncoder().encode(
      canonicalJson({
        worker,
        digest: policy.digest,
        commands: [...policy.commands],
        network: policy.network,
        allowedHosts: policy.allowedHosts,
        maximumInputBytes: policy.maximumInputBytes,
        maximumOutputBytes: policy.maximumOutputBytes,
        maximumCommands: policy.maximumCommands,
      }),
    ),
  ).slice("sha256:".length, "sha256:".length + 20);
  const networkBytes =
    policy.network === "denied"
      ? 0
      : Math.min(64 * MIB, policy.maximumOutputBytes);
  const networkRequests =
    policy.network === "denied"
      ? 0
      : Math.max(1, Math.min(100_000, policy.maximumCommands * 8));
  const outputBytes = Math.min(2 * GIB, policy.maximumOutputBytes);
  const version = `plan038-${worker}-${policyRevision}`;
  return sandboxExecutionProfileSchema.parse({
    id: worker,
    version,
    enabled: true,
    requiredBaselineVersion: 1,
    image: { imageDigest: policy.digest, profileVersion: version },
    entrypoints: [
      ...new Set(
        [...policy.commands.values()].map((argv) => argv[0]!).concat(GIT),
      ),
    ],
    resources: {
      cpuMillis: 64_000,
      memoryBytes: 4 * GIB,
      swapBytes: 0,
      pids: 512,
      wallTimeMs: 30 * 60_000,
      cancellationGraceMs: 5_000,
      outputBytes,
      stdoutBytes: Math.min(16 * MIB, outputBytes),
      stderrBytes: Math.min(16 * MIB, outputBytes),
      eventBytes: Math.min(32 * MIB, outputBytes),
      workspaceBytes: Math.min(
        50 * GIB,
        policy.maximumInputBytes + policy.maximumOutputBytes,
      ),
      fileCount: 100_000,
      tmpfsBytes: Math.min(GIB, policy.maximumInputBytes),
      tmpfsInodes: 100_000,
      openFiles: 4_096,
      networkBytes,
      networkRequests,
      gpuCount: 0,
    },
    egress:
      policy.network === "denied"
        ? { mode: "none" }
        : {
            mode: "allowlist",
            destinations: policy.allowedHosts.map((hostname) => ({
              protocol: "https",
              hostname,
              port: 443,
              pathPrefix: "/",
            })),
            maxRequests: networkRequests,
            maxResponseBytes: networkBytes,
          },
    workspaceRoot: "/workspace",
    readOnlyRootfs: true,
    allowHostMounts: false,
    allowDevices: false,
    readOnlyInputPaths: ["/workspace/input/"],
    writablePaths: [
      "/workspace/src/",
      "/workspace/assets/",
      "/workspace/tests/",
      "/workspace/output/",
    ],
    outputGlobs: ["output/**"],
    allowSecrets: false,
    workload: {
      kind: worker,
      reviewedCommandCatalogue: true,
      arbitraryHostCommands: false,
      canonicalHistoryImported: false,
    },
  });
}

type StoredOutput = {
  path: string;
  bytes: Uint8Array;
  digest: `sha256:${string}`;
  mimeType: string;
};

/**
 * Production specialist adapter. It only uses an injected, evidence-gated
 * SandboxProvider and never spawns host commands or imports worker history.
 */
export class ProviderSpecialistSandboxRunner
  implements SpecialistSandboxRunner
{
  readonly #provider: SandboxProvider;
  readonly #profiles: ReadonlyMap<
    SpecialistWorkerId,
    SandboxExecutionProfile
  >;
  readonly #hostPolicyDigest: string;
  readonly #maxEvidenceAgeMs: number;
  readonly #storage: ObjectStorageProvider;
  readonly #now: () => Date;

  constructor(input: {
    provider: SandboxProvider;
    profiles: Readonly<
      Partial<Record<SpecialistWorkerId, SandboxExecutionProfile>>
    >;
    hostPolicyDigest: string;
    maxEvidenceAgeMs: number;
    storage: ObjectStorageProvider;
    now?: () => Date;
  }) {
    if (input.provider.id === "disabled" || input.provider.id === "mock") {
      throw new Error("SPECIALIST_ATTESTED_PROVIDER_REQUIRED");
    }
    this.#provider = input.provider;
    this.#profiles = new Map(
      Object.entries(input.profiles).map(([worker, profile]) => [
        worker as SpecialistWorkerId,
        sandboxExecutionProfileSchema.parse(profile),
      ]),
    );
    this.#hostPolicyDigest = input.hostPolicyDigest;
    this.#maxEvidenceAgeMs = input.maxEvidenceAgeMs;
    this.#storage = input.storage;
    this.#now = input.now ?? (() => new Date());
  }

  async healthy(input: { policy: SpecialistWorkerPolicy }) {
    try {
      await this.#requirePreflight(input.policy);
      return true;
    } catch {
      return false;
    }
  }

  async run(input: {
    manifest: SpecialistWorkerManifestV1;
    manifestBytes: Uint8Array;
    policy: SpecialistWorkerPolicy;
    jobLimits: NodeJobLimits;
    signal: AbortSignal;
    progress: NodeJobHandlerContext["progress"];
  }) {
    const profile = await this.#requirePreflight(input.policy);
    if (input.manifest.sourceWorkspaceSnapshot.provider !== this.#provider.id) {
      throw new Error("SPECIALIST_SNAPSHOT_PROVIDER_MISMATCH");
    }
    const deadline = Date.parse(input.manifest.limits.deadline);
    const startedAt = this.#now().getTime();
    if (!Number.isFinite(deadline) || deadline <= startedAt) {
      throw new Error("SPECIALIST_DEADLINE_EXPIRED");
    }
    const executionCount = input.manifest.reviewedCommands.length + 4;
    if (
      input.jobLimits.cpuMillis < executionCount * 100 ||
      input.jobLimits.memoryBytes < 16 * MIB
    ) {
      throw new Error("SPECIALIST_COMPUTE_LIMIT_TOO_SMALL");
    }
    const abort = new AbortController();
    const forwardAbort = () => abort.abort("cancelled");
    input.signal.addEventListener("abort", forwardAbort, { once: true });
    const timer = setTimeout(
      () => abort.abort("deadline"),
      Math.min(2_147_483_647, Math.max(1, deadline - Date.now())),
    );
    const expiresAt = new Date(
      Math.min(deadline, startedAt + profile.resources.wallTimeMs + 60_000),
    );
    let handle: Awaited<ReturnType<SandboxProvider["forkWorkspace"]>> | null =
      null;
    let reportedOutputBytes = 0;
    const logParts: string[] = [];
    const commandResults: SpecialistWorkerOutputV1["commands"] = [];
    try {
      handle = await this.#provider.forkWorkspace({
        operationId: input.manifest.jobId,
        ownerId: input.manifest.ownerId,
        threadId: input.manifest.jobId,
        branchId: `${input.manifest.worker}-review`,
        profile,
        expectedHostPolicyDigest: this.#hostPolicyDigest,
        maxEvidenceAgeMs: this.#maxEvidenceAgeMs,
        now: this.#now(),
        expiresAt,
        source: input.manifest.sourceWorkspaceSnapshot,
      });
      await this.#provider.putFiles(handle, [
        {
          relativePath: REQUEST_PATH,
          bytes: input.manifestBytes,
          digest: sha256(input.manifestBytes),
          mimeType: "application/json",
        },
      ]);
      await this.#verifyFrozenLockfile(handle, input.manifest, abort.signal);

      const internalLimit = Math.min(2 * MIB, input.policy.maximumOutputBytes);
      const headBefore = await this.#execute({
        handle,
        profile,
        executable: GIT,
        argv: ["rev-parse", "--verify", "HEAD"],
        cwd: "/workspace",
        signal: abort.signal,
        jobLimits: input.jobLimits,
        executionCount,
        maximumCaptureBytes: internalLimit,
        deadline,
      });
      reportedOutputBytes += headBefore.outputBytes;
      if (headBefore.exitCode !== 0 || headBefore.truncated) {
        throw new Error("SPECIALIST_SOURCE_REVISION_UNAVAILABLE");
      }
      const sourceHead = headBefore.stdout.trim();

      for (
        let index = 0;
        index < input.manifest.reviewedCommands.length;
        index += 1
      ) {
        this.#assertActive(abort.signal);
        const reviewed = input.manifest.reviewedCommands[index]!;
        const argv = input.policy.commands.get(reviewed.commandId);
        if (!argv) throw new Error("SPECIALIST_COMMAND_NOT_REVIEWED");
        const execution = await this.#execute({
          handle,
          profile,
          executable: argv[0]!,
          argv: argv.slice(1),
          cwd:
            reviewed.cwd === "."
              ? "/workspace"
              : `/workspace/${reviewed.cwd}`,
          signal: abort.signal,
          jobLimits: input.jobLimits,
          executionCount,
          maximumCaptureBytes: Math.min(
            8 * MIB,
            input.policy.maximumOutputBytes,
          ),
          deadline,
          progress: input.progress,
        });
        reportedOutputBytes += execution.outputBytes;
        logParts.push(
          `[${reviewed.commandId}] exit=${execution.exitCode}\n${execution.stdout}${execution.stderr}`,
        );
        commandResults.push({
          commandId: reviewed.commandId,
          exitCode: execution.exitCode,
          stdoutTruncated: execution.stdoutTruncated,
          stderrTruncated: execution.stderrTruncated,
        });
        if (execution.exitCode !== 0) {
          throw new Error("SPECIALIST_REVIEWED_COMMAND_FAILED");
        }
        await input.progress({
          numerator: index + 1,
          denominator: Math.max(
            1,
            input.manifest.reviewedCommands.length,
          ),
          unit: "commands",
          message: `Completed reviewed command ${reviewed.commandId}`,
        });
      }

      const status = await this.#execute({
        handle,
        profile,
        executable: GIT,
        argv: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        cwd: "/workspace",
        signal: abort.signal,
        jobLimits: input.jobLimits,
        executionCount,
        maximumCaptureBytes: internalLimit,
        deadline,
      });
      reportedOutputBytes += status.outputBytes;
      if (status.exitCode !== 0 || status.truncated) {
        throw new Error("SPECIALIST_WORKSPACE_STATUS_INVALID");
      }
      assertReviewedWorkspaceChanges(
        status.stdout,
        input.manifest.writableRoots,
        input.manifest.expectedArtifacts.map((artifact) => artifact.path),
      );

      const patch = await this.#execute({
        handle,
        profile,
        executable: GIT,
        argv: [
          "diff",
          "--binary",
          "--no-ext-diff",
          "HEAD",
          "--",
          ...input.manifest.writableRoots,
        ],
        cwd: "/workspace",
        signal: abort.signal,
        jobLimits: input.jobLimits,
        executionCount,
        maximumCaptureBytes: input.policy.maximumOutputBytes,
        deadline,
      });
      reportedOutputBytes += patch.outputBytes;
      if (patch.exitCode !== 0 || patch.truncated) {
        throw new Error("SPECIALIST_PATCH_LIMIT_EXCEEDED");
      }
      const headAfter = await this.#execute({
        handle,
        profile,
        executable: GIT,
        argv: ["rev-parse", "--verify", "HEAD"],
        cwd: "/workspace",
        signal: abort.signal,
        jobLimits: input.jobLimits,
        executionCount,
        maximumCaptureBytes: internalLimit,
        deadline,
      });
      reportedOutputBytes += headAfter.outputBytes;
      if (
        headAfter.exitCode !== 0 ||
        headAfter.truncated ||
        headAfter.stdout.trim() !== sourceHead
      ) {
        throw new Error("SPECIALIST_CANONICAL_HISTORY_CHANGED");
      }
      if (reportedOutputBytes > input.manifest.limits.maximumOutputBytes) {
        throw new Error("SPECIALIST_OUTPUT_LIMIT_EXCEEDED");
      }

      const adopted = await this.#readExpectedArtifacts({
        handle,
        expected: input.manifest.expectedArtifacts,
        maximumBytes:
          input.manifest.limits.maximumOutputBytes - reportedOutputBytes,
        signal: abort.signal,
      });
      const patchBytes = new TextEncoder().encode(patch.stdout);
      const logBytes = new TextEncoder().encode(`${logParts.join("\n")}\n`);
      const stored: StoredOutput[] = [
        {
          path: PATCH_PATH,
          bytes: patchBytes,
          digest: sha256(patchBytes),
          mimeType: "text/x-diff",
        },
        {
          path: LOG_PATH,
          bytes: logBytes,
          digest: sha256(logBytes),
          mimeType: "text/plain",
        },
        ...adopted,
      ];
      const resultWorkspaceSnapshot =
        await this.#provider.snapshotWorkspace(handle);
      if (resultWorkspaceSnapshot.provider !== this.#provider.id) {
        throw new Error("SPECIALIST_RESULT_SNAPSHOT_PROVIDER_MISMATCH");
      }
      const output = specialistWorkerOutputV1Schema.parse({
        schemaVersion: 1,
        worker: input.manifest.worker,
        jobId: input.manifest.jobId,
        sourceWorkspaceSnapshot: input.manifest.sourceWorkspaceSnapshot,
        resultWorkspaceSnapshot,
        sourceRevisionDigest: input.manifest.sourceRevisionDigest,
        patch: outputMetadata(stored[0]!),
        log: outputMetadata(stored[1]!),
        artifacts: stored.slice(2).map(outputMetadata),
        commands: commandResults,
        externalChangeProposals: [],
        reviewRequired: true,
        sessionHistoryImported: false,
      });
      const resultBytes = new TextEncoder().encode(
        `${canonicalJson(output)}\n`,
      );
      stored.push({
        path: RESULT_PATH,
        bytes: resultBytes,
        digest: sha256(resultBytes),
        mimeType: "application/json",
      });
      const totalBytes = stored.reduce(
        (total, candidate) => total + candidate.bytes.byteLength,
        0,
      );
      if (
        totalBytes > input.manifest.limits.maximumOutputBytes ||
        totalBytes > input.policy.maximumOutputBytes ||
        totalBytes > input.jobLimits.outputBytes
      ) {
        throw new Error("SPECIALIST_OUTPUT_LIMIT_EXCEEDED");
      }
      const resultArtifacts: NodeArtifactRef[] = [];
      for (const candidate of stored) {
        resultArtifacts.push(
          await this.#storeOutput(
            input.manifest.ownerId,
            input.manifest.jobId,
            candidate,
          ),
        );
      }
      return { output, resultArtifacts: Object.freeze(resultArtifacts) };
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", forwardAbort);
      if (handle) {
        await this.#provider.stop(handle).catch(() => undefined);
        await this.#provider.destroy(handle).catch(() => undefined);
      }
    }
  }

  async #requirePreflight(policy: SpecialistWorkerPolicy) {
    const profile = this.#profiles.get(policy.worker);
    if (!profile || !this.#profileMatchesPolicy(profile, policy)) {
      throw new Error("SPECIALIST_PROFILE_NOT_CONFIGURED");
    }
    const preflight = sandboxPreflightResultSchema.parse(
      await this.#provider.preflight({
        profile,
        expectedHostPolicyDigest: this.#hostPolicyDigest,
        maxEvidenceAgeMs: this.#maxEvidenceAgeMs,
        now: this.#now(),
      }),
    );
    if (
      !preflight.ok ||
      preflight.evidence.providerId !== this.#provider.id ||
      preflight.evidence.profileId !== profile.id ||
      preflight.evidence.profileVersion !== profile.version ||
      preflight.evidence.imageDigest !== policy.digest ||
      preflight.evidence.hostPolicyDigest !== this.#hostPolicyDigest
    ) {
      throw new Error("SPECIALIST_PREFLIGHT_FAILED");
    }
    return profile;
  }

  #profileMatchesPolicy(
    profile: SandboxExecutionProfile,
    policy: SpecialistWorkerPolicy,
  ) {
    const expected = [...policy.commands.values()].map((argv) => argv[0]!);
    const hosts =
      profile.egress.mode === "allowlist"
        ? profile.egress.destinations
            .map((destination) => destination.hostname)
            .sort()
        : [];
    return (
      profile.enabled &&
      profile.id === policy.worker &&
      profile.workload.kind === policy.worker &&
      profile.image.imageDigest === policy.digest &&
      profile.resources.outputBytes <= policy.maximumOutputBytes &&
      profile.resources.workspaceBytes <=
        policy.maximumInputBytes + policy.maximumOutputBytes &&
      expected.every((executable) =>
        profile.entrypoints.includes(executable),
      ) &&
      profile.entrypoints.includes(GIT) &&
      (policy.network === "denied"
        ? profile.egress.mode === "none" &&
          profile.resources.networkBytes === 0 &&
          profile.resources.networkRequests === 0
        : profile.egress.mode === "allowlist" &&
          profile.egress.destinations.every(
            (destination) =>
              destination.protocol === "https" &&
              destination.port === 443 &&
              destination.pathPrefix === "/",
          ) &&
          canonicalJson(hosts) === canonicalJson(policy.allowedHosts))
    );
  }

  async #verifyFrozenLockfile(
    handle: Parameters<SandboxProvider["getFiles"]>[0],
    manifest: SpecialistWorkerManifestV1,
    signal: AbortSignal,
  ) {
    if (manifest.dependencyPolicy.mode === "none") return;
    const [entry] = await this.#provider.getFiles(handle, [
      manifest.dependencyPolicy.lockfilePath,
    ]);
    if (!entry || entry.nodeType !== "file") {
      throw new Error("SPECIALIST_LOCKFILE_MISSING");
    }
    const bytes = await readSandboxFileBounded({
      provider: this.#provider,
      handle,
      entry,
      maximumBytes: manifest.limits.maximumInputBytes,
      signal,
    });
    if (sha256(bytes) !== manifest.dependencyPolicy.lockfileDigest) {
      throw new Error("SPECIALIST_LOCKFILE_DIGEST_MISMATCH");
    }
  }

  async #execute(input: {
    handle: Parameters<SandboxProvider["execute"]>[0]["handle"];
    profile: SandboxExecutionProfile;
    executable: string;
    argv: readonly string[];
    cwd: string;
    signal: AbortSignal;
    jobLimits: NodeJobLimits;
    executionCount: number;
    maximumCaptureBytes: number;
    deadline: number;
    progress?: NodeJobHandlerContext["progress"];
  }) {
    this.#assertActive(input.signal);
    const remaining = input.deadline - Date.now();
    if (remaining < 100) throw new Error("SPECIALIST_DEADLINE_EXPIRED");
    return consumeSandboxExecution({
      events: this.#provider.execute({
        handle: input.handle,
        executable: input.executable,
        argv: input.argv,
        cwd: input.cwd,
        environment: {
          HOME: "/workspace",
          LANG: "C.UTF-8",
          LC_ALL: "C.UTF-8",
          TZ: "UTC",
          SOURCE_DATE_EPOCH: "0",
        },
        resources: {
          cpuMillis: Math.max(
            100,
            Math.min(
              input.profile.resources.cpuMillis,
              Math.floor(input.jobLimits.cpuMillis / input.executionCount),
            ),
          ),
          memoryBytes: Math.min(
            input.profile.resources.memoryBytes,
            input.jobLimits.memoryBytes,
          ),
          wallTimeMs: Math.max(
            100,
            Math.min(input.profile.resources.wallTimeMs, remaining),
          ),
          outputBytes: Math.min(
            input.profile.resources.outputBytes,
            input.jobLimits.outputBytes,
          ),
          stdoutBytes: Math.min(
            input.profile.resources.stdoutBytes,
            input.maximumCaptureBytes,
          ),
          stderrBytes: Math.min(
            input.profile.resources.stderrBytes,
            input.maximumCaptureBytes,
          ),
          eventBytes: Math.min(
            input.profile.resources.eventBytes,
            Math.max(input.maximumCaptureBytes, 1),
          ),
          workspaceBytes: input.profile.resources.workspaceBytes,
          networkBytes: input.profile.resources.networkBytes,
          networkRequests: input.profile.resources.networkRequests,
        },
        signal: input.signal,
      }),
      signal: input.signal,
      maximumCaptureBytes: input.maximumCaptureBytes,
      maximumEventBytes: Math.min(
        input.profile.resources.eventBytes,
        Math.max(input.maximumCaptureBytes, 1),
      ),
      progress: input.progress,
    });
  }

  async #readExpectedArtifacts(input: {
    handle: Parameters<SandboxProvider["getFiles"]>[0];
    expected: SpecialistWorkerManifestV1["expectedArtifacts"];
    maximumBytes: number;
    signal: AbortSignal;
  }): Promise<StoredOutput[]> {
    if (input.expected.length === 0) return [];
    const manifest = await this.#provider.getFiles(
      input.handle,
      input.expected.map((artifact) => artifact.path),
    );
    if (manifest.length !== input.expected.length) {
      throw new Error("SPECIALIST_ARTIFACT_MANIFEST_MISMATCH");
    }
    const outputs: StoredOutput[] = [];
    let total = 0;
    for (let index = 0; index < input.expected.length; index += 1) {
      const expected = input.expected[index]!;
      const entry = manifest[index]!;
      if (
        entry.relativePath !== expected.path ||
        entry.mimeType !== expected.mimeType ||
        entry.nodeType !== "file"
      ) {
        throw new Error("SPECIALIST_ARTIFACT_MANIFEST_MISMATCH");
      }
      const bytes = await readSandboxFileBounded({
        provider: this.#provider,
        handle: input.handle,
        entry,
        maximumBytes: input.maximumBytes - total,
        signal: input.signal,
      });
      total += bytes.byteLength;
      outputs.push({
        path: entry.relativePath,
        bytes,
        digest: sha256(bytes),
        mimeType: entry.mimeType,
      });
    }
    return outputs;
  }

  async #storeOutput(
    ownerId: string,
    jobId: string,
    output: StoredOutput,
  ): Promise<NodeArtifactRef> {
    const jobKey = createHash("sha256").update(jobId).digest("hex");
    const pathKey = createHash("sha256").update(output.path).digest("hex");
    const ref = {
      ownerId,
      namespace: "specialist-results",
      key: `${jobKey}/${pathKey}`,
    };
    const commit = await this.#storage.put({
      ref,
      body: bytesStream(output.bytes),
      byteSize: output.bytes.byteLength,
      mimeType: output.mimeType,
      expectedDigest: output.digest,
      idempotencyKey: `specialist-${jobKey.slice(0, 32)}-${pathKey.slice(0, 32)}`,
    });
    return nodeArtifactRefSchema.parse({
      object: commit.ref,
      digest: commit.digest,
      byteSize: commit.byteSize,
      mimeType: commit.mimeType,
    });
  }

  #assertActive(signal: AbortSignal) {
    if (signal.aborted) {
      throw new Error(
        signal.reason === "deadline"
          ? "SPECIALIST_DEADLINE_EXPIRED"
          : "SPECIALIST_JOB_CANCELLED",
      );
    }
  }
}

/** Reviewed job envelope adapter around the specialist sandbox runner. */
export class SpecialistWorkerJobHandler implements NodeJobHandler {
  readonly kind: string;
  readonly capabilityVersion = 1;
  readonly requiredCapability: string;
  readonly #worker: SpecialistWorkerId;
  readonly #policy: SpecialistWorkerPolicy;
  readonly #readManifest: SpecialistManifestReader;
  readonly #runner: SpecialistSandboxRunner;

  constructor(input: {
    worker: SpecialistWorkerId;
    config: NodeConfig["workers"][SpecialistWorkerId];
    readManifest: SpecialistManifestReader;
    runner: SpecialistSandboxRunner;
  }) {
    this.#worker = input.worker;
    this.kind = `specialist.${input.worker}`;
    this.requiredCapability = `jobs:${this.kind}`;
    this.#policy = specialistWorkerPolicy(input.worker, input.config);
    this.#readManifest = input.readManifest;
    this.#runner = input.runner;
  }

  healthy() {
    return this.#runner.healthy({ policy: this.#policy });
  }

  async execute(context: NodeJobHandlerContext) {
    const { job } = context;
    if (job.inputRefs.length !== 1) {
      throw new Error("SPECIALIST_MANIFEST_INPUT_REQUIRED");
    }
    const artifact = nodeArtifactRefSchema.parse(job.inputRefs[0]);
    if (
      artifact.object.ownerId !== job.principalRef.userId ||
      artifact.mimeType !== "application/json"
    ) {
      throw new Error("SPECIALIST_MANIFEST_OWNER_OR_TYPE_MISMATCH");
    }
    if (
      artifact.byteSize > job.limits.inputBytes ||
      artifact.byteSize > this.#policy.maximumInputBytes
    ) {
      throw new Error("SPECIALIST_INPUT_LIMIT_EXCEEDED");
    }
    const bytes = await this.#readManifest({
      artifact,
      maximumBytes: Math.min(
        job.limits.inputBytes,
        this.#policy.maximumInputBytes,
      ),
      signal: context.signal,
    });
    const digest = sha256(bytes);
    if (digest !== artifact.digest || bytes.byteLength !== artifact.byteSize) {
      throw new Error("SPECIALIST_MANIFEST_DIGEST_MISMATCH");
    }
    const manifest = specialistWorkerManifestV1Schema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    );
    if (
      manifest.worker !== this.#worker ||
      manifest.jobId !== job.id ||
      manifest.ownerId !== job.principalRef.userId
    ) {
      throw new Error("SPECIALIST_MANIFEST_BINDING_MISMATCH");
    }
    if (
      ["disabled", "mock"].includes(
        manifest.sourceWorkspaceSnapshot.provider,
      )
    ) {
      throw new Error("SPECIALIST_ATTESTED_SNAPSHOT_REQUIRED");
    }
    if (
      Date.parse(manifest.limits.deadline) > Date.parse(job.limits.deadline) ||
      manifest.limits.maximumInputBytes > job.limits.inputBytes ||
      manifest.limits.maximumInputBytes > this.#policy.maximumInputBytes ||
      manifest.limits.maximumOutputBytes > job.limits.outputBytes ||
      manifest.limits.maximumOutputBytes > this.#policy.maximumOutputBytes ||
      manifest.limits.maximumCommands > this.#policy.maximumCommands ||
      manifest.egressPolicyDigest !== this.#policy.egressPolicyDigest
    ) {
      throw new Error("SPECIALIST_POLICY_LIMIT_MISMATCH");
    }
    const requestedCommands = new Set<string>();
    for (const command of manifest.reviewedCommands) {
      if (
        requestedCommands.has(command.commandId) ||
        !this.#policy.commands.has(command.commandId)
      ) {
        throw new Error("SPECIALIST_COMMAND_NOT_REVIEWED");
      }
      requestedCommands.add(command.commandId);
    }
    const result = await this.#runner.run({
      manifest,
      manifestBytes: bytes,
      policy: this.#policy,
      jobLimits: job.limits,
      signal: context.signal,
      progress: context.progress,
    });
    const output = specialistWorkerOutputV1Schema.parse(result.output);
    if (
      output.worker !== manifest.worker ||
      output.jobId !== manifest.jobId ||
      output.sourceRevisionDigest !== manifest.sourceRevisionDigest ||
      JSON.stringify(output.sourceWorkspaceSnapshot) !==
        JSON.stringify(manifest.sourceWorkspaceSnapshot) ||
      output.resultWorkspaceSnapshot.provider !==
        manifest.sourceWorkspaceSnapshot.provider
    ) {
      throw new Error("SPECIALIST_OUTPUT_BINDING_MISMATCH");
    }
    const resultArtifacts = result.resultArtifacts.map((candidate) =>
      nodeArtifactRefSchema.parse(candidate),
    );
    if (
      resultArtifacts.some(
        (candidate) => candidate.object.ownerId !== manifest.ownerId,
      )
    ) {
      throw new Error("SPECIALIST_OUTPUT_OWNER_MISMATCH");
    }
    const outputBytes = resultArtifacts.reduce(
      (total, candidate) => total + candidate.byteSize,
      0,
    );
    if (
      outputBytes > manifest.limits.maximumOutputBytes ||
      outputBytes > this.#policy.maximumOutputBytes
    ) {
      throw new Error("SPECIALIST_OUTPUT_LIMIT_EXCEEDED");
    }
    return resultArtifacts;
  }
}

function outputMetadata(output: StoredOutput) {
  return {
    path: output.path,
    digest: output.digest,
    byteSize: output.bytes.byteLength,
    mimeType: output.mimeType,
  };
}

function sha256(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

async function readSandboxFileBounded(input: {
  provider: SandboxProvider;
  handle: Parameters<SandboxProvider["readFile"]>[0];
  entry: SandboxFileManifestEntry;
  maximumBytes: number;
  signal: AbortSignal;
}) {
  if (
    input.maximumBytes < 0 ||
    input.entry.byteSize > input.maximumBytes ||
    input.entry.nodeType !== "file"
  ) {
    throw new Error("SPECIALIST_ARTIFACT_LIMIT_EXCEEDED");
  }
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of input.provider.readFile(
    input.handle,
    input.entry.relativePath,
  )) {
    if (input.signal.aborted) throw new Error("SPECIALIST_JOB_CANCELLED");
    total += chunk.byteLength;
    if (total > input.maximumBytes || total > input.entry.byteSize) {
      throw new Error("SPECIALIST_ARTIFACT_LIMIT_EXCEEDED");
    }
    chunks.push(chunk.slice());
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (total !== input.entry.byteSize || sha256(bytes) !== input.entry.digest) {
    throw new Error("SPECIALIST_ARTIFACT_DIGEST_MISMATCH");
  }
  return bytes;
}

async function consumeSandboxExecution(input: {
  events: AsyncIterable<SandboxExecutionEvent>;
  signal: AbortSignal;
  maximumCaptureBytes: number;
  maximumEventBytes: number;
  progress?: NodeJobHandlerContext["progress"];
}) {
  let started = false;
  let exitCode: number | null = null;
  let outputBytes = 0;
  let eventBytes = 0;
  const stdout: Uint8Array[] = [];
  const stderr: Uint8Array[] = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let stdoutTruncated = false;
  let stderrTruncated = false;
  for await (const event of input.events) {
    if (input.signal.aborted) throw new Error("SPECIALIST_JOB_CANCELLED");
    eventBytes += new TextEncoder().encode(JSON.stringify(event)).byteLength;
    if (eventBytes > input.maximumEventBytes) {
      throw new Error("SPECIALIST_EVENT_LIMIT_EXCEEDED");
    }
    if (event.type === "started") {
      if (started || exitCode !== null) {
        throw new Error("SPECIALIST_EVENT_ORDER_INVALID");
      }
      started = true;
      continue;
    }
    if (!started || exitCode !== null) {
      throw new Error("SPECIALIST_EVENT_ORDER_INVALID");
    }
    if (event.type === "progress") {
      await input.progress?.({
        numerator: event.current,
        denominator: Math.max(1, event.total),
        unit: "worker",
        message: event.message ?? "Specialist worker progress",
      });
      continue;
    }
    if (event.type === "stdout" || event.type === "stderr") {
      const bytes = new TextEncoder().encode(event.chunk);
      const used = stdoutBytes + stderrBytes;
      const remaining = Math.max(0, input.maximumCaptureBytes - used);
      const selected = bytes.slice(0, remaining);
      if (event.type === "stdout") {
        stdout.push(selected);
        stdoutBytes += selected.byteLength;
        stdoutTruncated ||=
          event.truncated || selected.byteLength < bytes.byteLength;
      } else {
        stderr.push(selected);
        stderrBytes += selected.byteLength;
        stderrTruncated ||=
          event.truncated || selected.byteLength < bytes.byteLength;
      }
      continue;
    }
    exitCode = event.exitCode;
    outputBytes = event.outputBytes;
    if (outputBytes > input.maximumCaptureBytes) {
      stdoutTruncated = true;
      stderrTruncated = true;
    }
  }
  if (!started || exitCode === null) {
    throw new Error("SPECIALIST_EVENT_ORDER_INVALID");
  }
  return {
    exitCode,
    outputBytes,
    stdout: decodeChunks(stdout, stdoutBytes),
    stderr: decodeChunks(stderr, stderrBytes),
    stdoutTruncated,
    stderrTruncated,
    truncated: stdoutTruncated || stderrTruncated,
  };
}

function decodeChunks(chunks: readonly Uint8Array[], total: number) {
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

function assertReviewedWorkspaceChanges(
  porcelain: string,
  writableRoots: readonly string[],
  expectedArtifacts: readonly string[],
) {
  const fields = porcelain.split("\0");
  const allowedRoots = new Set(writableRoots);
  const expected = new Set(expectedArtifacts);
  for (let index = 0; index < fields.length; index += 1) {
    const record = fields[index];
    if (!record) continue;
    if (record.length < 4 || record[2] !== " ") {
      throw new Error("SPECIALIST_WORKSPACE_STATUS_INVALID");
    }
    const status = record.slice(0, 2);
    const paths = [record.slice(3)];
    if (status.includes("R") || status.includes("C")) {
      const source = fields[index + 1];
      if (!source) throw new Error("SPECIALIST_WORKSPACE_STATUS_INVALID");
      paths.push(source);
      index += 1;
    }
    for (const path of paths) {
      const root = path.split("/", 1)[0];
      if (
        !root ||
        !allowedRoots.has(root) ||
        path.includes("..") ||
        path.startsWith("/")
      ) {
        throw new Error("SPECIALIST_WRITE_OUTSIDE_REVIEWED_ROOTS");
      }
      if (
        status === "??" &&
        (!path.startsWith("output/") || !expected.has(path))
      ) {
        throw new Error("SPECIALIST_UNREVIEWED_UNTRACKED_OUTPUT");
      }
    }
  }
}
