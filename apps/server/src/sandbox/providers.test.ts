import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import {
  SANDBOX_BASELINE_CHECK_IDS,
  type SandboxBaselineEvidence,
} from "@avermate/agent-contracts";
import { DisabledSandboxProvider } from "./disabled-provider";
import { E2BSandboxProvider } from "./e2b-provider";
import { SandboxPolicyError, SandboxUnavailableError } from "./errors";
import { MockSandboxProvider } from "./mock-provider";
import { authorizeSandboxEgress, sanitizeSandboxEnvironment } from "./policy";
import { enableSandboxProfile } from "./profiles";
import type { RemoteSandboxTransport } from "./remote-provider";

const hostPolicyDigest = `sha256:${"f".repeat(64)}`;
const imageDigest = `sha256:${"a".repeat(64)}`;
const profile = enableSandboxProfile("latex", {
  version: "test-v1",
  imageDigest,
});
const fixedNow = new Date("2026-08-22T12:00:00.000Z");

describe("sandbox providers", () => {
  test("disabled provider fails closed", async () => {
    const provider = new DisabledSandboxProvider();
    expect(await provider.capabilities()).toEqual({
      providerId: "disabled",
      available: false,
      profiles: [],
    });
    const preflight = await provider.preflight({
      profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now: fixedNow,
    });
    expect(preflight).toMatchObject({ ok: false, reason: "PROVIDER_DISABLED" });
    expect(
      provider.create({
        profile,
        expectedHostPolicyDigest: hostPolicyDigest,
        maxEvidenceAgeMs: 60_000,
        now: fixedNow,
        ownerId: "owner",
        threadId: "thread",
        branchId: "branch",
        expiresAt: new Date(fixedNow.getTime() + 60_000),
      }),
    ).rejects.toBeInstanceOf(SandboxUnavailableError);
  });

  test("mock provider proves every check and snapshots diverge after fork", async () => {
    const provider = new MockSandboxProvider({
      allowMock: true,
      hostPolicyDigest,
      profiles: [profile],
      now: () => fixedNow,
    });
    const preflight = await provider.preflight({
      profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now: fixedNow,
    });
    expect(preflight.ok).toBe(true);
    if (!preflight.ok) throw new Error("mock preflight failed");
    expect(
      SANDBOX_BASELINE_CHECK_IDS.every(
        (id) => preflight.evidence.checks[id].status === "pass",
      ),
    ).toBe(true);

    const create = (branchId: string) =>
      provider.create({
        profile,
        expectedHostPolicyDigest: hostPolicyDigest,
        maxEvidenceAgeMs: 60_000,
        now: fixedNow,
        ownerId: "owner",
        threadId: "thread",
        branchId,
        expiresAt: new Date(fixedNow.getTime() + 60_000),
      });
    const source = await create("source");
    const original = new TextEncoder().encode("original");
    await provider.putFiles(source, [
      {
        relativePath: "input/original.txt",
        bytes: original,
        digest: sha256(original),
        mimeType: "text/plain",
      },
    ]);
    const snapshot = await provider.snapshotWorkspace(source);
    const fork = await provider.forkWorkspace({
      source: snapshot,
      profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now: fixedNow,
      ownerId: "owner",
      threadId: "thread",
      branchId: "fork",
      expiresAt: new Date(fixedNow.getTime() + 60_000),
    });
    expect(await provider.getFiles(fork, ["input/original.txt"])).toHaveLength(1);
    const forkOnly = new TextEncoder().encode("fork");
    await provider.putFiles(fork, [
      {
        relativePath: "input/fork.txt",
        bytes: forkOnly,
        digest: sha256(forkOnly),
        mimeType: "text/plain",
      },
    ]);
    expect(provider.getFiles(source, ["input/fork.txt"])).rejects.toThrow("Missing mock file");
  });

  test("unknown, stale, and mismatched evidence never enables a profile", async () => {
    const base = new MockSandboxProvider({
      allowMock: true,
      hostPolicyDigest,
      profiles: [profile],
      now: () => fixedNow,
      mutateEvidence(evidence) {
        return {
          ...evidence,
          checks: {
            ...evidence.checks,
            "readonly-rootfs": { status: "unknown", observed: "probe unavailable" },
          },
        } satisfies SandboxBaselineEvidence;
      },
    });
    expect(
      await base.preflight({
        profile,
        expectedHostPolicyDigest: hostPolicyDigest,
        maxEvidenceAgeMs: 60_000,
        now: fixedNow,
      }),
    ).toMatchObject({ ok: false, reason: "EVIDENCE_FAILED" });
    expect(await base.capabilities()).toMatchObject({ available: false, profiles: [] });
    expect(
      base.create({
        profile,
        expectedHostPolicyDigest: hostPolicyDigest,
        maxEvidenceAgeMs: 60_000,
        now: fixedNow,
        ownerId: "owner",
        threadId: "thread",
        branchId: "branch",
        expiresAt: new Date(fixedNow.getTime() + 60_000),
      }),
    ).rejects.toMatchObject({ reason: "EVIDENCE_FAILED" });
    expect(
      await base.preflight({
        profile,
        expectedHostPolicyDigest: `sha256:${"e".repeat(64)}`,
        maxEvidenceAgeMs: 60_000,
        now: fixedNow,
      }),
    ).toMatchObject({ ok: false });

    const stale = new MockSandboxProvider({
      allowMock: true,
      hostPolicyDigest,
      profiles: [profile],
      now: () => fixedNow,
      mutateEvidence(evidence) {
        return {
          ...evidence,
          checkedAt: new Date(fixedNow.getTime() - 120_000).toISOString(),
        };
      },
    });
    expect(
      await stale.preflight({
        profile,
        expectedHostPolicyDigest: hostPolicyDigest,
        maxEvidenceAgeMs: 60_000,
        now: fixedNow,
      }),
    ).toMatchObject({ ok: false, reason: "EVIDENCE_STALE" });

    const changedImage = {
      ...profile,
      image: { ...profile.image, imageDigest: `sha256:${"d".repeat(64)}` },
    };
    expect(
      await stale.preflight({
        profile: changedImage,
        expectedHostPolicyDigest: hostPolicyDigest,
        maxEvidenceAgeMs: 60_000,
        now: fixedNow,
      }),
    ).toMatchObject({ ok: false, reason: "PROFILE_DISABLED" });
  });

  test("real adapter remains unavailable without a probe transport", async () => {
    const provider = new E2BSandboxProvider({
      hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      profiles: [profile],
    });
    expect(await provider.capabilities()).toMatchObject({ available: false, profiles: [] });
    expect(
      await provider.preflight({
        profile,
        expectedHostPolicyDigest: hostPolicyDigest,
        maxEvidenceAgeMs: 60_000,
        now: fixedNow,
      }),
    ).toMatchObject({ ok: false, reason: "TRANSPORT_UNAVAILABLE" });
  });

  test("remote adapter binds a transport fixture to exact live evidence", async () => {
    const remoteNow = new Date();
    const evidence = fixtureEvidence(remoteNow);
    const transport: RemoteSandboxTransport = {
      async probe() {
        return evidence;
      },
      async create() {
        return { sandboxId: "e2b-fixture-sandbox" };
      },
      async *execute() {
        yield { type: "started", at: fixedNow.toISOString() };
        yield {
          type: "exited",
          at: fixedNow.toISOString(),
          exitCode: 0,
          signal: null,
          outputBytes: 0,
        };
      },
      async putFiles() {},
      async getFiles() {
        return [];
      },
      async *readFile() {
        yield new Uint8Array();
      },
      async snapshotWorkspace() {
        return {
          provider: "e2b",
          digest: `sha256:${"b".repeat(64)}`,
          format: "fixture-v1",
        };
      },
      async forkWorkspace() {
        return { sandboxId: "e2b-fixture-fork" };
      },
      async stop() {},
      async destroy() {},
    };
    const provider = new E2BSandboxProvider({
      hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      profiles: [profile],
      transport,
    });
    expect(await provider.capabilities()).toMatchObject({
      available: true,
      profiles: [{ id: "latex", isolationClass: "e2b-managed" }],
    });
    const handle = await provider.create({
      profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now: remoteNow,
      ownerId: "owner",
      threadId: "thread",
      branchId: "branch",
      expiresAt: new Date(remoteNow.getTime() + 60_000),
    });
    expect(handle).toMatchObject({
      providerId: "e2b",
      sandboxId: "e2b-fixture-sandbox",
      evidenceNonce: evidence.evidenceNonce,
    });
    const denied = async () => {
      for await (const _event of provider.execute({
        handle,
        executable: "/bin/sh",
        argv: ["-c", "id"],
      })) {
        // consume
      }
    };
    expect(denied()).rejects.toThrow("entrypoint");
  });
});

describe("sandbox boundary policy", () => {
  test("never inherits secret environment variables", () => {
    expect(sanitizeSandboxEnvironment({ HOME: "/workspace", LANG: "C.UTF-8" })).toEqual({
      HOME: "/workspace",
      LANG: "C.UTF-8",
    });
    expect(() => sanitizeSandboxEnvironment({ DATABASE_URL: "secret" })).toThrow(
      SandboxPolicyError,
    );
  });

  test("blocks metadata/private resolutions and cross-origin redirects", () => {
    const policy = {
      mode: "allowlist" as const,
      destinations: [
        { protocol: "https" as const, hostname: "example.com", port: 443, pathPrefix: "/api/" },
      ],
      maxRequests: 10,
      maxResponseBytes: 1_024,
    };
    expect(() =>
      authorizeSandboxEgress({
        policy,
        url: "https://example.com/api/value",
        resolvedAddresses: ["169.254.169.254"],
      }),
    ).toThrow(SandboxPolicyError);
    expect(
      authorizeSandboxEgress({
        policy,
        url: "https://example.com/api/value",
        resolvedAddresses: ["93.184.216.34"],
      }).hostname,
    ).toBe("example.com");
    for (const address of [
      "0:0:0:0:0:ffff:5db8:d822",
      "64:ff9b::a00:1",
      "fc00::1",
      "2001:db8::1",
    ]) {
      expect(() =>
        authorizeSandboxEgress({
          policy,
          url: "https://example.com/api/value",
          resolvedAddresses: [address],
        }),
      ).toThrow(SandboxPolicyError);
    }
    expect(
      authorizeSandboxEgress({
        policy,
        url: "https://example.com/api/value",
        resolvedAddresses: ["2606:4700:4700::1111"],
      }).hostname,
    ).toBe("example.com");
  });
});

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fixtureEvidence(now = fixedNow): SandboxBaselineEvidence {
  const pass = () => ({ status: "pass" as const, observed: "test-only remote fixture" });
  return {
    baselineVersion: 1,
    providerId: "e2b",
    profileId: "latex",
    profileVersion: profile.version,
    isolationClass: "e2b-managed",
    runtimeKind: "test-only-transport-fixture",
    runtimeVersion: "1",
    probeVersion: "1",
    imageDigest,
    hostPolicyDigest,
    evidenceNonce: "test-only-evidence",
    checkedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + 60_000).toISOString(),
    checks: {
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
    },
  };
}
