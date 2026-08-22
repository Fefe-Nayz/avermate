import { createHash, randomUUID } from "node:crypto";
import {
  sandboxHandleSchema,
  type SandboxBaselineEvidence,
  type SandboxCapabilities,
  type SandboxCreateInput,
  type SandboxExecuteInput,
  type SandboxExecutionEvent,
  type SandboxExecutionProfile,
  type SandboxFileManifestEntry,
  type SandboxHandle,
  type SandboxInputFile,
  type SandboxPreflightInput,
  type SandboxPreflightResult,
  type SandboxProvider,
  type SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { validateSandboxBaselineEvidence } from "./evidence";
import { SandboxPolicyError, SandboxUnavailableError } from "./errors";
import { assertExecutionPolicy, assertSafeRelativePath } from "./policy";

type MockSandboxState = {
  handle: SandboxHandle;
  files: Map<string, Uint8Array>;
  stopped: boolean;
};

export interface MockSandboxProviderConfig {
  allowMock: true;
  hostPolicyDigest: string;
  profiles: readonly SandboxExecutionProfile[];
  now?: () => Date;
  mutateEvidence?: (evidence: SandboxBaselineEvidence) => SandboxBaselineEvidence;
}

/**
 * Deterministic provider for unit/conformance tests. It never spawns a process
 * and must be explicitly opted into, so passing it cannot authorize production.
 */
export class MockSandboxProvider implements SandboxProvider {
  readonly id = "mock" as const;
  readonly #profiles: Map<string, SandboxExecutionProfile>;
  readonly #sandboxes = new Map<string, MockSandboxState>();
  readonly #snapshots = new Map<string, Map<string, Uint8Array>>();
  readonly #now: () => Date;

  constructor(private readonly config: MockSandboxProviderConfig) {
    this.#profiles = new Map(config.profiles.map((profile) => [profile.id, profile]));
    this.#now = config.now ?? (() => new Date());
  }

  async capabilities(): Promise<SandboxCapabilities> {
    const profiles: SandboxCapabilities["profiles"] = [];
    for (const profile of this.#profiles.values()) {
      if (!profile.enabled) continue;
      const result = await this.preflight({
        profile,
        expectedHostPolicyDigest: this.config.hostPolicyDigest,
        maxEvidenceAgeMs: 60_000,
        now: this.#now(),
      });
      if (result.ok) {
        profiles.push({
          id: profile.id,
          version: profile.version,
          isolationClass: "mock",
          evidence: result.evidence,
        });
      }
    }
    return { providerId: this.id, available: profiles.length > 0, profiles };
  }

  async preflight(input: SandboxPreflightInput): Promise<SandboxPreflightResult> {
    const profile = this.#profiles.get(input.profile.id);
    if (
      !profile ||
      !profile.enabled ||
      profile.version !== input.profile.version ||
      profile.image.imageDigest !== input.profile.image.imageDigest
    ) {
      return {
        ok: false,
        reason: "PROFILE_DISABLED",
        message: "Mock profile is disabled or differs from the configured fixture.",
      };
    }
    const checkedAt = input.now ?? this.#now();
    const evidence: SandboxBaselineEvidence = {
      baselineVersion: 1,
      providerId: "mock",
      profileId: profile.id,
      profileVersion: profile.version,
      isolationClass: "mock",
      runtimeKind: "deterministic-fixture",
      runtimeVersion: "1",
      probeVersion: "baseline-v1-fixture",
      imageDigest: profile.image.imageDigest,
      hostPolicyDigest: this.config.hostPolicyDigest,
      evidenceNonce: `mock-${profile.id}-${checkedAt.getTime()}`,
      checkedAt: checkedAt.toISOString(),
      expiresAt: new Date(checkedAt.getTime() + 60_000).toISOString(),
      checks: mockBaselineChecks(),
    };
    return validateSandboxBaselineEvidence({
      providerId: this.id,
      request: input,
      evidence: this.config.mutateEvidence?.(evidence) ?? evidence,
    });
  }

  async create(input: SandboxCreateInput): Promise<SandboxHandle> {
    const lifetime = input.expiresAt.getTime() - (input.now ?? this.#now()).getTime();
    if (!Number.isFinite(lifetime) || lifetime <= 0 || lifetime > 24 * 60 * 60_000) {
      throw new SandboxPolicyError(
        "resource",
        "Mock sandbox lifetime must be positive and no greater than 24 hours.",
      );
    }
    const evidence = await this.requirePreflight(input);
    const sandboxId = randomUUID();
    const handle = sandboxHandleSchema.parse({
      providerId: this.id,
      sandboxId,
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      profileId: input.profile.id,
      profileVersion: input.profile.version,
      image: input.profile.image,
      evidenceNonce: evidence.evidenceNonce,
      expiresAt: input.expiresAt.toISOString(),
    });
    const restored = input.workspaceSnapshotRef
      ? this.snapshotFiles(input.workspaceSnapshotRef)
      : new Map<string, Uint8Array>();
    this.#sandboxes.set(sandboxId, { handle, files: restored, stopped: false });
    return handle;
  }

  async *execute(input: SandboxExecuteInput): AsyncIterable<SandboxExecutionEvent> {
    const state = this.state(input.handle);
    const profile = this.profile(input.handle);
    assertExecutionPolicy({ ...input, profile, now: this.#now() });
    if (state.stopped) {
      throw new SandboxUnavailableError("TRANSPORT_UNAVAILABLE", "Mock sandbox is stopped.");
    }
    if (input.signal?.aborted) {
      throw input.signal.reason ?? new Error("Sandbox execution aborted.");
    }

    yield { type: "started", at: this.#now().toISOString() };
    if (input.argv[0] !== "--avermate-conformance-v1") {
      yield { type: "stderr", chunk: "unknown deterministic fixture\n", truncated: false };
      yield {
        type: "exited",
        at: this.#now().toISOString(),
        exitCode: 2,
        signal: null,
        outputBytes: 30,
      };
      return;
    }

    const payload = new TextEncoder().encode('{"mock":true,"conformance":"pass"}\n');
    state.files.set("output/conformance.json", payload);
    yield { type: "progress", current: 1, total: 1, message: "fixture completed" };
    yield { type: "stdout", chunk: "mock conformance passed\n", truncated: false };
    yield {
      type: "exited",
      at: this.#now().toISOString(),
      exitCode: 0,
      signal: null,
      outputBytes: payload.byteLength,
    };
  }

  async putFiles(handle: SandboxHandle, files: readonly SandboxInputFile[]): Promise<void> {
    const state = this.state(handle);
    const profile = this.profile(handle);
    let total = [...state.files.values()].reduce((sum, bytes) => sum + bytes.byteLength, 0);
    const seen = new Set<string>();
    for (const file of files) {
      assertSafeRelativePath(file.relativePath);
      if (!file.relativePath.startsWith("input/")) {
        throw new SandboxPolicyError("filesystem", "Uploaded inputs must stay under input/.");
      }
      const folded = file.relativePath.normalize("NFC").toLocaleLowerCase("en-US");
      if (seen.has(folded)) {
        throw new SandboxPolicyError("filesystem", "Input paths collide after normalization.");
      }
      seen.add(folded);
      const digest = digestBytes(file.bytes);
      if (digest !== file.digest) {
        throw new SandboxPolicyError("filesystem", `Input digest mismatch for ${file.relativePath}.`);
      }
      total += file.bytes.byteLength - (state.files.get(file.relativePath)?.byteLength ?? 0);
      if (total > profile.resources.workspaceBytes) {
        throw new SandboxPolicyError("resource", "Mock workspace ceiling exceeded.");
      }
      state.files.set(file.relativePath, file.bytes.slice());
      if (state.files.size > profile.resources.fileCount) {
        state.files.delete(file.relativePath);
        throw new SandboxPolicyError("resource", "Mock workspace file-count ceiling exceeded.");
      }
    }
  }

  async getFiles(
    handle: SandboxHandle,
    paths: readonly string[],
  ): Promise<readonly SandboxFileManifestEntry[]> {
    const state = this.state(handle);
    const profile = this.profile(handle);
    if (paths.length > profile.resources.fileCount) {
      throw new SandboxPolicyError("resource", "Requested manifest exceeds file-count ceiling.");
    }
    const selected = paths.length > 0 ? paths : [...state.files.keys()];
    const manifest: SandboxFileManifestEntry[] = selected.map((path) => {
      assertSafeRelativePath(path);
      const bytes = state.files.get(path);
      if (!bytes) throw new SandboxPolicyError("filesystem", `Missing mock file: ${path}`);
      const classified = classifyPath(path);
      return {
        relativePath: path,
        digest: digestBytes(bytes),
        byteSize: bytes.byteLength,
        mimeType: classified.mimeType,
        kind: classified.kind,
        nodeType: "file",
      };
    });
    const total = manifest.reduce((sum, entry) => sum + entry.byteSize, 0);
    const outputTotal = manifest
      .filter((entry) => entry.relativePath.startsWith("output/"))
      .reduce((sum, entry) => sum + entry.byteSize, 0);
    if (
      manifest.length > profile.resources.fileCount ||
      total > profile.resources.workspaceBytes ||
      outputTotal > profile.resources.outputBytes
    ) {
      throw new SandboxPolicyError("resource", "Mock manifest exceeds profile ceilings.");
    }
    return manifest;
  }

  async *readFile(handle: SandboxHandle, relativePath: string): AsyncIterable<Uint8Array> {
    assertSafeRelativePath(relativePath);
    const bytes = this.state(handle).files.get(relativePath);
    if (!bytes) throw new SandboxPolicyError("filesystem", `Missing mock file: ${relativePath}`);
    yield bytes.slice();
  }

  async snapshotWorkspace(handle: SandboxHandle): Promise<SandboxWorkspaceSnapshotRef> {
    const files = cloneFiles(this.state(handle).files);
    const digest = digestFileMap(files);
    this.#snapshots.set(digest, files);
    return { provider: "mock", digest, format: "mock-file-map-v1" };
  }

  async forkWorkspace(
    input: SandboxCreateInput & { source: SandboxWorkspaceSnapshotRef },
  ): Promise<SandboxHandle> {
    if (input.source.provider !== "mock") {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Mock provider only restores mock snapshots.",
      );
    }
    return this.create({ ...input, workspaceSnapshotRef: input.source });
  }

  async stop(handle: SandboxHandle): Promise<void> {
    this.state(handle).stopped = true;
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    this.state(handle);
    this.#sandboxes.delete(handle.sandboxId);
  }

  private profile(handle: SandboxHandle): SandboxExecutionProfile {
    const profile = this.#profiles.get(handle.profileId);
    if (!profile || profile.version !== handle.profileVersion) {
      throw new SandboxUnavailableError("PROFILE_DISABLED", "Mock handle profile is unavailable.");
    }
    return profile;
  }

  private state(handle: SandboxHandle): MockSandboxState {
    const parsed = sandboxHandleSchema.parse(handle);
    const state = this.#sandboxes.get(parsed.sandboxId);
    if (!state || parsed.providerId !== "mock" || state.handle.ownerId !== parsed.ownerId) {
      throw new SandboxUnavailableError("TRANSPORT_UNAVAILABLE", "Unknown mock sandbox handle.");
    }
    if (new Date(parsed.expiresAt).getTime() <= this.#now().getTime()) {
      throw new SandboxUnavailableError("EVIDENCE_STALE", "Mock sandbox handle expired.");
    }
    return state;
  }

  private snapshotFiles(ref: SandboxWorkspaceSnapshotRef): Map<string, Uint8Array> {
    if (ref.provider !== "mock" || ref.format !== "mock-file-map-v1") {
      throw new SandboxUnavailableError("SNAPSHOT_INCOMPATIBLE", "Unsupported mock snapshot.");
    }
    const files = this.#snapshots.get(ref.digest);
    if (!files) throw new SandboxUnavailableError("SNAPSHOT_INCOMPATIBLE", "Unknown mock snapshot.");
    return cloneFiles(files);
  }

  private async requirePreflight(input: SandboxPreflightInput) {
    const result = await this.preflight(input);
    if (!result.ok) throw new SandboxUnavailableError(result.reason, result.message);
    return result.evidence;
  }
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function cloneFiles(files: Map<string, Uint8Array>): Map<string, Uint8Array> {
  return new Map([...files].map(([path, bytes]) => [path, bytes.slice()]));
}

function digestFileMap(files: Map<string, Uint8Array>): string {
  const hash = createHash("sha256");
  for (const [path, bytes] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
    hash.update(path);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return `sha256:${hash.digest("hex")}`;
}

function classifyPath(path: string): Pick<SandboxFileManifestEntry, "kind" | "mimeType"> {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return { kind: "pdf", mimeType: "application/pdf" };
  if (lower.endsWith(".png")) return { kind: "png", mimeType: "image/png" };
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return { kind: "jpeg", mimeType: "image/jpeg" };
  }
  if (lower.endsWith(".json")) return { kind: "json", mimeType: "application/json" };
  if (lower.endsWith(".csv")) return { kind: "csv", mimeType: "text/csv" };
  if (lower.endsWith(".txt") || lower.endsWith(".md")) {
    return { kind: "text", mimeType: "text/plain" };
  }
  if (lower.endsWith(".pptx")) {
    return {
      kind: "pptx",
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    };
  }
  if (lower.endsWith(".mp3")) return { kind: "mp3", mimeType: "audio/mpeg" };
  if (lower.endsWith(".wav")) return { kind: "wav", mimeType: "audio/wav" };
  if (lower.endsWith(".mp4")) return { kind: "mp4", mimeType: "video/mp4" };
  if (lower.endsWith(".webp")) return { kind: "webp", mimeType: "image/webp" };
  if (lower.endsWith(".vtt")) return { kind: "vtt", mimeType: "text/vtt" };
  return { kind: "binary", mimeType: "application/octet-stream" };
}

function mockBaselineChecks(): SandboxBaselineEvidence["checks"] {
  const pass = () => ({ status: "pass" as const, observed: "deterministic mock assertion" });
  return {
    "non-root-unprivileged": pass(),
    "readonly-rootfs": pass(),
    "capabilities-dropped": pass(),
    "no-new-privileges": pass(),
    "host-namespaces-isolated": pass(),
    "host-mounts-sockets-devices-denied": pass(),
    "proc-sys-masked": pass(),
    "bounded-tmpfs": pass(),
    "seccomp-lsm-enforced": pass(),
    "cgroup-limits-enforced": pass(),
    "network-default-deny": pass(),
    "environment-sanitized": pass(),
  };
}
