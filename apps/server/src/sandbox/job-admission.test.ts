import { describe, expect, test } from "bun:test";
import type {
  JobRuntime,
  JobRuntimeEvent,
  JobRuntimeRecord,
} from "../jobs/job-runtime";
import { DisabledSandboxProvider } from "./disabled-provider";
import { SandboxJobAdmission, type SandboxJobPayloadV1 } from "./job-admission";
import { MockSandboxProvider } from "./mock-provider";
import { enableSandboxProfile } from "./profiles";
import { SANDBOX_WORKER_DEFINITIONS } from "./worker-definitions";

const hostPolicyDigest = `sha256:${"f".repeat(64)}`;
const profile = enableSandboxProfile("latex", {
  version: "admission-test-v1",
  imageDigest: `sha256:${"a".repeat(64)}`,
});
const now = new Date("2026-08-22T12:00:00.000Z");
const latexWorker = SANDBOX_WORKER_DEFINITIONS["latex-build.v1"];

function runtime(onEnqueue: (payload: SandboxJobPayloadV1) => void): JobRuntime {
  const record: JobRuntimeRecord = {
    id: "job-1",
    ownerId: "owner",
    kind: "sandbox.execute",
    status: "queued",
    stage: "queued",
    payloadVersion: 1,
    attempts: 0,
    maxAttempts: 3,
    cancellation: "none",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  return {
    async enqueue(input) {
      // SAFETY: this fixture is exclusively passed SandboxJobAdmission payloads.
      onEnqueue(input.payload as SandboxJobPayloadV1);
      return record;
    },
    async inspect() {
      return record;
    },
    async publish() {
      throw new Error("not used");
    },
    async replay() {
      return [];
    },
    events(): AsyncIterable<JobRuntimeEvent> {
      return {
        [Symbol.asyncIterator]: () => ({
          next: async () => ({ done: true, value: undefined }),
        }),
      };
    },
    async assertResultAdoptionFence() {},
    async cancel() {
      return record;
    },
  };
}

describe("sandbox job admission", () => {
  test("does not enqueue when the provider lacks evidence", async () => {
    let calls = 0;
    const admission = new SandboxJobAdmission(
      new DisabledSandboxProvider(),
      runtime(() => {
        calls += 1;
      }),
      { hostPolicyDigest, maxEvidenceAgeMs: 60_000 },
    );
    expect(
      admission.enqueue({
        workerId: latexWorker.id,
        ownerId: "owner",
        threadId: "thread",
        branchId: "branch",
        profile,
        inputManifestRef: "object:manifest",
        executable: latexWorker.executable,
        argv: latexWorker.argv,
        idempotencyKey: "request-1",
        now,
      }),
    ).rejects.toMatchObject({ reason: "PROVIDER_DISABLED" });
    expect(calls).toBe(0);
  });

  test("enqueues a bounded evidence-bound payload after preflight", async () => {
    let payload: SandboxJobPayloadV1 | null = null;
    const provider = new MockSandboxProvider({
      allowMock: true,
      hostPolicyDigest,
      profiles: [profile],
      now: () => now,
    });
    const admission = new SandboxJobAdmission(
      provider,
      runtime((value) => {
        payload = value;
      }),
      { hostPolicyDigest, maxEvidenceAgeMs: 60_000 },
    );
    await admission.enqueue({
      workerId: latexWorker.id,
      ownerId: "owner",
      threadId: "thread",
      branchId: "branch",
      profile,
      inputManifestRef: "object:manifest",
      executable: latexWorker.executable,
      argv: latexWorker.argv,
      resources: { wallTimeMs: 30_000 },
      idempotencyKey: "request-1",
      now,
    });
    expect(payload).toMatchObject({
      schemaVersion: 1,
      workerId: "latex-build.v1",
      profileId: "latex",
      profileVersion: profile.version,
      imageDigest: profile.image.imageDigest,
      hostPolicyDigest,
    });
    expect(payload).not.toHaveProperty("environment");
  });
});
