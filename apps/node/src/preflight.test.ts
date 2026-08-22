import { describe, expect, test } from "bun:test";
import { runHostPreflight, type HostProbe } from "./preflight";

function probe(
  input: {
    commands?: Record<string, { present: boolean; ok: boolean }>;
    free?: number;
  } = {},
): HostProbe {
  return {
    platform: () => "linux",
    arch: () => "x64",
    diskFreeBytes: async () => input.free ?? 10 * 1024 * 1024 * 1024,
    command: async (name) =>
      input.commands?.[name] ?? { present: false, ok: false },
  };
}

describe("host preflight", () => {
  test("keeps dev-zero independent from Docker and privileged runtimes", async () => {
    const result = await runHostPreflight({
      profile: "dev-zero",
      dataDir: ".",
      probe: probe(),
    });
    expect(result.ready).toBe(true);
    expect(result.checks.map((item) => item.id)).toEqual([
      "architecture",
      "disk-free",
    ]);
  });

  test("truthfully rejects creator/gpu when Docker, isolation and GPU are absent", async () => {
    const result = await runHostPreflight({
      profile: "node-local-gpu",
      dataDir: ".",
      probe: probe({ commands: { docker: { present: true, ok: false } } }),
    });
    expect(result.ready).toBe(false);
    expect(
      result.checks
        .filter((item) => item.status === "fail")
        .map((item) => item.id),
    ).toEqual(["docker-daemon", "strong-isolation-runtime", "gpu-runtime"]);
  });
});
