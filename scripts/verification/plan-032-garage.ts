import { runObjectStorageConformance } from "@avermate/agent-contracts/storage-conformance";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3ObjectStorageProvider } from "../../apps/node/src/s3-storage";
import { requireDockerDaemon, workspaceRoot } from "./plan-032-lib";

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

async function command(
  executable: string,
  args: string[],
  environment: Record<string, string> = {},
): Promise<CommandResult> {
  const child = Bun.spawn([executable, ...args], {
    cwd: workspaceRoot,
    env: { ...process.env, ...environment },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  return { exitCode, stdout: stdout.trim(), stderr: stderr.trim() };
}

function requireSuccess(result: CommandResult, label: string) {
  if (result.exitCode !== 0) {
    throw new Error(
      `PLAN032_GARAGE_COMMAND_FAILED:${label}:${result.stderr || result.stdout}`,
    );
  }
  return result.stdout;
}

await requireDockerDaemon();

const suffix = `${process.pid}-${randomBytes(4).toString("hex")}`;
const project = `plan032-garage-${suffix}`;
const container = `${project}-server`;
const root = await mkdtemp(join(tmpdir(), "avermate-plan032-garage-"));
const compose = [
  "compose",
  "-f",
  "infra/compose/avermate.yml",
  "--profile",
  "node-storage",
  "--project-name",
  project,
];
const accessKeyId = `GK${randomBytes(12).toString("hex")}`;
const secretAccessKey = randomBytes(32).toString("hex");
const garageEnvironment = {
  GARAGE_RPC_SECRET: randomBytes(32).toString("hex"),
  GARAGE_ACCESS_KEY_ID: accessKeyId,
  GARAGE_SECRET_ACCESS_KEY: secretAccessKey,
};

let primaryFailure: unknown;
try {
  console.log("\n[plan-032] start disposable Garage provider");
  requireSuccess(
    await command(
      "docker",
      [
        ...compose,
        "run",
        "--detach",
        "--name",
        container,
        "-p",
        "127.0.0.1::3900",
        "garage",
      ],
      garageEnvironment,
    ),
    "start",
  );

  let healthy = false;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const inspection = await command("docker", [
      "inspect",
      "--format",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
      container,
    ]);
    const state = inspection.stdout;
    if (inspection.exitCode === 0 && state === "healthy") {
      healthy = true;
      break;
    }
    if (state === "unhealthy" || state === "exited") {
      throw new Error(`PLAN032_GARAGE_UNHEALTHY:${state}`);
    }
    await Bun.sleep(500);
  }
  if (!healthy) throw new Error("PLAN032_GARAGE_HEALTH_TIMEOUT");

  const binding = requireSuccess(
    await command("docker", ["port", container, "3900/tcp"]),
    "port",
  )
    .split(/\r?\n/u)[0]
    ?.trim();
  if (!binding || !/^127\.0\.0\.1:\d+$/u.test(binding)) {
    throw new Error(`PLAN032_GARAGE_PORT_INVALID:${binding ?? "missing"}`);
  }

  console.log("[plan-032] run ObjectStorageProvider suite against Garage");
  const provider = new S3ObjectStorageProvider({
    id: "node-garage-conformance",
    credentials: {
      S3_ENDPOINT: `http://${binding}`,
      S3_REGION: "garage",
      S3_BUCKET: "avermate",
      S3_ACCESS_KEY_ID: accessKeyId,
      S3_SECRET_ACCESS_KEY: secretAccessKey,
    },
    journalPath: join(root, "journal.json"),
    maxObjectBytes: 1024 * 1024,
    quotaBytes: 16 * 1024 * 1024,
    transferSecret: new Uint8Array(32).fill(32),
  });
  await provider.initialize();
  const report = await runObjectStorageConformance(provider);
  if (!report.passed.includes("owner-isolation")) {
    throw new Error("PLAN032_GARAGE_OWNER_ISOLATION_NOT_PROVEN");
  }
  console.log(
    `[plan-032] Garage conformance PASS (${report.passed.join(", ")})`,
  );
} catch (error) {
  primaryFailure = error;
  const logs = await command("docker", ["logs", "--tail", "100", container]);
  if (logs.stdout) console.error(logs.stdout);
  if (logs.stderr) console.error(logs.stderr);
} finally {
  console.log("[plan-032] remove disposable Garage project and volumes");
  const cleanup = await command("docker", [
    ...compose,
    "down",
    "--volumes",
    "--remove-orphans",
  ]);
  await rm(root, { recursive: true, force: true });
  if (cleanup.exitCode !== 0 && !primaryFailure) {
    primaryFailure = new Error(
      `PLAN032_GARAGE_CLEANUP_FAILED:${cleanup.stderr || cleanup.stdout}`,
    );
  }

  const leftovers = await Promise.all([
    command("docker", [
      "ps",
      "--all",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ]),
    command("docker", [
      "volume",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ]),
    command("docker", [
      "network",
      "ls",
      "--quiet",
      "--filter",
      `label=com.docker.compose.project=${project}`,
    ]),
  ]);
  if (
    leftovers.some(
      (result) => result.exitCode !== 0 || result.stdout.trim().length > 0,
    ) &&
    !primaryFailure
  ) {
    primaryFailure = new Error("PLAN032_GARAGE_CLEANUP_INCOMPLETE");
  }
}

if (primaryFailure) throw primaryFailure;
