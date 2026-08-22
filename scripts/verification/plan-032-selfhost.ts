import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nodeProfileSchema } from "../../apps/node/src/config";
import { runHostPreflight } from "../../apps/node/src/preflight";
import {
  assertSelfHostSourceIsolation,
  smokeNodeProfile,
  withFullSelfHost,
} from "./plan-032-compose-runtime";
import { composeConfig, requireDockerDaemon } from "./plan-032-lib";

const profiles = [
  "dev-zero",
  "node-lite",
  "node-storage",
  "node-creator",
  "node-local-gpu",
  "node-observable",
  "full-self-host",
] as const;
await assertSelfHostSourceIsolation();
for (const profile of profiles) await composeConfig(profile);

if (process.argv.includes("--static-only")) {
  console.warn(
    "[plan-032] static-only requested: Compose runtime smoke is NOT proven.",
  );
  process.exit(0);
}

await requireDockerDaemon();

await smokeNodeProfile("dev-zero");
await smokeNodeProfile("node-lite");

const secretRoot = await mkdtemp(join(tmpdir(), "avermate-node-storage-"));
try {
  const accessKeyId = `GK${randomBytes(12).toString("hex")}`;
  const secretAccessKey = randomBytes(32).toString("hex");
  const secretPath = join(secretRoot, "garage-s3.env");
  await writeFile(
    secretPath,
    [
      "S3_ENDPOINT=http://garage:3900",
      "S3_REGION=garage",
      "S3_BUCKET=avermate",
      `S3_ACCESS_KEY_ID=${accessKeyId}`,
      `S3_SECRET_ACCESS_KEY=${secretAccessKey}`,
      "",
    ].join("\n"),
    { mode: 0o600, flag: "wx" },
  );
  await smokeNodeProfile("node-storage", {
    env: {
      GARAGE_RPC_SECRET: randomBytes(32).toString("hex"),
      GARAGE_ACCESS_KEY_ID: accessKeyId,
      GARAGE_SECRET_ACCESS_KEY: secretAccessKey,
      GARAGE_S3_SECRET_FILE: secretPath.replaceAll("\\", "/"),
    },
  });
} finally {
  await rm(secretRoot, { recursive: true, force: true });
}

const hardwareBoundProfiles = ["node-creator", "node-local-gpu"] as const;
for (const name of hardwareBoundProfiles) {
  const profile = nodeProfileSchema.parse(name);
  const preflight = await runHostPreflight({ profile, dataDir: "." });
  if (!preflight.ready) {
    const failures = preflight.checks.filter(
      (check) => check.status === "fail",
    );
    const allowedNotApplicable =
      failures.length > 0 &&
      failures.every((check) =>
        ["strong-isolation-runtime", "gpu-runtime"].includes(check.id),
      );
    if (!allowedNotApplicable) {
      throw new Error(
        `PLAN032_PROFILE_PREFLIGHT_FAILED:${name}:${JSON.stringify(failures)}`,
      );
    }
    console.log(
      `[plan-032] ${name} N/A on this host (capability preflight): ${JSON.stringify(failures)}`,
    );
    continue;
  }
  await smokeNodeProfile(name);
}

// The observable profile currently advertises no telemetry capability and its
// health response keeps unsupported providers explicit. The runtime profile is
// still required to boot; this is not evidence that telemetry is implemented.
await smokeNodeProfile("node-observable");

await withFullSelfHost({ label: "full-self-host" });

console.log("[plan-032] all applicable Compose profiles are runtime-proven");
