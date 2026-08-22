import { describe, expect, test } from "bun:test";
import type { SandboxBaselineEvidence } from "@avermate/agent-contracts";
import { enableSandboxProfile } from "./profiles";
import { OpenSandboxSdkTransport } from "./opensandbox-sdk-transport";

const imageDigest = `sha256:${"a".repeat(64)}` as const;
const hostPolicyDigest = `sha256:${"b".repeat(64)}` as const;
const profile = enableSandboxProfile("latex", {
  version: "reviewed-v1",
  imageDigest,
});

function evidence(): SandboxBaselineEvidence {
  const pass = { status: "pass" as const, observed: "host probe assertion" };
  return {
    baselineVersion: 1,
    providerId: "opensandbox",
    profileId: "latex",
    profileVersion: profile.version,
    isolationClass: "runc-trusted-dev",
    runtimeKind: "docker-runc",
    runtimeVersion: "29.1.2",
    probeVersion: "avermate-host-probe-v1",
    imageDigest,
    hostPolicyDigest,
    evidenceNonce: "host-probe-fixture",
    checkedAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    checks: {
      "non-root-unprivileged": pass,
      "readonly-rootfs": pass,
      "capabilities-dropped": pass,
      "no-new-privileges": pass,
      "host-namespaces-isolated": pass,
      "host-mounts-sockets-devices-denied": pass,
      "proc-sys-masked": pass,
      "bounded-tmpfs": pass,
      "seccomp-lsm-enforced": pass,
      "cgroup-limits-enforced": pass,
      "network-default-deny": pass,
      "environment-sanitized": pass,
    },
  };
}

describe("official OpenSandbox SDK transport", () => {
  test("binds host evidence requests to the exact provider/profile/image/policy tuple", async () => {
    let requestBody: unknown = null;
    let authorization = "";
    const transport = new OpenSandboxSdkTransport({
      connection: { domain: "localhost:8080", protocol: "http" },
      evidenceUrl: "http://127.0.0.1:8081/v1/evidence",
      evidenceToken: "fixture-token",
      imageUris: { latex: `avermate/latex@${imageDigest}` },
      profiles: [profile],
      fetch: (async (
        _request: Parameters<typeof fetch>[0],
        init?: Parameters<typeof fetch>[1],
      ) => {
        requestBody = JSON.parse(String(init?.body));
        authorization = new Headers(init?.headers).get("authorization") ?? "";
        return Response.json(evidence());
      }) as unknown as typeof fetch,
    });
    const result = await transport.probe({
      providerId: "opensandbox",
      profile,
      isolationClass: "runc-trusted-dev",
      expectedHostPolicyDigest: hostPolicyDigest,
    });
    expect(result.evidenceNonce).toBe("host-probe-fixture");
    expect(authorization).toBe("Bearer fixture-token");
    expect(requestBody).toEqual({
      baselineVersion: 1,
      providerId: "opensandbox",
      profileId: "latex",
      profileVersion: "reviewed-v1",
      imageDigest,
      isolationClass: "runc-trusted-dev",
      hostPolicyDigest,
    });
  });

  test("rejects unpinned image aliases and non-TLS remote evidence", () => {
    expect(
      () =>
        new OpenSandboxSdkTransport({
          connection: { domain: "localhost:8080", protocol: "http" },
          evidenceUrl: "http://probe.example.test/v1/evidence",
          imageUris: { latex: "avermate/latex:latest" },
          profiles: [profile],
        }),
    ).toThrow("requires HTTPS");
    expect(
      () =>
        new OpenSandboxSdkTransport({
          connection: { domain: "localhost:8080", protocol: "http" },
          evidenceUrl: "http://127.0.0.1:8081/v1/evidence",
          imageUris: { latex: "avermate/latex:latest" },
          profiles: [profile],
        }),
    ).toThrow("reviewed digest");
  });
});
