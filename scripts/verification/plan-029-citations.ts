import { resolve } from "node:path";

const workspaceRoot = resolve(import.meta.dir, "../..");

async function run(label: string, argv: string[], cwd = workspaceRoot) {
  console.log(`[plan-029] ${label}`);
  const child = Bun.spawn(argv, {
    cwd,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`PLAN029_CITATION_GATE_FAILED:${label}:${exitCode}`);
  }
}

const server = resolve(workspaceRoot, "apps/server");
await run(
  "explicit claim linkage and deterministic quality thresholds",
  [
    "bun",
    "test",
    "src/assistant/citation-protocol.test.ts",
    "src/assistant/citation-quality.test.ts",
    "src/assistant/core-conversation-store.test.ts",
    "--timeout",
    "120000",
  ],
  server,
);
await run(
  "machine-readable citation quality report",
  ["bun", "src/assistant/citation-evaluation-runner.ts"],
  server,
);
await run("server typecheck", ["bun", "run", "check-types"], server);
