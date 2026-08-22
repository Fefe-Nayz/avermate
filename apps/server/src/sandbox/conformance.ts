import {
  SANDBOX_BASELINE_CHECK_IDS,
  SANDBOX_PROFILE_IDS,
  sandboxCapabilitiesSchema,
  sandboxConformanceReportSchema,
  type SandboxCapabilities,
  type SandboxConformanceCell,
  type SandboxConformanceReport,
  type SandboxExecutionEvent,
  type SandboxExecutionProfile,
  type SandboxProfileId,
  type SandboxProvider,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { authorizeSandboxEgress } from "./policy";

type CellCheck = SandboxConformanceCell["checks"][number];

export async function runSandboxConformance(input: {
  provider: SandboxProvider;
  profiles: readonly SandboxExecutionProfile[];
  hostPolicyDigest: string | null;
  requireAvailable?: boolean;
  requiredProfileIds?: readonly SandboxProfileId[];
  mockEvidence?: boolean;
  now?: Date;
}): Promise<SandboxConformanceReport> {
  const now = input.now ?? new Date();
  const capabilities = sandboxCapabilitiesSchema.parse(
    await input.provider.capabilities(),
  );
  if (capabilities.providerId !== input.provider.id) {
    throw new Error(
      "Sandbox capability report identifies a different provider.",
    );
  }
  const profileMap = new Map(
    input.profiles.map((profile) => [profile.id, profile]),
  );
  const cells: SandboxConformanceCell[] = [];

  for (const profileId of SANDBOX_PROFILE_IDS) {
    const profile = profileMap.get(profileId);
    if (!profile) {
      cells.push({
        providerId: input.provider.id,
        profileId,
        status: "fail",
        isolationClass: null,
        baselineVersion: null,
        runtimeKind: null,
        runtimeVersion: null,
        imageDigest: null,
        hostPolicyDigest: null,
        evidenceNonce: null,
        checkedAt: null,
        checks: [
          {
            id: "profile-catalogue",
            status: "fail",
            detail: "Profile is missing.",
          },
        ],
      });
      continue;
    }
    if (!profile.enabled || input.provider.id === "disabled") {
      const advertised = capabilities.profiles.find(
        (candidate) => candidate.id === profileId,
      );
      const preflight = await input.provider.preflight({
        profile,
        expectedHostPolicyDigest:
          input.hostPolicyDigest ?? `sha256:${"0".repeat(64)}`,
        maxEvidenceAgeMs: 60_000,
        now,
      });
      cells.push({
        providerId: input.provider.id,
        profileId,
        status: advertised ? "fail" : "unavailable",
        isolationClass: advertised?.isolationClass ?? null,
        baselineVersion: null,
        runtimeKind: null,
        runtimeVersion: null,
        imageDigest: null,
        hostPolicyDigest: null,
        evidenceNonce: null,
        checkedAt: null,
        checks: [
          {
            id: "fail-closed-unavailable",
            status: preflight.ok || advertised ? "fail" : "pass",
            detail:
              preflight.ok || advertised
                ? "Disabled profile unexpectedly advertised evidence or capability."
                : `Unavailable as required: ${preflight.reason}.`,
          },
        ],
      });
      continue;
    }
    cells.push(
      await runEnabledCell({
        provider: input.provider,
        profile,
        hostPolicyDigest: input.hostPolicyDigest,
        now,
        advertised: capabilities.profiles.find(
          (candidate) => candidate.id === profileId,
        ),
      }),
    );
  }

  const enabledCells = cells.filter((cell) => cell.status !== "unavailable");
  const requiredProfileIds = new Set(input.requiredProfileIds ?? []);
  const requiredProfilesPassed = [...requiredProfileIds].every(
    (profileId) =>
      cells.find((cell) => cell.profileId === profileId)?.status === "pass",
  );
  const liveEvidenceRequired = requiredProfileIds.size > 0;
  const passed =
    cells.every((cell) => cell.status !== "fail") &&
    (!input.requireAvailable ||
      enabledCells.some((cell) => cell.status === "pass")) &&
    requiredProfilesPassed &&
    (!liveEvidenceRequired ||
      (input.provider.id !== "disabled" &&
        input.provider.id !== "mock" &&
        !input.mockEvidence));
  return sandboxConformanceReportSchema.parse({
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    providerId: input.provider.id,
    mockEvidence: input.mockEvidence ?? false,
    passed,
    cells,
  });
}

async function runEnabledCell(input: {
  provider: SandboxProvider;
  profile: SandboxExecutionProfile;
  hostPolicyDigest: string | null;
  now: Date;
  advertised: SandboxCapabilities["profiles"][number] | undefined;
}): Promise<SandboxConformanceCell> {
  const checks: CellCheck[] = [];
  const hostPolicyDigest = input.hostPolicyDigest ?? `sha256:${"0".repeat(64)}`;
  const preflight = await input.provider.preflight({
    profile: input.profile,
    expectedHostPolicyDigest: hostPolicyDigest,
    maxEvidenceAgeMs: 60_000,
    now: input.provider.id === "mock" ? input.now : undefined,
  });
  if (!preflight.ok) {
    return {
      providerId: input.provider.id,
      profileId: input.profile.id,
      status: "fail",
      isolationClass: null,
      baselineVersion: null,
      runtimeKind: null,
      runtimeVersion: null,
      imageDigest: null,
      hostPolicyDigest: null,
      evidenceNonce: null,
      checkedAt: null,
      checks: [
        { id: "baseline-preflight", status: "fail", detail: preflight.message },
      ],
    };
  }
  for (const checkId of SANDBOX_BASELINE_CHECK_IDS) {
    const result = preflight.evidence.checks[checkId];
    checks.push({
      id: checkId,
      status: result.status,
      detail: result.observed,
    });
  }
  checks.push({
    id: "capability-reporting",
    status:
      input.advertised &&
      input.advertised.version === input.profile.version &&
      input.advertised.isolationClass === preflight.evidence.isolationClass
        ? "pass"
        : "fail",
    detail: input.advertised
      ? "Capability report matches the enabled profile and isolation class."
      : "Preflight passed but capabilities() did not advertise this profile.",
  });

  let source: Awaited<ReturnType<SandboxProvider["create"]>> | null = null;
  let fork: Awaited<ReturnType<SandboxProvider["create"]>> | null = null;
  let cancelled: Awaited<ReturnType<SandboxProvider["create"]>> | null = null;
  try {
    source = await input.provider.create({
      profile: input.profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now: input.provider.id === "mock" ? input.now : undefined,
      ownerId: "conformance-owner",
      threadId: "conformance-thread",
      branchId: "conformance-source",
      expiresAt: new Date(input.now.getTime() + 60_000),
    });
    checks.push({
      id: "create",
      status: "pass",
      detail: "Evidence-bound sandbox created.",
    });

    const inputBytes = new TextEncoder().encode("sandbox-conformance");
    await input.provider.putFiles(source, [
      {
        relativePath: "input/probe.txt",
        bytes: inputBytes,
        digest: digestBytes(inputBytes),
        mimeType: "text/plain",
      },
    ]);
    const events = await collect(
      input.provider.execute({
        handle: source,
        executable: input.profile.entrypoints[0],
        argv: ["--avermate-conformance-v1"],
        cwd: "/workspace/",
        environment: { HOME: "/workspace", LANG: "C.UTF-8" },
        resources: {
          wallTimeMs: Math.min(30_000, input.profile.resources.wallTimeMs),
        },
      }),
    );
    const exit = events.findLast((event) => event.type === "exited");
    checks.push({
      id: "structured-execution",
      status: exit?.type === "exited" && exit.exitCode === 0 ? "pass" : "fail",
      detail:
        "Entrypoint executed through executable+argv without a shell string.",
    });
    const outputs = await input.provider.getFiles(source, [
      "output/conformance.json",
    ]);
    checks.push({
      id: "bounded-output-manifest",
      status:
        outputs.length === 1 && outputs[0].nodeType === "file"
          ? "pass"
          : "fail",
      detail: "Provider returned one regular output with digest and size.",
    });

    checks.push(
      await expectedDenial("entrypoint-allowlist", async () => {
        await collect(
          input.provider.execute({
            handle: source!,
            executable: "/bin/sh",
            argv: ["-c", "id"],
          }),
        );
      }),
      await expectedDenial("environment-sanitization-boundary", async () => {
        await collect(
          input.provider.execute({
            handle: source!,
            executable: input.profile.entrypoints[0],
            argv: ["--avermate-conformance-v1"],
            environment: { DATABASE_URL: "must-not-cross" },
          }),
        );
      }),
      await expectedDenial("resource-ceiling", async () => {
        await collect(
          input.provider.execute({
            handle: source!,
            executable: input.profile.entrypoints[0],
            argv: ["--avermate-conformance-v1"],
            resources: { memoryBytes: input.profile.resources.memoryBytes + 1 },
          }),
        );
      }),
      await expectedDenial("workspace-containment", () =>
        input.provider.putFiles(source!, [
          {
            relativePath: "../escape",
            bytes: new Uint8Array(),
            digest: digestBytes(new Uint8Array()),
            mimeType: "application/octet-stream",
          },
        ]),
      ),
      await expectedDenial("private-egress-denial", async () => {
        authorizeSandboxEgress({
          policy: {
            mode: "allowlist",
            destinations: [
              {
                protocol: "https",
                hostname: "example.com",
                port: 443,
                pathPrefix: "/",
              },
            ],
            maxRequests: 1,
            maxResponseBytes: 1_024,
          },
          url: "https://example.com/",
          resolvedAddresses: ["169.254.169.254"],
        });
      }),
    );

    const snapshot = await input.provider.snapshotWorkspace(source);
    fork = await input.provider.forkWorkspace({
      source: snapshot,
      profile: input.profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now: input.provider.id === "mock" ? input.now : undefined,
      ownerId: "conformance-owner",
      threadId: "conformance-thread",
      branchId: "conformance-fork",
      expiresAt: new Date(input.now.getTime() + 60_000),
    });
    const inherited = await input.provider.getFiles(fork, ["input/probe.txt"]);
    const forkOnly = new TextEncoder().encode("fork-only");
    await input.provider.putFiles(fork, [
      {
        relativePath: "input/fork-only.txt",
        bytes: forkOnly,
        digest: digestBytes(forkOnly),
        mimeType: "text/plain",
      },
    ]);
    const sourceIsolation = await expectedDenial("fork-divergence", () =>
      input.provider
        .getFiles(source!, ["input/fork-only.txt"])
        .then(() => undefined),
    );
    checks.push({
      id: "snapshot-portability",
      status: inherited.length === 1 ? "pass" : "fail",
      detail: "Fork inherited the selected workspace snapshot.",
    });
    checks.push(sourceIsolation);

    cancelled = await input.provider.create({
      profile: input.profile,
      expectedHostPolicyDigest: hostPolicyDigest,
      maxEvidenceAgeMs: 60_000,
      now: input.provider.id === "mock" ? input.now : undefined,
      ownerId: "conformance-owner",
      threadId: "conformance-thread",
      branchId: "conformance-cancellation",
      expiresAt: new Date(input.now.getTime() + 60_000),
    });
    await input.provider.stop(cancelled);
    checks.push(
      await expectedDenial("deterministic-stop", async () => {
        await collect(
          input.provider.execute({
            handle: cancelled!,
            executable: input.profile.entrypoints[0],
            argv: ["--avermate-conformance-v1"],
          }),
        );
      }),
    );
    await input.provider.destroy(cancelled);
    checks.push(
      await expectedDenial("forced-cleanup", () =>
        input.provider.getFiles(cancelled!, []).then(() => undefined),
      ),
    );
    cancelled = null;
  } catch (cause) {
    checks.push({
      id: "provider-lifecycle",
      status: "fail",
      detail:
        cause instanceof Error ? cause.message : "Provider lifecycle failed.",
    });
  } finally {
    if (cancelled)
      await input.provider.destroy(cancelled).catch(() => undefined);
    if (fork) await input.provider.destroy(fork).catch(() => undefined);
    if (source) await input.provider.destroy(source).catch(() => undefined);
  }

  return {
    providerId: input.provider.id,
    profileId: input.profile.id,
    status: checks.every(
      (check) => check.status === "pass" || check.status === "not-applicable",
    )
      ? "pass"
      : "fail",
    isolationClass: preflight.evidence.isolationClass,
    baselineVersion: preflight.evidence.baselineVersion,
    runtimeKind: preflight.evidence.runtimeKind,
    runtimeVersion: preflight.evidence.runtimeVersion,
    imageDigest: preflight.evidence.imageDigest,
    hostPolicyDigest: preflight.evidence.hostPolicyDigest,
    evidenceNonce: preflight.evidence.evidenceNonce,
    checkedAt: preflight.evidence.checkedAt,
    checks,
  };
}

async function expectedDenial(
  id: string,
  operation: () => Promise<void>,
): Promise<CellCheck> {
  try {
    await operation();
    return {
      id,
      status: "fail",
      detail: "Unsafe operation was unexpectedly accepted.",
    };
  } catch {
    return {
      id,
      status: "pass",
      detail: "Unsafe operation was rejected before execution.",
    };
  }
}

async function collect(events: AsyncIterable<SandboxExecutionEvent>) {
  const collected: SandboxExecutionEvent[] = [];
  for await (const event of events) collected.push(event);
  return collected;
}

function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}
