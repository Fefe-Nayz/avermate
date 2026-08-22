import type {
  SandboxExecutionProfile,
  SandboxProvider,
  SandboxResourceLimits,
  SandboxWorkspaceSnapshotRef,
} from "@avermate/agent-contracts";
import { sandboxWorkspaceSnapshotRefSchema } from "@avermate/agent-contracts";
import type { JobRuntime, JobRuntimeRecord } from "../jobs/job-runtime";
import { SandboxUnavailableError } from "./errors";
import { assertExecutionPolicy } from "./policy";
import {
  resolveSandboxWorkerDefinition,
  type SandboxWorkerId,
} from "./worker-definitions";

export interface SandboxJobPayloadV1 {
  readonly schemaVersion: 1;
  readonly workerId: SandboxWorkerId;
  readonly ownerId: string;
  readonly threadId: string;
  readonly branchId: string;
  readonly inputManifestRef: string;
  readonly workspaceSnapshotRef: SandboxWorkspaceSnapshotRef | null;
  readonly profileId: SandboxExecutionProfile["id"];
  readonly profileVersion: string;
  readonly imageDigest: string;
  readonly hostPolicyDigest: string;
  readonly baselineEvidenceNonce: string;
  readonly executable: string;
  readonly argv: readonly string[];
  readonly resources: Partial<SandboxResourceLimits>;
}

/**
 * Scheduler-side gate: no sandbox job reaches the durable queue until the
 * exact provider/profile/image/host policy has fresh complete evidence.
 * `provider.create` repeats the same check in the worker.
 */
export class SandboxJobAdmission {
  constructor(
    private readonly provider: SandboxProvider,
    private readonly jobs: JobRuntime,
    private readonly config: {
      hostPolicyDigest: string;
      maxEvidenceAgeMs: number;
    },
  ) {}

  async enqueue(input: {
    workerId: SandboxWorkerId;
    ownerId: string;
    threadId: string;
    branchId: string;
    profile: SandboxExecutionProfile;
    inputManifestRef: string;
    workspaceSnapshotRef?: SandboxWorkspaceSnapshotRef;
    executable: string;
    argv: readonly string[];
    resources?: Partial<SandboxResourceLimits>;
    idempotencyKey: string;
    now?: Date;
  }): Promise<JobRuntimeRecord> {
    resolveSandboxWorkerDefinition({
      workerId: input.workerId,
      profileId: input.profile.id,
      executable: input.executable,
      argv: input.argv,
    });
    assertExecutionPolicy({
      profile: input.profile,
      executable: input.executable,
      argv: input.argv,
      resources: input.resources,
    });
    const manifestRef = input.inputManifestRef.trim();
    if (!manifestRef || manifestRef.length > 1_024) {
      throw new Error("A bounded immutable input manifest reference is required.");
    }
    for (const [name, value] of Object.entries({
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      idempotencyKey: input.idempotencyKey,
    })) {
      if (!value.trim() || value.length > 256) throw new Error(`${name} is invalid.`);
    }
    const workspaceSnapshotRef = input.workspaceSnapshotRef
      ? sandboxWorkspaceSnapshotRefSchema.parse(input.workspaceSnapshotRef)
      : null;
    const preflight = await this.provider.preflight({
      profile: input.profile,
      expectedHostPolicyDigest: this.config.hostPolicyDigest,
      maxEvidenceAgeMs: this.config.maxEvidenceAgeMs,
      now: input.now,
    });
    if (!preflight.ok) {
      throw new SandboxUnavailableError(preflight.reason, preflight.message);
    }
    const payload: SandboxJobPayloadV1 = Object.freeze({
      schemaVersion: 1,
      workerId: input.workerId,
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      inputManifestRef: manifestRef,
      workspaceSnapshotRef: workspaceSnapshotRef
        ? Object.freeze(workspaceSnapshotRef)
        : null,
      profileId: input.profile.id,
      profileVersion: input.profile.version,
      imageDigest: input.profile.image.imageDigest,
      hostPolicyDigest: preflight.evidence.hostPolicyDigest,
      baselineEvidenceNonce: preflight.evidence.evidenceNonce,
      executable: input.executable,
      argv: Object.freeze([...input.argv]),
      resources: Object.freeze({ ...input.resources }),
    });
    return this.jobs.enqueue({
      ownerId: input.ownerId,
      kind: "sandbox.execute",
      payload,
      payloadVersion: 1,
      idempotencyKey: input.idempotencyKey,
      maxAttempts: 3,
    });
  }
}
