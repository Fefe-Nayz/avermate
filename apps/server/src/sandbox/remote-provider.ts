import {
  sandboxFileManifestEntrySchema,
  sandboxHandleSchema,
  sandboxRuntimeCheckpointCapabilitiesSchema,
  sandboxRuntimeCheckpointRefV1Schema,
  sandboxWorkspaceSnapshotRefSchema,
  type SandboxBaselineEvidence,
  type SandboxCapabilities,
  type SandboxCreateInput,
  type SandboxExecuteInput,
  type SandboxExecutionEvent,
  type SandboxExecutionProfile,
  type SandboxFileManifestEntry,
  type SandboxHandle,
  type SandboxInputFile,
  type SandboxIsolationClass,
  type SandboxPreflightInput,
  type SandboxPreflightResult,
  type SandboxProvider,
  type SandboxProviderId,
  type SandboxRuntimeCheckpointCapabilities,
  type SandboxRuntimeCheckpointCompatibilityV1,
  type SandboxRuntimeCheckpointRefV1,
  type SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { validateSandboxBaselineEvidence } from "./evidence";
import { SandboxPolicyError, SandboxUnavailableError } from "./errors";
import { assertExecutionPolicy, assertSafeRelativePath } from "./policy";

export interface RemoteSandboxTransport {
  probe(input: {
    providerId: SandboxProviderId;
    profile: SandboxExecutionProfile;
    isolationClass: SandboxIsolationClass;
    expectedHostPolicyDigest: string;
  }): Promise<SandboxBaselineEvidence>;
  create(
    input: SandboxCreateInput & {
      evidence: SandboxBaselineEvidence;
      isolationClass: SandboxIsolationClass;
    },
  ): Promise<{ sandboxId: string }>;
  execute(input: SandboxExecuteInput): AsyncIterable<SandboxExecutionEvent>;
  putFiles(
    handle: SandboxHandle,
    files: readonly SandboxInputFile[],
  ): Promise<void>;
  getFiles(
    handle: SandboxHandle,
    paths: readonly string[],
  ): Promise<readonly SandboxFileManifestEntry[]>;
  readFile(
    handle: SandboxHandle,
    relativePath: string,
  ): AsyncIterable<Uint8Array>;
  snapshotWorkspace(
    handle: SandboxHandle,
  ): Promise<SandboxWorkspaceSnapshotRef>;
  forkWorkspace(
    input: SandboxCreateInput & {
      source: SandboxWorkspaceSnapshotRef;
      evidence: SandboxBaselineEvidence;
      isolationClass: SandboxIsolationClass;
    },
  ): Promise<{ sandboxId: string }>;
  stop(handle: SandboxHandle): Promise<void>;
  destroy(handle: SandboxHandle): Promise<void>;
  runtimeCheckpointCapabilities?(): Promise<SandboxRuntimeCheckpointCapabilities>;
  captureRuntimeCheckpoint?(input: {
    handle: SandboxHandle;
    sourceWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    compatibility: SandboxRuntimeCheckpointCompatibilityV1;
    idempotencyKey: string;
    expiresAt: Date;
  }): Promise<SandboxRuntimeCheckpointRefV1>;
  restoreRuntimeCheckpoint?(input: {
    create: SandboxCreateInput;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }): Promise<{ sandboxId: string }>;
  deleteRuntimeCheckpoint?(
    checkpoint: SandboxRuntimeCheckpointRefV1,
  ): Promise<void>;
}

export interface EvidenceGatedRemoteProviderConfig {
  providerId: Exclude<SandboxProviderId, "disabled" | "mock">;
  isolationClass: SandboxIsolationClass;
  hostPolicyDigest: string;
  maxEvidenceAgeMs: number;
  profiles: readonly SandboxExecutionProfile[];
  transport?: RemoteSandboxTransport;
}

/**
 * Provider-neutral enforcement boundary. A vendor adapter is unavailable until
 * an injected transport returns fresh baseline-v1 evidence tied to the exact
 * image/profile/host policy requested here.
 */
export class EvidenceGatedRemoteSandboxProvider implements SandboxProvider {
  readonly id: SandboxProviderId;
  readonly #profiles: Map<string, SandboxExecutionProfile>;

  constructor(protected readonly config: EvidenceGatedRemoteProviderConfig) {
    this.id = config.providerId;
    this.#profiles = new Map(
      config.profiles.map((profile) => [profile.id, profile]),
    );
  }

  async capabilities(): Promise<SandboxCapabilities> {
    const profiles: SandboxCapabilities["profiles"] = [];
    for (const profile of this.#profiles.values()) {
      if (!profile.enabled) continue;
      const result = await this.preflight({
        profile,
        expectedHostPolicyDigest: this.config.hostPolicyDigest,
        maxEvidenceAgeMs: this.config.maxEvidenceAgeMs,
      });
      if (result.ok) {
        profiles.push({
          id: profile.id,
          version: profile.version,
          isolationClass: result.evidence.isolationClass,
          evidence: result.evidence,
        });
      }
    }
    return { providerId: this.id, available: profiles.length > 0, profiles };
  }

  async preflight(
    input: SandboxPreflightInput,
  ): Promise<SandboxPreflightResult> {
    const configured = this.#profiles.get(input.profile.id);
    if (
      !configured ||
      !configured.enabled ||
      configured.version !== input.profile.version ||
      configured.image.imageDigest !== input.profile.image.imageDigest
    ) {
      return {
        ok: false,
        reason: "PROFILE_DISABLED",
        message:
          "The exact execution profile and image are not enabled for this provider.",
      };
    }
    if (!this.config.transport) {
      return {
        ok: false,
        reason: "TRANSPORT_UNAVAILABLE",
        message: "No provider transport or evidence probe is configured.",
      };
    }
    if (input.expectedHostPolicyDigest !== this.config.hostPolicyDigest) {
      return {
        ok: false,
        reason: "EVIDENCE_FAILED",
        message:
          "The requested host policy does not match provider configuration.",
      };
    }
    try {
      const evidence = await this.config.transport.probe({
        providerId: this.id,
        profile: configured,
        isolationClass: this.config.isolationClass,
        expectedHostPolicyDigest: input.expectedHostPolicyDigest,
      });
      const result = validateSandboxBaselineEvidence({
        providerId: this.id,
        request: input,
        evidence,
      });
      if (
        result.ok &&
        result.evidence.isolationClass !== this.config.isolationClass
      ) {
        return {
          ok: false,
          reason: "ISOLATION_NOT_ALLOWED",
          message: "The evidence was produced by a different isolation class.",
        };
      }
      return result;
    } catch (cause) {
      return {
        ok: false,
        reason: "TRANSPORT_UNAVAILABLE",
        message:
          cause instanceof Error
            ? cause.message
            : "Provider evidence probe failed.",
      };
    }
  }

  async create(input: SandboxCreateInput): Promise<SandboxHandle> {
    this.assertLifetime(input);
    const evidence = await this.requirePreflight(input);
    const transport = this.requireTransport();
    const created = await transport.create({
      ...input,
      evidence,
      isolationClass: this.config.isolationClass,
    });
    return this.buildHandle(input, created.sandboxId, evidence);
  }

  async *execute(
    input: SandboxExecuteInput,
  ): AsyncIterable<SandboxExecutionEvent> {
    const profile = this.assertHandle(input.handle);
    assertExecutionPolicy({ ...input, profile });
    yield* this.requireTransport().execute(input);
  }

  async putFiles(
    handle: SandboxHandle,
    files: readonly SandboxInputFile[],
  ): Promise<void> {
    const profile = this.assertHandle(handle);
    let bytes = 0;
    const seen = new Set<string>();
    for (const file of files) {
      assertSafeRelativePath(file.relativePath);
      if (!file.relativePath.startsWith("input/")) {
        throw new SandboxPolicyError(
          "filesystem",
          "Uploaded inputs must stay under input/.",
        );
      }
      const folded = file.relativePath
        .normalize("NFC")
        .toLocaleLowerCase("en-US");
      if (seen.has(folded)) {
        throw new SandboxPolicyError(
          "filesystem",
          "Input paths collide after normalization.",
        );
      }
      seen.add(folded);
      const digest = `sha256:${createHash("sha256").update(file.bytes).digest("hex")}`;
      if (digest !== file.digest) {
        throw new SandboxPolicyError(
          "filesystem",
          `Input digest mismatch for ${file.relativePath}.`,
        );
      }
      bytes += file.bytes.byteLength;
    }
    if (bytes > profile.resources.workspaceBytes) {
      throw new SandboxPolicyError(
        "resource",
        "Input files exceed the workspace ceiling.",
      );
    }
    if (files.length > profile.resources.fileCount) {
      throw new SandboxPolicyError(
        "resource",
        "Input batch exceeds the file-count ceiling.",
      );
    }
    await this.requireTransport().putFiles(handle, files);
  }

  async getFiles(
    handle: SandboxHandle,
    paths: readonly string[],
  ): Promise<readonly SandboxFileManifestEntry[]> {
    const profile = this.assertHandle(handle);
    if (paths.length > profile.resources.fileCount) {
      throw new SandboxPolicyError(
        "resource",
        "Requested manifest exceeds the file-count ceiling.",
      );
    }
    paths.forEach(assertSafeRelativePath);
    const manifest = await this.requireTransport().getFiles(handle, paths);
    const parsed = manifest.map((entry) =>
      sandboxFileManifestEntrySchema.parse(entry),
    );
    const total = parsed.reduce((sum, entry) => sum + entry.byteSize, 0);
    const outputTotal = parsed
      .filter((entry) => entry.relativePath.startsWith("output/"))
      .reduce((sum, entry) => sum + entry.byteSize, 0);
    if (
      parsed.length > profile.resources.fileCount ||
      total > profile.resources.workspaceBytes ||
      outputTotal > profile.resources.outputBytes
    ) {
      throw new SandboxPolicyError(
        "resource",
        "Provider manifest exceeds profile ceilings.",
      );
    }
    return parsed;
  }

  async *readFile(
    handle: SandboxHandle,
    relativePath: string,
  ): AsyncIterable<Uint8Array> {
    const profile = this.assertHandle(handle);
    assertSafeRelativePath(relativePath);
    const ceiling = relativePath.startsWith("output/")
      ? profile.resources.outputBytes
      : profile.resources.workspaceBytes;
    let total = 0;
    for await (const chunk of this.requireTransport().readFile(
      handle,
      relativePath,
    )) {
      if (!(chunk instanceof Uint8Array)) {
        throw new SandboxPolicyError(
          "filesystem",
          "Provider returned a non-byte file chunk.",
        );
      }
      total += chunk.byteLength;
      if (total > ceiling) {
        throw new SandboxPolicyError(
          "resource",
          "Provider file stream exceeds profile ceilings.",
        );
      }
      yield chunk;
    }
  }

  async snapshotWorkspace(
    handle: SandboxHandle,
  ): Promise<SandboxWorkspaceSnapshotRef> {
    this.assertHandle(handle);
    const snapshot = sandboxWorkspaceSnapshotRefSchema.parse(
      await this.requireTransport().snapshotWorkspace(handle),
    );
    if (snapshot.provider !== this.id) {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Provider returned a snapshot owned by a different provider.",
      );
    }
    return snapshot;
  }

  async forkWorkspace(
    input: SandboxCreateInput & { source: SandboxWorkspaceSnapshotRef },
  ): Promise<SandboxHandle> {
    this.assertLifetime(input);
    if (input.source.provider !== this.id) {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Portable snapshots cannot be restored by a different provider adapter.",
      );
    }
    const evidence = await this.requirePreflight(input);
    const created = await this.requireTransport().forkWorkspace({
      ...input,
      evidence,
      isolationClass: this.config.isolationClass,
    });
    return this.buildHandle(input, created.sandboxId, evidence);
  }

  async stop(handle: SandboxHandle): Promise<void> {
    this.assertHandle(handle);
    await this.requireTransport().stop(handle);
  }

  async destroy(handle: SandboxHandle): Promise<void> {
    this.assertHandle(handle);
    await this.requireTransport().destroy(handle);
  }

  async runtimeCheckpointCapabilities(): Promise<SandboxRuntimeCheckpointCapabilities> {
    const transport = this.requireTransport();
    if (!transport.runtimeCheckpointCapabilities) {
      return { available: false, reason: "provider-unsupported" };
    }
    return sandboxRuntimeCheckpointCapabilitiesSchema.parse(
      await transport.runtimeCheckpointCapabilities(),
    );
  }

  async captureRuntimeCheckpoint(input: {
    handle: SandboxHandle;
    sourceWorkspaceSnapshot: SandboxWorkspaceSnapshotRef;
    compatibility: SandboxRuntimeCheckpointCompatibilityV1;
    idempotencyKey: string;
    expiresAt: Date;
  }): Promise<SandboxRuntimeCheckpointRefV1> {
    this.assertHandle(input.handle);
    const transport = this.requireTransport();
    if (!transport.captureRuntimeCheckpoint) {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Provider-native runtime checkpoints are unavailable.",
      );
    }
    return sandboxRuntimeCheckpointRefV1Schema.parse(
      await transport.captureRuntimeCheckpoint(input),
    );
  }

  async restoreRuntimeCheckpoint(input: {
    create: SandboxCreateInput;
    checkpoint: SandboxRuntimeCheckpointRefV1;
  }): Promise<SandboxHandle> {
    this.assertLifetime(input.create);
    const transport = this.requireTransport();
    if (!transport.restoreRuntimeCheckpoint) {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Provider-native runtime checkpoints are unavailable.",
      );
    }
    const evidence = await this.requirePreflight(input.create);
    const restored = await transport.restoreRuntimeCheckpoint(input);
    return this.buildHandle(input.create, restored.sandboxId, evidence);
  }

  async deleteRuntimeCheckpoint(
    checkpoint: SandboxRuntimeCheckpointRefV1,
  ): Promise<void> {
    const transport = this.requireTransport();
    if (!transport.deleteRuntimeCheckpoint) return;
    await transport.deleteRuntimeCheckpoint(
      sandboxRuntimeCheckpointRefV1Schema.parse(checkpoint),
    );
  }

  protected assertHandle(handle: SandboxHandle): SandboxExecutionProfile {
    const parsed = sandboxHandleSchema.parse(handle);
    const profile = this.#profiles.get(parsed.profileId);
    if (
      parsed.providerId !== this.id ||
      !profile ||
      parsed.profileVersion !== profile.version ||
      parsed.image.imageDigest !== profile.image.imageDigest
    ) {
      throw new SandboxUnavailableError(
        "SNAPSHOT_INCOMPATIBLE",
        "Sandbox handle is not bound to this provider configuration.",
      );
    }
    if (new Date(parsed.expiresAt).getTime() <= Date.now()) {
      throw new SandboxUnavailableError(
        "EVIDENCE_STALE",
        "Sandbox handle has expired.",
      );
    }
    return profile;
  }

  private async requirePreflight(input: SandboxPreflightInput) {
    const result = await this.preflight(input);
    if (!result.ok)
      throw new SandboxUnavailableError(result.reason, result.message);
    return result.evidence;
  }

  private requireTransport(): RemoteSandboxTransport {
    if (!this.config.transport) {
      throw new SandboxUnavailableError(
        "TRANSPORT_UNAVAILABLE",
        "Provider transport is not configured.",
      );
    }
    return this.config.transport;
  }

  private buildHandle(
    input: SandboxCreateInput,
    sandboxId: string,
    evidence: SandboxBaselineEvidence,
  ): SandboxHandle {
    return sandboxHandleSchema.parse({
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
  }

  private assertLifetime(input: SandboxCreateInput): void {
    const now = input.now ?? new Date();
    const lifetime = input.expiresAt.getTime() - now.getTime();
    if (
      !Number.isFinite(lifetime) ||
      lifetime <= 0 ||
      lifetime > 24 * 60 * 60_000
    ) {
      throw new SandboxPolicyError(
        "resource",
        "Sandbox lifetime must be positive and no greater than 24 hours.",
      );
    }
  }
}
