import {
  ConnectionConfig,
  Sandbox,
  SandboxManager,
  type ConnectionConfigOptions,
} from "@alibaba-group/opensandbox";
import {
  sandboxBaselineEvidenceSchema,
  type SandboxBaselineEvidence,
  type SandboxCreateInput,
  type SandboxExecutionEvent,
  type SandboxExecutionProfile,
  type SandboxFileManifestEntry,
  type SandboxHandle,
  type SandboxInputFile,
  type SandboxIsolationClass,
  type SandboxRuntimeCheckpointCapabilities,
  type SandboxRuntimeCheckpointCompatibilityV1,
  type SandboxRuntimeCheckpointRefV1,
  type SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import {
  sandboxRuntimeCheckpointCompatibilityV1Schema,
  sandboxRuntimeCheckpointRefV1Schema,
  sandboxWorkspaceSnapshotRefSchema,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { SandboxPolicyError, SandboxUnavailableError } from "./errors";
import type { RemoteSandboxTransport } from "./remote-provider";
import type {
  PortableWorkspaceFile,
  PortableWorkspaceSnapshotStore,
} from "./portable-workspace-contract";

const WORKSPACE = "/workspace";
const RUNTIME_SNAPSHOT_NAME_PREFIX = "avermate-runtime-v1";

export type OpenSandboxRuntimeCheckpointConfig = {
  region: string;
  architecture: "amd64" | "arm64";
  runtimeKind: string;
  runtimeVersion: string;
  maximumTtlSeconds: number;
};

export interface OpenSandboxSdkTransportConfig {
  connection: ConnectionConfigOptions;
  evidenceUrl: string;
  evidenceToken?: string;
  imageUris: Readonly<Record<string, string>>;
  profiles: readonly SandboxExecutionProfile[];
  requestTimeoutMs?: number;
  fetch?: typeof fetch;
  workspaceSnapshots?: PortableWorkspaceSnapshotStore;
  runtimeCheckpoint?: OpenSandboxRuntimeCheckpointConfig;
}

export function createOpenSandboxSdkTransportFromEnvironment(input: {
  environment: Readonly<Record<string, string | undefined>>;
  profiles: readonly SandboxExecutionProfile[];
  workspaceSnapshots?: PortableWorkspaceSnapshotStore;
}): OpenSandboxSdkTransport {
  const environment = input.environment;
  const domain =
    environment.SANDBOX_OPENSANDBOX_DOMAIN?.trim() ||
    environment.OPEN_SANDBOX_DOMAIN?.trim();
  const evidenceUrl = environment.SANDBOX_OPENSANDBOX_EVIDENCE_URL?.trim();
  if (!domain || !evidenceUrl) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "OpenSandbox requires SANDBOX_OPENSANDBOX_DOMAIN and SANDBOX_OPENSANDBOX_EVIDENCE_URL.",
    );
  }
  if (domain.includes("://") || domain.includes("/") || domain.includes("@")) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "SANDBOX_OPENSANDBOX_DOMAIN must contain only host[:port].",
    );
  }
  const protocol =
    environment.SANDBOX_OPENSANDBOX_PROTOCOL?.trim().toLowerCase() || "http";
  if (protocol !== "http" && protocol !== "https") {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "SANDBOX_OPENSANDBOX_PROTOCOL must be http or https.",
    );
  }
  const imageUris: Record<string, string> = {};
  for (const profile of input.profiles.filter((value) => value.enabled)) {
    const stem = profile.id.replaceAll("-", "_").toUpperCase();
    const uri = environment[`SANDBOX_PROFILE_${stem}_IMAGE_URI`]?.trim();
    if (!uri) {
      throw new SandboxUnavailableError(
        "CONFIGURATION_INVALID",
        `SANDBOX_PROFILE_${stem}_IMAGE_URI is required for an enabled OpenSandbox profile.`,
      );
    }
    imageUris[profile.id] = uri;
  }
  const runtimeRegion = environment.SANDBOX_OPENSANDBOX_REGION?.trim();
  const runtimeArchitecture =
    environment.SANDBOX_OPENSANDBOX_ARCHITECTURE?.trim();
  const runtimeKind = environment.SANDBOX_OPENSANDBOX_RUNTIME_KIND?.trim();
  const runtimeVersion =
    environment.SANDBOX_OPENSANDBOX_RUNTIME_VERSION?.trim();
  const maximumTtlSeconds = Number(
    environment.SANDBOX_OPENSANDBOX_CHECKPOINT_MAX_TTL_SECONDS ?? "86400",
  );
  const runtimeCheckpoint: OpenSandboxRuntimeCheckpointConfig | undefined =
    runtimeRegion &&
    (runtimeArchitecture === "amd64" || runtimeArchitecture === "arm64") &&
    runtimeKind &&
    runtimeVersion &&
    Number.isSafeInteger(maximumTtlSeconds) &&
    maximumTtlSeconds > 0 &&
    maximumTtlSeconds <= 30 * 24 * 60 * 60
      ? {
          region: runtimeRegion,
          architecture: runtimeArchitecture as "amd64" | "arm64",
          runtimeKind,
          runtimeVersion,
          maximumTtlSeconds,
        }
      : undefined;
  return new OpenSandboxSdkTransport({
    connection: {
      domain,
      protocol,
      apiKey: environment.OPEN_SANDBOX_API_KEY?.trim() || undefined,
      requestTimeoutSeconds: 30,
      useServerProxy:
        environment.SANDBOX_OPENSANDBOX_USE_SERVER_PROXY !== "false",
    },
    evidenceUrl,
    evidenceToken:
      environment.SANDBOX_OPENSANDBOX_EVIDENCE_TOKEN?.trim() || undefined,
    imageUris,
    profiles: input.profiles,
    workspaceSnapshots: input.workspaceSnapshots,
    ...(runtimeCheckpoint ? { runtimeCheckpoint } : {}),
  });
}

/**
 * Production OpenSandbox transport. Lifecycle, command streaming, files and
 * native snapshots use the official SDK. Isolation evidence is deliberately
 * fetched from a separately deployed host probe; the workload container is
 * never trusted to attest its own runtime.
 */
export class OpenSandboxSdkTransport implements RemoteSandboxTransport {
  readonly #connection: ConnectionConfig;
  readonly #evidenceUrl: URL;
  readonly #profiles: Map<string, SandboxExecutionProfile>;
  readonly #imageUris: Readonly<Record<string, string>>;
  readonly #sandboxes = new Map<string, Sandbox>();
  readonly #requestTimeoutMs: number;
  readonly #fetch: typeof fetch;
  readonly #workspaceSnapshots?: PortableWorkspaceSnapshotStore;
  readonly #runtimeCheckpoint?: OpenSandboxRuntimeCheckpointConfig;

  constructor(private readonly config: OpenSandboxSdkTransportConfig) {
    this.#connection = new ConnectionConfig(config.connection);
    this.#evidenceUrl = validatedEvidenceUrl(config.evidenceUrl);
    this.#profiles = new Map(
      config.profiles.map((profile) => [profile.id, profile]),
    );
    this.#imageUris = Object.freeze({ ...config.imageUris });
    this.#requestTimeoutMs = Math.min(
      60_000,
      Math.max(1_000, config.requestTimeoutMs ?? 15_000),
    );
    this.#fetch = config.fetch ?? fetch;
    this.#workspaceSnapshots = config.workspaceSnapshots;
    this.#runtimeCheckpoint = config.runtimeCheckpoint;
    for (const profile of config.profiles.filter((value) => value.enabled)) {
      const uri = this.#imageUris[profile.id];
      if (!uri || !uri.endsWith(`@${profile.image.imageDigest}`)) {
        throw new SandboxUnavailableError(
          "CONFIGURATION_INVALID",
          `OpenSandbox image URI for ${profile.id} must end with its reviewed digest.`,
        );
      }
    }
  }

  async probe(input: {
    providerId: "opensandbox" | "e2b" | "microsandbox";
    profile: SandboxExecutionProfile;
    isolationClass: SandboxIsolationClass;
    expectedHostPolicyDigest: string;
  }): Promise<SandboxBaselineEvidence> {
    if (input.providerId !== "opensandbox") {
      throw new SandboxUnavailableError(
        "CONFIGURATION_INVALID",
        "The OpenSandbox transport cannot attest another provider.",
      );
    }
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.#requestTimeoutMs,
    );
    try {
      const response = await this.#fetch(this.#evidenceUrl, {
        method: "POST",
        redirect: "error",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(this.config.evidenceToken
            ? { authorization: `Bearer ${this.config.evidenceToken}` }
            : {}),
        },
        body: JSON.stringify({
          baselineVersion: 1,
          providerId: input.providerId,
          profileId: input.profile.id,
          profileVersion: input.profile.version,
          imageDigest: input.profile.image.imageDigest,
          isolationClass: input.isolationClass,
          hostPolicyDigest: input.expectedHostPolicyDigest,
        }),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new Error(`Host evidence probe returned HTTP ${response.status}`);
      }
      const text = await response.text();
      if (new TextEncoder().encode(text).byteLength > 256 * 1024) {
        throw new Error("Host evidence response exceeds 256 KiB");
      }
      return sandboxBaselineEvidenceSchema.parse(JSON.parse(text));
    } finally {
      clearTimeout(timeout);
    }
  }

  async create(
    input: SandboxCreateInput & {
      evidence: SandboxBaselineEvidence;
      isolationClass: SandboxIsolationClass;
    },
  ): Promise<{ sandboxId: string }> {
    const sandbox = await Sandbox.create({
      connectionConfig: this.#connection,
      image: this.#requiredImage(input.profile),
      timeoutSeconds: Math.max(
        1,
        Math.ceil((input.expiresAt.getTime() - Date.now()) / 1_000),
      ),
      secureAccess: true,
      env: {},
      metadata: this.#metadata(input),
      networkPolicy: networkPolicy(input.profile),
      resource: {
        cpu: String(input.profile.resources.cpuMillis / 1_000),
        memory: `${Math.ceil(input.profile.resources.memoryBytes / 1024 ** 2)}Mi`,
      },
      extensions: {
        "avermate.profile": `${input.profile.id}@${input.profile.version}`,
        "avermate.image-digest": input.profile.image.imageDigest,
        "avermate.host-policy-digest": input.expectedHostPolicyDigest,
        "avermate.isolation-class": input.isolationClass,
        "avermate.readonly-rootfs": "true",
        "avermate.drop-capabilities": "all",
        "avermate.no-new-privileges": "true",
        "avermate.pids-limit": String(input.profile.resources.pids),
        "avermate.tmpfs-bytes": String(input.profile.resources.tmpfsBytes),
        "avermate.tmpfs-inodes": String(input.profile.resources.tmpfsInodes),
      },
    });
    this.#sandboxes.set(sandbox.id, sandbox);
    if (input.workspaceSnapshotRef) {
      await this.#restoreLogicalWorkspace(
        sandbox,
        input.workspaceSnapshotRef,
        input.ownerId,
        input.profile,
      );
    }
    return { sandboxId: sandbox.id };
  }

  async *execute(
    input: Parameters<RemoteSandboxTransport["execute"]>[0],
  ): AsyncIterable<SandboxExecutionEvent> {
    const sandbox = await this.#sandbox(input.handle);
    const profile = this.#profile(input.handle.profileId);
    const limits = { ...profile.resources, ...(input.resources ?? {}) };
    const command = [input.executable, ...input.argv].map(posixQuote).join(" ");
    let started = false;
    let exited = false;
    let outputBytes = 0;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let exitCode = 0;
    for await (const event of sandbox.commands.runStream(
      command,
      {
        workingDirectory: input.cwd ?? WORKSPACE,
        timeoutSeconds: Math.max(1, Math.ceil(limits.wallTimeMs / 1_000)),
        uid: 1000,
        gid: 1000,
        envs: { ...(input.environment ?? {}) },
      },
      input.signal,
    )) {
      if (!started) {
        started = true;
        yield { type: "started", at: new Date().toISOString() };
      }
      if (event.type === "stdout" || event.type === "stderr") {
        const raw = typeof event.text === "string" ? event.text : "";
        const current = event.type === "stdout" ? stdoutBytes : stderrBytes;
        const ceiling =
          event.type === "stdout" ? limits.stdoutBytes : limits.stderrBytes;
        const remaining = Math.max(0, ceiling - current);
        const bounded = boundedUtf8(raw, remaining);
        const byteLength = new TextEncoder().encode(bounded).byteLength;
        outputBytes += byteLength;
        if (event.type === "stdout") stdoutBytes += byteLength;
        else stderrBytes += byteLength;
        yield {
          type: event.type,
          chunk: bounded,
          truncated: bounded !== raw,
        };
        continue;
      }
      if (event.type === "error") {
        exitCode = numericExitCode(event.error) ?? 1;
        continue;
      }
      if (event.type === "execution_complete") {
        exited = true;
        yield {
          type: "exited",
          at: new Date().toISOString(),
          exitCode,
          signal: null,
          outputBytes,
        };
      }
    }
    if (!started) yield { type: "started", at: new Date().toISOString() };
    if (!exited) {
      yield {
        type: "exited",
        at: new Date().toISOString(),
        exitCode,
        signal: input.signal?.aborted ? "ABORT" : null,
        outputBytes,
      };
    }
  }

  async putFiles(
    handle: SandboxHandle,
    files: readonly SandboxInputFile[],
  ): Promise<void> {
    const sandbox = await this.#sandbox(handle);
    if (files.length === 0) return;
    const directories = new Set<string>([`${WORKSPACE}/input`]);
    for (const file of files) {
      const absolute = absoluteWorkspacePath(file.relativePath);
      const parent = absolute.slice(0, absolute.lastIndexOf("/"));
      directories.add(parent);
    }
    await sandbox.files.createDirectories(
      [...directories]
        .sort((a, b) => a.length - b.length)
        .map((path) => ({ path, mode: 0o700 })),
    );
    await sandbox.files.writeFiles(
      files.map((file) => ({
        path: absoluteWorkspacePath(file.relativePath),
        data: file.bytes,
        mode: 0o400,
      })),
    );
  }

  async getFiles(
    handle: SandboxHandle,
    paths: readonly string[],
  ): Promise<readonly SandboxFileManifestEntry[]> {
    const sandbox = await this.#sandbox(handle);
    const absolute = paths.map(absoluteWorkspacePath);
    const info = await sandbox.files.getFileInfo(absolute);
    const manifest: SandboxFileManifestEntry[] = [];
    for (let index = 0; index < paths.length; index += 1) {
      const relativePath = paths[index]!;
      const absolutePath = absolute[index]!;
      const entry = info[absolutePath];
      if (!entry || entry.type !== "file") {
        throw new SandboxPolicyError(
          "filesystem",
          `OpenSandbox output is missing or not a regular file: ${relativePath}`,
        );
      }
      const bytes = await sandbox.files.readBytes(absolutePath);
      const classified = classifyPath(relativePath);
      manifest.push({
        relativePath,
        digest: digest(bytes),
        byteSize: bytes.byteLength,
        mimeType: classified.mimeType,
        kind: classified.kind,
        nodeType: "file",
      });
    }
    return manifest;
  }

  async *readFile(
    handle: SandboxHandle,
    relativePath: string,
  ): AsyncIterable<Uint8Array> {
    const sandbox = await this.#sandbox(handle);
    yield* sandbox.files.readBytesStream(absoluteWorkspacePath(relativePath));
  }

  async snapshotWorkspace(
    handle: SandboxHandle,
  ): Promise<SandboxWorkspaceSnapshotRef> {
    const sandbox = await this.#sandbox(handle);
    const snapshots = this.#workspaceSnapshots;
    if (!snapshots) {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Portable workspace snapshot storage is not configured.",
      );
    }
    const profile = this.#profile(handle.profileId);
    const entries = await sandbox.files.listDirectory({
      path: WORKSPACE,
      depth: 64,
    });
    const files: PortableWorkspaceFile[] = [];
    let bytes = 0;
    for (const entry of entries) {
      if (entry.type === "directory") continue;
      if (entry.type !== "file" || !entry.path.startsWith(`${WORKSPACE}/`)) {
        throw new SandboxPolicyError(
          "filesystem",
          "Portable snapshots reject links and non-regular workspace entries.",
        );
      }
      const relativePath = entry.path.slice(`${WORKSPACE}/`.length);
      const content = await sandbox.files.readBytes(entry.path);
      bytes += content.byteLength;
      if (
        files.length + 1 > profile.resources.fileCount ||
        bytes > profile.resources.workspaceBytes
      ) {
        throw new SandboxPolicyError(
          "resource",
          "Portable workspace exceeds the reviewed profile ceiling.",
        );
      }
      files.push({
        relativePath,
        bytes: content,
        ...(typeof entry.mode === "number" ? { mode: entry.mode } : {}),
      });
    }
    return snapshots.capture({
      provider: "opensandbox",
      ownerId: handle.ownerId,
      files,
    });
  }

  async forkWorkspace(
    input: SandboxCreateInput & {
      source: SandboxWorkspaceSnapshotRef;
      evidence: SandboxBaselineEvidence;
      isolationClass: SandboxIsolationClass;
    },
  ): Promise<{ sandboxId: string }> {
    return this.create({ ...input, workspaceSnapshotRef: input.source });
  }

  async runtimeCheckpointCapabilities(): Promise<SandboxRuntimeCheckpointCapabilities> {
    const runtime = this.#runtimeCheckpoint;
    if (!runtime) return { available: false, reason: "preflight-unavailable" };
    return {
      available: true,
      provider: "opensandbox",
      regions: [runtime.region],
      architectures: [runtime.architecture],
      runtimeKind: runtime.runtimeKind,
      runtimeVersion: runtime.runtimeVersion,
      maximumTtlSeconds: runtime.maximumTtlSeconds,
    };
  }

  async captureRuntimeCheckpoint(input: {
    handle: SandboxHandle;
    sourceWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    compatibility: SandboxRuntimeCheckpointCompatibilityV1;
    idempotencyKey: string;
    expiresAt: Date;
  }): Promise<SandboxRuntimeCheckpointRefV1> {
    const compatibility = this.#assertRuntimeCompatibility(
      input.handle,
      input.compatibility,
    );
    const source = sandboxWorkspaceSnapshotRefSchema.parse(
      input.sourceWorkspaceSnapshot,
    );
    if (
      source.provider !== "opensandbox" ||
      source.format !== "avermate-portable-workspace-v1"
    ) {
      throw new Error("RUNTIME_CHECKPOINT_LOGICAL_SOURCE_REQUIRED");
    }
    const runtime = this.#runtimeCheckpoint!;
    const ttl = Math.ceil((input.expiresAt.getTime() - Date.now()) / 1_000);
    if (ttl < 1 || ttl > runtime.maximumTtlSeconds) {
      throw new Error("RUNTIME_CHECKPOINT_TTL_INVALID");
    }
    const manager = SandboxManager.create({
      connectionConfig: this.#connection,
    });
    try {
      const binding = runtimeCheckpointBinding({
        ownerId: input.handle.ownerId,
        source,
        compatibility,
        idempotencyKey: input.idempotencyKey,
      });
      const listed = await manager.listSnapshots({
        name: binding,
        page: 1,
        pageSize: 2,
      });
      const matching = listed.items.filter((item) => item.name === binding);
      if (matching.length > 1) {
        throw new Error("RUNTIME_CHECKPOINT_IDEMPOTENCY_COLLISION");
      }
      const existing = matching[0];
      const snapshotId = existing
        ? existing.id
        : (
            await manager.createSnapshot(input.handle.sandboxId, {
              name: binding,
            })
          ).id;
      const ready = await waitForSnapshot(manager, snapshotId);
      if (ready.name !== binding) {
        throw new Error("RUNTIME_CHECKPOINT_BINDING_MISMATCH");
      }
      return sandboxRuntimeCheckpointRefV1Schema.parse({
        version: 1,
        checkpoint: {
          provider: "opensandbox",
          opaqueRef: ready.id,
          portable: false,
        },
        compatibility,
        sourceWorkspaceSnapshot: source,
        captureIdempotencyKey: input.idempotencyKey,
        captureState: "captured",
        adoptedObjectRefs: [],
        capturedAt: ready.createdAt.toISOString(),
        expiresAt: input.expiresAt.toISOString(),
      });
    } finally {
      await manager.close();
    }
  }

  async restoreRuntimeCheckpoint(input: {
    create: SandboxCreateInput;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }) {
    const checkpoint = sandboxRuntimeCheckpointRefV1Schema.parse(
      input.checkpoint,
    );
    if (Date.parse(checkpoint.expiresAt) <= Date.now()) {
      throw new Error("RUNTIME_CHECKPOINT_EXPIRED");
    }
    this.#assertRuntimeCompatibility(
      {
        providerId: "opensandbox",
        sandboxId: "checkpoint-restore",
        ownerId: input.create.ownerId,
        threadId: input.create.threadId,
        branchId: input.create.branchId,
        profileId: input.create.profile.id,
        profileVersion: input.create.profile.version,
        image: input.create.profile.image,
        evidenceNonce: "checkpoint-restore",
        expiresAt: input.create.expiresAt.toISOString(),
      },
      checkpoint.compatibility,
    );
    const manager = SandboxManager.create({
      connectionConfig: this.#connection,
    });
    try {
      const current = await manager.getSnapshot(
        checkpoint.checkpoint.opaqueRef,
      );
      const expected = runtimeCheckpointBinding({
        ownerId: input.create.ownerId,
        source: checkpoint.sourceWorkspaceSnapshot,
        compatibility: checkpoint.compatibility,
        ...(checkpoint.captureIdempotencyKey
          ? { idempotencyKey: checkpoint.captureIdempotencyKey }
          : {}),
      });
      if (current.status.state !== "Ready" || current.name !== expected) {
        throw new Error("RUNTIME_CHECKPOINT_BINDING_MISMATCH");
      }
    } finally {
      await manager.close();
    }
    const sandbox = await Sandbox.create({
      connectionConfig: this.#connection,
      snapshotId: checkpoint.checkpoint.opaqueRef,
      timeoutSeconds: Math.max(
        1,
        Math.ceil((input.create.expiresAt.getTime() - Date.now()) / 1_000),
      ),
      secureAccess: true,
      metadata: this.#metadata(input.create),
      networkPolicy: networkPolicy(input.create.profile),
      resource: {
        cpu: String(input.create.profile.resources.cpuMillis / 1_000),
        memory: `${Math.ceil(input.create.profile.resources.memoryBytes / 1024 ** 2)}Mi`,
      },
    });
    this.#sandboxes.set(sandbox.id, sandbox);
    return { sandboxId: sandbox.id };
  }

  async deleteRuntimeCheckpoint(checkpoint: SandboxRuntimeCheckpointRefV1) {
    const parsed = sandboxRuntimeCheckpointRefV1Schema.parse(checkpoint);
    const manager = SandboxManager.create({
      connectionConfig: this.#connection,
    });
    try {
      const current = await manager.getSnapshot(parsed.checkpoint.opaqueRef);
      if (typeof current.name !== "string") {
        throw new Error("RUNTIME_CHECKPOINT_BINDING_MISMATCH");
      }
      const expected = runtimeCheckpointBinding({
        ownerHash: runtimeCheckpointOwnerHash(current.name),
        source: parsed.sourceWorkspaceSnapshot,
        compatibility: parsed.compatibility,
        ...(parsed.captureIdempotencyKey
          ? { idempotencyKey: parsed.captureIdempotencyKey }
          : {}),
      });
      if (current.name !== expected) {
        throw new Error("RUNTIME_CHECKPOINT_BINDING_MISMATCH");
      }
      await manager.deleteSnapshot(parsed.checkpoint.opaqueRef);
    } finally {
      await manager.close();
    }
  }

  async stop(handle: SandboxHandle): Promise<void> {
    const sandbox = await this.#sandbox(handle);
    try {
      await sandbox.pause();
    } finally {
      await sandbox.close();
      this.#sandboxes.delete(handle.sandboxId);
    }
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    const existing = this.#sandboxes.get(handle.sandboxId);
    const manager = SandboxManager.create({
      connectionConfig: this.#connection,
    });
    try {
      await manager.killSandbox(handle.sandboxId);
    } finally {
      await existing?.close().catch(() => undefined);
      this.#sandboxes.delete(handle.sandboxId);
      await manager.close();
    }
  }

  async #sandbox(handle: SandboxHandle): Promise<Sandbox> {
    const existing = this.#sandboxes.get(handle.sandboxId);
    if (existing) return existing;
    const connected = await Sandbox.connect({
      sandboxId: handle.sandboxId,
      connectionConfig: this.#connection,
    });
    this.#sandboxes.set(handle.sandboxId, connected);
    return connected;
  }

  #profile(id: string): SandboxExecutionProfile {
    const profile = this.#profiles.get(id);
    if (!profile?.enabled) {
      throw new SandboxUnavailableError(
        "PROFILE_DISABLED",
        `OpenSandbox profile ${id} is disabled.`,
      );
    }
    return profile;
  }

  #requiredImage(profile: SandboxExecutionProfile): string {
    this.#profile(profile.id);
    const uri = this.#imageUris[profile.id];
    if (!uri) {
      throw new SandboxUnavailableError(
        "CONFIGURATION_INVALID",
        `OpenSandbox image URI for ${profile.id} is unavailable.`,
      );
    }
    return uri;
  }

  #metadata(input: SandboxCreateInput): Record<string, string> {
    return {
      "avermate-owner": ownerDigest(input.ownerId),
      "avermate-thread": ownerDigest(input.threadId),
      "avermate-branch": ownerDigest(input.branchId),
      "avermate-profile": `${input.profile.id}@${input.profile.version}`,
    };
  }

  async #restoreLogicalWorkspace(
    sandbox: Sandbox,
    ref: SandboxWorkspaceSnapshotRef,
    ownerId: string,
    profile: SandboxExecutionProfile,
  ) {
    if (ref.provider !== "opensandbox" || !this.#workspaceSnapshots) {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Portable workspace snapshot storage is unavailable or incompatible.",
      );
    }
    const files = await this.#workspaceSnapshots.restore({
      ref,
      ownerId,
      maximumBytes: profile.resources.workspaceBytes,
      maximumFiles: profile.resources.fileCount,
    });
    const directories = new Set<string>([WORKSPACE]);
    for (const file of files) {
      const absolute = absoluteWorkspacePath(file.relativePath);
      const segments = absolute.split("/");
      for (let length = 3; length < segments.length; length += 1) {
        directories.add(segments.slice(0, length).join("/"));
      }
    }
    await sandbox.files.createDirectories(
      [...directories]
        .toSorted((left, right) => left.length - right.length)
        .map((path) => ({ path, mode: 0o700 })),
    );
    await sandbox.files.writeFiles(
      files.map((file) => ({
        path: absoluteWorkspacePath(file.relativePath),
        data: file.bytes,
        mode: file.mode ?? 0o600,
      })),
    );
  }

  #assertRuntimeCompatibility(
    handle: SandboxHandle,
    raw: SandboxRuntimeCheckpointCompatibilityV1,
  ) {
    const compatibility =
      sandboxRuntimeCheckpointCompatibilityV1Schema.parse(raw);
    const runtime = this.#runtimeCheckpoint;
    if (!runtime) throw new Error("RUNTIME_CHECKPOINT_UNAVAILABLE");
    if (
      handle.providerId !== "opensandbox" ||
      compatibility.provider !== "opensandbox" ||
      handle.profileId !== compatibility.profileId ||
      handle.profileVersion !== compatibility.profileVersion ||
      handle.image.imageDigest !== compatibility.imageDigest ||
      runtime.region !== compatibility.region ||
      runtime.architecture !== compatibility.architecture ||
      runtime.runtimeKind !== compatibility.runtimeKind ||
      runtime.runtimeVersion !== compatibility.runtimeVersion
    ) {
      throw new Error("RUNTIME_CHECKPOINT_COMPATIBILITY_MISMATCH");
    }
    this.#profile(handle.profileId);
    return compatibility;
  }
}

function validatedEvidenceUrl(value: string): URL {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "SANDBOX_OPENSANDBOX_EVIDENCE_URL must be an absolute URL.",
    );
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "OpenSandbox host evidence requires HTTPS, except on loopback.",
    );
  }
  if (url.username || url.password || url.hash) {
    throw new SandboxUnavailableError(
      "CONFIGURATION_INVALID",
      "OpenSandbox host evidence URL cannot contain credentials or a fragment.",
    );
  }
  return url;
}

function networkPolicy(profile: SandboxExecutionProfile) {
  if (profile.egress.mode === "none") {
    return { defaultAction: "deny" as const, egress: [] };
  }
  for (const destination of profile.egress.destinations) {
    if (
      destination.protocol !== "https" ||
      destination.port !== 443 ||
      destination.pathPrefix !== "/"
    ) {
      throw new SandboxPolicyError(
        "egress",
        "OpenSandbox network rules cannot prove path or non-standard-port restrictions.",
      );
    }
  }
  return {
    defaultAction: "deny" as const,
    egress: profile.egress.destinations.map((destination) => ({
      action: "allow" as const,
      target: destination.hostname,
    })),
  };
}

function posixQuote(value: string): string {
  if (value.includes("\0")) {
    throw new SandboxPolicyError(
      "process",
      "Command arguments cannot contain NUL.",
    );
  }
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function boundedUtf8(value: string, maxBytes: number): string {
  if (maxBytes <= 0) return "";
  const bytes = new TextEncoder().encode(value);
  if (bytes.byteLength <= maxBytes) return value;
  return new TextDecoder().decode(bytes.slice(0, maxBytes));
}

function numericExitCode(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  const value = (error as { value?: unknown }).value;
  if (typeof value !== "string" || !/^-?\d+$/u.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function absoluteWorkspacePath(relativePath: string): string {
  return `${WORKSPACE}/${relativePath}`;
}

function ownerDigest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function digest(bytes: Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function runtimeCheckpointBinding(input: {
  ownerId: string;
  source: SandboxWorkspaceSnapshotRef;
  compatibility: SandboxRuntimeCheckpointCompatibilityV1;
  idempotencyKey?: string;
}): string;
function runtimeCheckpointBinding(input: {
  ownerHash: string;
  source: SandboxWorkspaceSnapshotRef;
  compatibility: SandboxRuntimeCheckpointCompatibilityV1;
  idempotencyKey?: string;
}): string;
function runtimeCheckpointBinding(input: {
  ownerId?: string;
  ownerHash?: string;
  source: SandboxWorkspaceSnapshotRef;
  compatibility: SandboxRuntimeCheckpointCompatibilityV1;
  idempotencyKey?: string;
}) {
  const hash = input.ownerHash ?? ownerDigest(input.ownerId!).slice(0, 16);
  const binding = createHash("sha256")
    .update(
      JSON.stringify({
        source: input.source,
        compatibility: input.compatibility,
        ...(input.idempotencyKey
          ? { idempotencyKey: input.idempotencyKey }
          : {}),
      }),
    )
    .digest("hex")
    .slice(0, 32);
  return `${RUNTIME_SNAPSHOT_NAME_PREFIX}-${hash}-${binding}`;
}

function runtimeCheckpointOwnerHash(name: string) {
  const match = new RegExp(
    `^${RUNTIME_SNAPSHOT_NAME_PREFIX}-([a-f0-9]{16})-[a-f0-9]{32}$`,
    "u",
  ).exec(name);
  if (!match?.[1]) throw new Error("RUNTIME_CHECKPOINT_BINDING_MISMATCH");
  return match[1];
}

async function waitForSnapshot(
  manager: SandboxManager,
  snapshotId: string,
): Promise<Awaited<ReturnType<SandboxManager["getSnapshot"]>>> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const snapshot = await manager.getSnapshot(snapshotId);
    if (snapshot.status.state === "Ready") return snapshot;
    if (snapshot.status.state === "Failed") {
      throw new Error(
        `OpenSandbox snapshot failed: ${snapshot.status.reason ?? "unknown"}`,
      );
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    "OpenSandbox snapshot did not become ready within 30 seconds",
  );
}

function classifyPath(
  path: string,
): Pick<SandboxFileManifestEntry, "kind" | "mimeType"> {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf"))
    return { kind: "pdf", mimeType: "application/pdf" };
  if (lower.endsWith(".png")) return { kind: "png", mimeType: "image/png" };
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg"))
    return { kind: "jpeg", mimeType: "image/jpeg" };
  if (lower.endsWith(".json"))
    return { kind: "json", mimeType: "application/json" };
  if (lower.endsWith(".csv")) return { kind: "csv", mimeType: "text/csv" };
  if (lower.endsWith(".txt") || lower.endsWith(".md"))
    return { kind: "text", mimeType: "text/plain" };
  if (lower.endsWith(".pptx"))
    return {
      kind: "pptx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
  if (lower.endsWith(".mp3")) return { kind: "mp3", mimeType: "audio/mpeg" };
  if (lower.endsWith(".wav")) return { kind: "wav", mimeType: "audio/wav" };
  if (lower.endsWith(".mp4")) return { kind: "mp4", mimeType: "video/mp4" };
  if (lower.endsWith(".webp")) return { kind: "webp", mimeType: "image/webp" };
  if (lower.endsWith(".vtt")) return { kind: "vtt", mimeType: "text/vtt" };
  return { kind: "binary", mimeType: "application/octet-stream" };
}
