import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const commands = [
  ["bun", "run", "verify:038:evidence-contract"],
  ["bun", "run", "verify:038:static"],
  ["bun", "run", "verify:032:protocol"],
  ["bun", "run", "verify:032:storage:contracts"],
  ["bun", "run", "verify:032:configurator"],
  ["bun", "run", "verify:038:contracts"],
  ["bun", "run", "verify:038:node"],
  ["bun", "run", "verify:038:workers"],
  ["bun", "run", "verify:038:server"],
  ["bun", "run", "verify:038:migrations"],
  ["bun", "run", "verify:038:placement-media"],
  ["bun", "run", "verify:038:web"],
  ["bun", "run", "--cwd", "packages/agent-contracts", "check-types"],
  ["bun", "run", "--cwd", "apps/node", "check-types"],
  ["bun", "run", "--cwd", "apps/sandbox-worker", "check-types"],
  ["bun", "run", "--cwd", "apps/server", "check-types"],
] as const;

if (
  commands.some((command) =>
    command.some(
      (argument) => argument.includes(":live") || argument.includes("-live."),
    ),
  )
) {
  throw new Error("Plan 038 repository aggregate cannot execute a live gate.");
}

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
  "Plan 038 repository gates passed. `verify:038:live` remains a separate mandatory release gate and never degrades to mocks.",
);
