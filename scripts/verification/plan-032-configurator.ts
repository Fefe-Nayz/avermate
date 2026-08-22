import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runChecked, workspaceRoot } from "./plan-032-lib";

await runChecked(
  "configurator attacks, schema and preflight",
  [
    "bun",
    "test",
    "src/config.test.ts",
    "src/configurator.test.ts",
    "src/preflight.test.ts",
  ],
  { cwd: resolve(workspaceRoot, "apps/node") },
);
await runChecked(
  "regenerate public config schema",
  ["bun", "scripts/write-config-schema.ts"],
  {
    cwd: resolve(workspaceRoot, "apps/node"),
  },
);

const root = await mkdtemp(join(tmpdir(), "avermate-node-smoke-"));
const port = 52_000 + Math.floor(Math.random() * 1_000);
const configPath = join(root, "node.json");
await writeFile(
  configPath,
  JSON.stringify({
    version: 1,
    profile: "dev-zero",
    bind: { host: "127.0.0.1", port },
    dataDir: join(root, "data"),
    storage: {
      driver: "filesystem",
      filesystemRoot: join(root, "objects"),
      maxObjectBytes: 1024 * 1024,
      quotaBytes: 8 * 1024 * 1024,
    },
    relay: {},
    models: { enabled: false, providerSecretRefs: [] },
    sandbox: { enabled: false, provider: "disabled" },
    telemetry: { enabled: false },
  }),
);
const child = Bun.spawn(["bun", "src/index.ts"], {
  cwd: resolve(workspaceRoot, "apps/node"),
  env: { ...process.env, AVERMATE_NODE_CONFIG: configPath },
  stdout: "pipe",
  stderr: "pipe",
});
try {
  let response: Response | null = null;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) break;
    } catch {
      await Bun.sleep(50);
    }
  }
  if (!response?.ok) throw new Error("PLAN032_DEV_ZERO_HEALTH_FAILED");
  const health = (await response.json()) as {
    protocol?: string;
    profile?: string;
    manifest?: { features?: { storage?: unknown } };
  };
  if (
    health.protocol !== "avermate-node/2" ||
    health.profile !== "dev-zero" ||
    !health.manifest?.features?.storage
  ) {
    throw new Error("PLAN032_DEV_ZERO_MANIFEST_INVALID");
  }
  console.log("[plan-032] dev-zero process smoke PASS (filesystem, no Garage)");
} finally {
  child.kill();
  await child.exited.catch(() => undefined);
  await rm(root, { recursive: true, force: true });
}
