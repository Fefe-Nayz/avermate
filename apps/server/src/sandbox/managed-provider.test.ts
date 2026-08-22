import { describe, expect, test } from "bun:test";
import {
  SANDBOX_BASELINE_CHECK_IDS,
  type SandboxBaselineEvidence,
  type SandboxCreateInput,
  type SandboxExecutionEvent,
  type SandboxHandle,
  type SandboxProvider,
} from "@avermate/agent-contracts";
import { capabilityMap } from "../entitlements/capabilities";
import { EntitlementService } from "../entitlements/service";
import {
  closeManagedTestDatabase,
  createManagedTestDatabase,
} from "../managed/managed-test-db";
import { UsageLedger } from "../usage/ledger";
import { ManagedSandboxProvider } from "./managed-provider";
import { SANDBOX_PROFILES_V1 } from "./profiles";

const now = new Date("2026-08-22T12:00:00.000Z");
const policyDigest = `sha256:${"a".repeat(64)}`;
const profile = {
  ...SANDBOX_PROFILES_V1.latex,
  version: "managed-test-v1",
  enabled: true,
  image: {
    ...SANDBOX_PROFILES_V1.latex.image,
    profileVersion: "managed-test-v1",
  },
};

function evidence(): SandboxBaselineEvidence {
  return {
    baselineVersion: 1,
    providerId: "e2b",
    profileId: profile.id,
    profileVersion: profile.version,
    isolationClass: "e2b-managed",
    runtimeKind: "fixture-microvm",
    runtimeVersion: "1",
    probeVersion: "fixture/1",
    imageDigest: profile.image.imageDigest,
    hostPolicyDigest: policyDigest,
    evidenceNonce: "managed-evidence-1",
    checkedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    checks: Object.fromEntries(
      SANDBOX_BASELINE_CHECK_IDS.map((id) => [
        id,
        { status: "pass", observed: "fixture isolation assertion" },
      ]),
    ) as SandboxBaselineEvidence["checks"],
  };
}

class ManagedFixtureProvider implements SandboxProvider {
  readonly id = "e2b" as const;
  executeCalls = 0;

  async capabilities() {
    return {
      providerId: this.id,
      available: true,
      profiles: [
        {
          id: profile.id,
          version: profile.version,
          isolationClass: "e2b-managed" as const,
          evidence: evidence(),
        },
      ],
    };
  }

  async preflight() {
    return { ok: true as const, evidence: evidence() };
  }

  async create(input: SandboxCreateInput): Promise<SandboxHandle> {
    return {
      providerId: this.id,
      sandboxId: "managed-sandbox-1",
      ownerId: input.ownerId,
      threadId: input.threadId,
      branchId: input.branchId,
      profileId: input.profile.id,
      profileVersion: input.profile.version,
      image: input.profile.image,
      evidenceNonce: evidence().evidenceNonce,
      expiresAt: input.expiresAt.toISOString(),
    };
  }

  async *execute(): AsyncIterable<SandboxExecutionEvent> {
    this.executeCalls += 1;
    yield { type: "started", at: now.toISOString() };
    yield {
      type: "exited",
      at: now.toISOString(),
      exitCode: 0,
      signal: null,
      outputBytes: 0,
    };
  }

  async putFiles() {}
  async getFiles() {
    return [];
  }
  async *readFile(): AsyncIterable<Uint8Array> {}
  async snapshotWorkspace() {
    return {
      provider: this.id,
      digest: `sha256:${"b".repeat(64)}`,
      format: "fixture-v1",
    };
  }
  forkWorkspace(input: SandboxCreateInput) {
    return this.create(input);
  }
  async stop() {}
  async destroy() {}
}

function createInput(operationId?: string): SandboxCreateInput {
  return {
    operationId,
    ownerId: "account-a",
    threadId: "thread-a",
    branchId: "branch-a",
    profile,
    expectedHostPolicyDigest: policyDigest,
    maxEvidenceAgeMs: 60_000,
    now,
    expiresAt: new Date(now.getTime() + 60_000),
  };
}

describe.serial("managed sandbox isolation and accounting gate", () => {
  test("requires strong observed isolation and a durable operation id", async () => {
    const client = await createManagedTestDatabase();
    try {
      const entitlement = new EntitlementService(client, {
        mode: "shadow",
        clock: () => now,
        cacheTtlMs: 0,
      });
      const ledger = new UsageLedger(client, entitlement, { clock: () => now });
      const delegate = new ManagedFixtureProvider();
      const managed = new ManagedSandboxProvider(
        delegate,
        ledger,
        "managed-sandbox-eu",
        () => now,
      );
      await expect(managed.create(createInput())).rejects.toThrow(
        "MANAGED_OPERATION_ID_REQUIRED",
      );

      const weakDelegate = {
        ...delegate,
        id: "e2b" as const,
        preflight: async () => ({
          ok: true as const,
          evidence: { ...evidence(), isolationClass: "runc-trusted-dev" as const },
        }),
      } as unknown as SandboxProvider;
      const weak = new ManagedSandboxProvider(
        weakDelegate,
        ledger,
        "managed-sandbox-eu",
        () => now,
      );
      expect(await weak.preflight(createInput("weak-operation"))).toMatchObject({
        ok: false,
        reason: "ISOLATION_NOT_ALLOWED",
      });
      await expect(weak.create(createInput("weak-operation"))).rejects.toThrow(
        "MANAGED_SANDBOX_DISABLED:ISOLATION_NOT_ALLOWED",
      );
    } finally {
      await closeManagedTestDatabase(client);
    }
  });

  test("reserves all resource dimensions, blocks raw secrets and enforces tenant handles", async () => {
    const client = await createManagedTestDatabase();
    try {
      const entitlement = new EntitlementService(client, {
        mode: "enforce",
        clock: () => now,
        cacheTtlMs: 0,
      });
      await entitlement.publishSnapshot(
        {
          version: 1,
          id: "sandbox-snapshot",
          accountId: "account-a",
          revision: "sandbox/1",
          plan: "test",
          status: "active",
          period: {
            startsAt: "2026-08-01T00:00:00.000Z",
            endsAt: "2026-09-01T00:00:00.000Z",
          },
          capabilities: capabilityMap((_capability, unit) => ({
            enabled: true,
            unit,
            hardLimit: "999999999999999",
            concurrency: 100,
          })),
          source: "operator",
          issuedAt: now.toISOString(),
        },
        {
          actorId: "test-admin",
          justification: "fixture",
          correlationId: "sandbox-snapshot",
        },
      );
      const ledger = new UsageLedger(client, entitlement, { clock: () => now });
      const delegate = new ManagedFixtureProvider();
      const managed = new ManagedSandboxProvider(
        delegate,
        ledger,
        "managed-sandbox-eu",
        () => now,
      );
      const handle = await managed.create(createInput("sandbox-operation-1"));
      const reservations = await client.execute(
        "SELECT capability, status FROM usage_reservations ORDER BY capability",
      );
      expect(reservations.rows.map((row) => row.capability)).toEqual([
        "sandbox.cpuMillis",
        "sandbox.egressBytes",
        "sandbox.memoryByteSeconds",
      ]);

      const secretExecution = managed.execute({
        handle,
        executable: "/opt/avermate/bin/latex-build",
        argv: [],
        environment: { MISTRAL_API_KEY: "must-not-enter-the-sandbox" },
      });
      await expect(secretExecution[Symbol.asyncIterator]().next()).rejects.toThrow(
        "RAW_SECRET_ENVIRONMENT_FORBIDDEN",
      );
      expect(delegate.executeCalls).toBe(0);

      const foreign = { ...handle, ownerId: "account-b" };
      expect(() => managed.getFiles(foreign, [])).toThrow(
        "SANDBOX_TENANT_MISMATCH",
      );
      await managed.settle(handle, {
        cpuMillis: "500",
        memoryByteSeconds: "1000",
        egressBytes: "0",
        authoritative: true,
        outcome: "completed",
      });
      const settled = await client.execute(
        "SELECT status FROM usage_reservations",
      );
      expect(settled.rows.every((row) => row.status === "settled")).toBe(true);
    } finally {
      await closeManagedTestDatabase(client);
    }
  });
});
