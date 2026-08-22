import { resolve } from "node:path";

export const workspaceRoot = resolve(import.meta.dir, "../..");

function compactDiagnostic(value: string) {
  return value.trim().replaceAll(/\s+/gu, " ").slice(0, 1_000);
}

export function classifyDockerHostFailure(stage: string, detail: string) {
  const compact = compactDiagnostic(detail) || "no diagnostic returned";
  if (stage === "docker-content-store") {
    return `PLAN032_DOCKER_HOST_CONTENT_STORE_UNHEALTHY:${stage}:${compact}`;
  }
  if (
    /input\/output error|metadata_v2\.db|containerd-overlayfs|content store|content digest|failed to (?:read|write).*blob|snapshotter/iu.test(
      compact,
    )
  ) {
    return `PLAN032_DOCKER_HOST_CONTENT_STORE_UNHEALTHY:${stage}:${compact}`;
  }
  if (
    /cannot connect|daemon is not running|connection refused|open \\.\\pipe|502 Bad Gateway|the system cannot find the file specified|Docker host probe timed out/iu.test(
      compact,
    )
  ) {
    return `PLAN032_DOCKER_HOST_DAEMON_UNAVAILABLE:${stage}:${compact}`;
  }
  return `PLAN032_DOCKER_HOST_PREFLIGHT_FAILED:${stage}:${compact}`;
}

async function captureDockerHostProbe(command: string[]) {
  const child = Bun.spawn(command, {
    cwd: workspaceRoot,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    child.kill();
  }, 20_000);
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  clearTimeout(timeout);
  return {
    exitCode,
    stdout,
    stderr: timedOut
      ? `${stderr}\nDocker host probe timed out after 20000ms`
      : stderr,
  };
}

export async function runChecked(
  label: string,
  command: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
) {
  console.log(`\n[plan-032] ${label}`);
  const child = Bun.spawn(command, {
    cwd: options.cwd ?? workspaceRoot,
    env: { ...process.env, ...options.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    if (command[0] === "docker") {
      // A Docker Desktop/containerd failure can appear between the initial
      // preflight and a Compose build. Re-probe the host so CI reports an
      // infrastructure failure instead of attributing it to Avermate.
      await requireDockerDaemon();
    }
    throw new Error(`PLAN032_COMMAND_FAILED:${label}:${exitCode}`);
  }
}

export async function runCaptured(
  label: string,
  command: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    acceptedExitCodes?: number[];
  } = {},
) {
  console.log(`\n[plan-032] ${label}`);
  const child = Bun.spawn(command, {
    cwd: options.cwd ?? workspaceRoot,
    env: { ...process.env, ...options.env },
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  const accepted = options.acceptedExitCodes ?? [0];
  if (!accepted.includes(exitCode)) {
    if (command[0] === "docker") {
      await requireDockerDaemon();
    }
    throw new Error(
      `PLAN032_COMMAND_FAILED:${label}:${exitCode}:${stderr.trim().replaceAll(/\s+/gu, " ")}`,
    );
  }
  return { exitCode, stdout, stderr };
}

export async function requireDockerDaemon() {
  if (!Bun.which("docker")) {
    throw new Error("PLAN032_DOCKER_HOST_BINARY_MISSING:docker");
  }
  const info = await captureDockerHostProbe([
    "docker",
    "info",
    "--format",
    "{{.ServerVersion}}",
  ]);
  if (info.exitCode !== 0) {
    throw new Error(
      classifyDockerHostFailure(
        "docker-info",
        `${info.stderr}\n${info.stdout}`,
      ),
    );
  }

  // `docker info` may still succeed while BuildKit/containerd's metadata or
  // blob store is corrupt. This read-only query exercises that store before
  // any Avermate image/container is touched.
  const diskUsage = await captureDockerHostProbe([
    "docker",
    "system",
    "df",
    "--format",
    "{{json .}}",
  ]);
  if (diskUsage.exitCode !== 0) {
    throw new Error(
      classifyDockerHostFailure(
        "docker-content-store",
        `${diskUsage.stderr}\n${diskUsage.stdout}`,
      ),
    );
  }
}

export async function composeConfig(profile: string) {
  await runChecked(`compose config ${profile}`, [
    "docker",
    "compose",
    "-f",
    "infra/compose/avermate.yml",
    "--profile",
    profile,
    "config",
    "--quiet",
  ]);
}
