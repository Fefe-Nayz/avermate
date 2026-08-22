import { statfs } from "node:fs/promises";
import { nodeProfileSchema, type NodeProfile } from "./config";

export type PreflightCheck = {
  id: string;
  status: "pass" | "fail" | "warning";
  observed: string;
  remediation?: string;
};

export type HostProbe = {
  platform(): string;
  arch(): string;
  diskFreeBytes(path: string): Promise<number>;
  command(
    name: string,
    args?: string[],
  ): Promise<{ present: boolean; ok: boolean }>;
};

export const realHostProbe: HostProbe = {
  platform: () => process.platform,
  arch: () => process.arch,
  async diskFreeBytes(path) {
    const stats = await statfs(path);
    return stats.bavail * stats.bsize;
  },
  async command(name, args = ["--version"]) {
    const executable = Bun.which(name);
    if (!executable) return { present: false, ok: false };
    const process = Bun.spawn([executable, ...args], {
      stdout: "ignore",
      stderr: "ignore",
    });
    const exitCode = await process.exited;
    return { present: true, ok: exitCode === 0 };
  },
};

function check(
  id: string,
  passed: boolean,
  observed: string,
  remediation?: string,
): PreflightCheck {
  return {
    id,
    status: passed ? "pass" : "fail",
    observed,
    ...(passed || !remediation ? {} : { remediation }),
  };
}

export async function runHostPreflight(input: {
  profile: NodeProfile;
  dataDir: string;
  minimumFreeBytes?: number;
  probe?: HostProbe;
}) {
  const profile = nodeProfileSchema.parse(input.profile);
  const probe = input.probe ?? realHostProbe;
  const checks: PreflightCheck[] = [];
  const platform = probe.platform();
  const arch = probe.arch();
  checks.push(
    check(
      "architecture",
      ["x64", "arm64"].includes(arch),
      `${platform}/${arch}`,
      "Use a supported x64 or arm64 host.",
    ),
  );
  const minimum = input.minimumFreeBytes ?? 2 * 1024 * 1024 * 1024;
  const free = await probe.diskFreeBytes(input.dataDir);
  checks.push(
    check(
      "disk-free",
      free >= minimum,
      `${free} bytes free`,
      `Free at least ${minimum} bytes on the selected data volume.`,
    ),
  );

  const needsDocker = !["dev-zero", "node-lite"].includes(profile);
  if (needsDocker) {
    const docker = await probe.command("docker", [
      "info",
      "--format",
      "{{.ServerVersion}}",
    ]);
    checks.push(
      check(
        "docker-daemon",
        docker.present && docker.ok,
        docker.present
          ? docker.ok
            ? "reachable"
            : "binary present, daemon unavailable"
          : "missing",
        "Install Docker/Compose and start its daemon.",
      ),
    );
  }

  if (profile === "node-creator" || profile === "node-local-gpu") {
    const [runsc, kata] = await Promise.all([
      probe.command("runsc"),
      probe.command("kata-runtime"),
    ]);
    checks.push(
      check(
        "strong-isolation-runtime",
        (runsc.present && runsc.ok) || (kata.present && kata.ok),
        runsc.present ? "gVisor/runsc" : kata.present ? "Kata" : "missing",
        "Install and configure gVisor or Kata on the host before enabling creator jobs.",
      ),
    );
  }

  if (profile === "node-local-gpu") {
    const gpu = await probe.command("nvidia-smi", [
      "--query-gpu=name",
      "--format=csv,noheader",
    ]);
    checks.push(
      check(
        "gpu-runtime",
        gpu.present && gpu.ok,
        gpu.present
          ? gpu.ok
            ? "NVIDIA runtime reachable"
            : "driver command failed"
          : "missing",
        "Install a compatible GPU driver and container runtime.",
      ),
    );
  }

  return {
    profile,
    ready: checks.every((item) => item.status !== "fail"),
    checks,
  };
}
