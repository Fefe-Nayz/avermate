import { describe, expect, test } from "bun:test";
import { DisabledSandboxProvider } from "./disabled-provider";
import { runSandboxConformance } from "./conformance";
import { MockSandboxProvider } from "./mock-provider";
import { enableSandboxProfile, SANDBOX_PROFILES_V1 } from "./profiles";

const hostPolicyDigest = `sha256:${"f".repeat(64)}`;
const now = new Date("2026-08-22T12:00:00.000Z");

describe("sandbox conformance matrix", () => {
  test("disabled provider passes only as explicitly unavailable", async () => {
    const report = await runSandboxConformance({
      provider: new DisabledSandboxProvider(),
      profiles: Object.values(SANDBOX_PROFILES_V1),
      hostPolicyDigest: null,
      now,
    });
    expect(report.passed).toBe(true);
    expect(report.cells).toHaveLength(
      Object.values(SANDBOX_PROFILES_V1).length,
    );
    expect(report.cells.every((cell) => cell.status === "unavailable")).toBe(
      true,
    );
    expect(
      report.cells
        .filter(
          (cell) =>
            cell.profileId === "opencode" || cell.profileId === "openhands",
        )
        .map((cell) => [cell.profileId, cell.status]),
    ).toEqual([
      ["opencode", "unavailable"],
      ["openhands", "unavailable"],
    ]);
  });

  test("disabled and mock providers never satisfy required live profiles", async () => {
    const disabled = await runSandboxConformance({
      provider: new DisabledSandboxProvider(),
      profiles: Object.values(SANDBOX_PROFILES_V1),
      hostPolicyDigest: null,
      requireAvailable: true,
      requiredProfileIds: ["browser", "media"],
      now,
    });
    expect(disabled.passed).toBe(false);

    const profiles = Object.values(SANDBOX_PROFILES_V1).map((profile, index) =>
      enableSandboxProfile(profile.id, {
        version: "mock-v1",
        imageDigest: `sha256:${(index + 1).toString(16).repeat(64)}`,
      }),
    );
    const mock = await runSandboxConformance({
      provider: new MockSandboxProvider({
        allowMock: true,
        hostPolicyDigest,
        profiles,
        now: () => now,
      }),
      profiles,
      hostPolicyDigest,
      requireAvailable: true,
      requiredProfileIds: ["browser", "media"],
      mockEvidence: true,
      now,
    });
    expect(mock.passed).toBe(false);
  });

  test("mock exercises every profile but is labeled non-production evidence", async () => {
    const profiles = Object.values(SANDBOX_PROFILES_V1).map((profile, index) =>
      enableSandboxProfile(profile.id, {
        version: "mock-v1",
        imageDigest: `sha256:${(index + 1).toString(16).repeat(64)}`,
      }),
    );
    const provider = new MockSandboxProvider({
      allowMock: true,
      hostPolicyDigest,
      profiles,
      now: () => now,
    });
    const report = await runSandboxConformance({
      provider,
      profiles,
      hostPolicyDigest,
      requireAvailable: true,
      mockEvidence: true,
      now,
    });
    expect(report.passed).toBe(true);
    expect(report.mockEvidence).toBe(true);
    expect(report.cells.every((cell) => cell.status === "pass")).toBe(true);
  });
});
