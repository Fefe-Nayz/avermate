import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

const commands = [
  ["bun", "run", "verify:039:evidence-contract"],
  ["bun", "run", "--cwd", "apps/server", "check-types"],
  [
    "bun",
    "run",
    "--cwd",
    "apps/server",
    "test",
    "src/managed/beta-control-plane.test.ts",
    "src/billing/shadow-billing.test.ts",
    "src/billing/test-mode-adapter.test.ts",
  ],
  ["bun", "run", "verify:039:web"],
  ["bun", "scripts/verification/plan-039-operations.ts"],
] as const;

for (const command of commands) {
  const result = Bun.spawnSync(command, {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
    env: process.env,
  });
  if (result.exitCode !== 0) process.exit(result.exitCode);
}

console.log(
  "Plan 039 repository verification passed. Production checkout remains disabled; run verify:039:launch separately with exact deployed evidence.",
);
