import { afterEach, describe, expect, test } from "bun:test";
import type {
  SandboxBaselineEvidence,
  SandboxCreateInput,
  SandboxExecuteInput,
  SandboxExecutionEvent,
  SandboxExecutionProfile,
  SandboxHandle,
  SandboxProvider,
  SpecialistWorkerManifestV1,
} from "@avermate/agent-contracts";
import {
  sandboxHandleSchema,
  specialistWorkerManifestV1Schema,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NodeConfig } from "./config";
import { FilesystemObjectStorageProvider } from "./filesystem-storage";
import { canonicalDigest } from "./canonical-json";
import {
  createSpecialistSandboxProfile,
  ProviderSpecialistSandboxRunner,
  specialistWorkerPolicy,
} from "./specialist-workers";

const roots: string[] = [];
const digest = (value: string | Uint8Array) =>
  `sha256:${createHash("sha256").update(value).digest("hex")}` as const;
const imageDigest = `sha256:${"a".repeat(64)}` as const;
const hostPolicyDigest = `sha256:${"b".repeat(64)}` as const;
const snapshotDigest = `sha256:${"c".repeat(64)}` as const;

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function workerConfig(): NodeConfig["workers"]["opencode"] {
  return {
    enabled: true,
    image: `ghcr.io/reviewed/opencode:1.18.17@${imageDigest}`,
    digest: imageDigest,
    license: "MIT",
    maximumInputBytes: 2 * 1024 * 1024,
    maximumOutputBytes: 4 * 1024 * 1024,
    maximumCommands: 4,
    commandCatalogue: [
      {
        id: "analyze",
        argv: [
          "/opt/avermate/bin/opencode",
          "run",
          "Read /workspace/input/request.json",
        ],
      },
    ],
    network: "denied",
    allowedHosts: [],
  };
}

function manifest(
  overrides: Partial<SpecialistWorkerManifestV1> = {},
): SpecialistWorkerManifestV1 {
  return specialistWorkerManifestV1Schema.parse({
    schemaVersion: 1,
    worker: "opencode",
    operation: "revise-artifact",
    jobId: "job-specialist-1",
    ownerId: "owner-1",
    sourceWorkspaceSnapshot: {
      provider: "opensandbox",
      digest: snapshotDigest,
      format: "portable-tar-v1",
    },
    sourceRevisionDigest: digest("source-revision"),
    instruction: "Revise the reviewed source and produce the requested output.",
    writableRoots: ["src", "output"],
    reviewedCommands: [{ commandId: "analyze", cwd: "." }],
    expectedArtifacts: [
      { path: "output/report.txt", mimeType: "text/plain" },
    ],
    dependencyPolicy: { mode: "none" },
    egressPolicyDigest: canonicalDigest({
      network: "denied",
      allowedHosts: [],
    }),
    toolGrantIds: [],
    limits: {
      maximumInputBytes: 2 * 1024 * 1024,
      maximumOutputBytes: 4 * 1024 * 1024,
      maximumCommands: 4,
      deadline: new Date(Date.now() + 60_000).toISOString(),
    },
    reviewRequired: true,
    ...overrides,
  });
}

function evidence(profile: SandboxExecutionProfile): SandboxBaselineEvidence {
  const checks = Object.fromEntries(
    [
      "non-root-unprivileged",
      "readonly-rootfs",
      "capabilities-dropped",
      "no-new-privileges",
      "host-namespaces-isolated",
      "host-mounts-sockets-devices-denied",
      "proc-sys-masked",
      "bounded-tmpfs",
      "seccomp-lsm-enforced",
      "cgroup-limits-enforced",
      "network-default-deny",
      "environment-sanitized",
    ].map((id) => [id, { status: "pass", observed: "verified" }]),
  ) as SandboxBaselineEvidence["checks"];
  return {
    baselineVersion: 1,
    providerId: "opensandbox",
    profileId: profile.id,
    profileVersion: profile.version,
    isolationClass: "gvisor-personal",
    runtimeKind: "opensandbox",
    runtimeVersion: "0.1.11",
    probeVersion: "plan038-test",
    imageDigest: profile.image.imageDigest,
    hostPolicyDigest,
    evidenceNonce: "evidence-1",
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    checks,
  };
}

class ReviewedProvider implements SandboxProvider {
  readonly id = "opensandbox" as const;
  readonly commands: SandboxExecuteInput[] = [];
  readonly requestFiles: string[] = [];
  stopped = false;
  destroyed = false;
  healthy = true;
  status = " M src/app.ts\0?? output/report.txt\0";
  readonly artifact = new TextEncoder().encode("reviewed artifact\n");

  constructor(readonly profile: SandboxExecutionProfile) {}

  async capabilities() {
    return {
      providerId: this.id,
      available: this.healthy,
      profiles: this.healthy
        ? [
            {
              id: this.profile.id,
              version: this.profile.version,
              isolationClass: "gvisor-personal" as const,
              evidence: evidence(this.profile),
            },
          ]
        : [],
    };
  }

  async preflight() {
    return this.healthy
      ? ({ ok: true, evidence: evidence(this.profile) } as const)
      : ({
          ok: false,
          reason: "TRANSPORT_UNAVAILABLE" as const,
          message: "unavailable",
        } as const);
  }

  async create(input: SandboxCreateInput) {
    return this.handle(input);
  }

  async forkWorkspace(input: SandboxCreateInput) {
    return this.handle(input);
  }

  async *execute(
    input: SandboxExecuteInput,
  ): AsyncIterable<SandboxExecutionEvent> {
    this.commands.push(input);
    let stdout = "completed\n";
    if (input.executable === "/usr/bin/git") {
      if (input.argv[0] === "rev-parse") stdout = "abc123\n";
      if (input.argv[0] === "status") stdout = this.status;
      if (input.argv[0] === "diff") {
        stdout = "diff --git a/src/app.ts b/src/app.ts\n+reviewed\n";
      }
    }
    yield { type: "started", at: new Date().toISOString() };
    yield { type: "stdout", chunk: stdout, truncated: false };
    yield {
      type: "exited",
      at: new Date().toISOString(),
      exitCode: 0,
      signal: null,
      outputBytes: new TextEncoder().encode(stdout).byteLength,
    };
  }

  async putFiles(_handle: SandboxHandle, files: readonly { relativePath: string }[]) {
    this.requestFiles.push(...files.map((file) => file.relativePath));
  }

  async getFiles(_handle: SandboxHandle, paths: readonly string[]) {
    return paths.map((path) => {
      if (path !== "output/report.txt") throw new Error("unexpected path");
      return {
        relativePath: path,
        digest: digest(this.artifact),
        byteSize: this.artifact.byteLength,
        mimeType: "text/plain",
        kind: "text" as const,
        nodeType: "file" as const,
      };
    });
  }

  async *readFile() {
    yield this.artifact.slice();
  }

  async snapshotWorkspace() {
    return {
      provider: this.id,
      digest: digest("result-snapshot"),
      format: "portable-tar-v1",
    };
  }

  async stop() {
    this.stopped = true;
  }

  async destroy() {
    this.destroyed = true;
  }

  handle(input: SandboxCreateInput) {
    return sandboxHandleSchema.parse({
      providerId: this.id,
      sandboxId: "sandbox-1",
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      profileId: input.profile.id,
      profileVersion: input.profile.version,
      image: input.profile.image,
      evidenceNonce: "evidence-1",
      expiresAt: input.expiresAt.toISOString(),
    });
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "specialist-worker-"));
  roots.push(root);
  const config = workerConfig();
  const profile = createSpecialistSandboxProfile("opencode", config);
  const provider = new ReviewedProvider(profile);
  const storage = new FilesystemObjectStorageProvider({
    root,
    maxObjectBytes: 16 * 1024 * 1024,
    quotaBytes: 64 * 1024 * 1024,
  });
  await storage.initialize();
  const runner = new ProviderSpecialistSandboxRunner({
    provider,
    profiles: { opencode: profile },
    hostPolicyDigest,
    maxEvidenceAgeMs: 60_000,
    storage,
  });
  return { config, profile, provider, storage, runner };
}

describe("provider specialist worker runner", () => {
  test("preflights, executes only reviewed argv, and adopts bounded reviewed outputs", async () => {
    const { config, provider, storage, runner } = await fixture();
    const request = manifest();
    const result = await runner.run({
      manifest: request,
      manifestBytes: new TextEncoder().encode(JSON.stringify(request)),
      policy: specialistWorkerPolicy("opencode", config),
      jobLimits: {
        cpuMillis: 64_000,
        memoryBytes: 2 * 1024 ** 3,
        inputBytes: 2 * 1024 * 1024,
        outputBytes: 4 * 1024 * 1024,
        deadline: request.limits.deadline,
      },
      signal: new AbortController().signal,
      progress: async () => undefined,
    });

    expect(result.output.sessionHistoryImported).toBe(false);
    expect(result.output.reviewRequired).toBe(true);
    expect(result.output.artifacts).toHaveLength(1);
    expect(result.resultArtifacts).toHaveLength(4);
    expect(provider.requestFiles).toEqual(["input/request.json"]);
    expect(provider.commands.map((command) => command.executable)).toEqual([
      "/usr/bin/git",
      "/opt/avermate/bin/opencode",
      "/usr/bin/git",
      "/usr/bin/git",
      "/usr/bin/git",
    ]);
    expect(
      provider.commands.every(
        (command) =>
          command.environment?.HOME === "/workspace" &&
          Object.keys(command.environment).every(
            (key) => !/(TOKEN|KEY|SECRET|PASSWORD)/u.test(key),
          ),
      ),
    ).toBe(true);
    expect(provider.stopped).toBe(true);
    expect(provider.destroyed).toBe(true);
    for (const artifact of result.resultArtifacts) {
      expect(await storage.stat({ ref: artifact.object })).toMatchObject({
        digest: artifact.digest,
        byteSize: artifact.byteSize,
      });
    }
  });

  test("does not advertise a profile whose provider preflight is unhealthy", async () => {
    const { config, provider, runner } = await fixture();
    provider.healthy = false;
    expect(
      await runner.healthy({
        policy: specialistWorkerPolicy("opencode", config),
      }),
    ).toBe(false);
  });

  test("rejects unreviewed workspace outputs and always tears down", async () => {
    const { config, provider, runner } = await fixture();
    provider.status = "?? output/unreviewed.txt\0";
    const request = manifest();
    await expect(
      runner.run({
        manifest: request,
        manifestBytes: new TextEncoder().encode(JSON.stringify(request)),
        policy: specialistWorkerPolicy("opencode", config),
        jobLimits: {
          cpuMillis: 64_000,
          memoryBytes: 2 * 1024 ** 3,
          inputBytes: 2 * 1024 * 1024,
          outputBytes: 4 * 1024 * 1024,
          deadline: request.limits.deadline,
        },
        signal: new AbortController().signal,
        progress: async () => undefined,
      }),
    ).rejects.toThrow("SPECIALIST_UNREVIEWED_UNTRACKED_OUTPUT");
    expect(provider.stopped).toBe(true);
    expect(provider.destroyed).toBe(true);
  });
});
