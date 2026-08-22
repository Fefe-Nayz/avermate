import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

const commands = [
  ["bun", "run", "verify:037:evidence-contract"],
  ["bun", "run", "verify:037:schema"],
  ["bun", "run", "verify:037:copy"],
  ["bun", "run", "verify:037:mastery"],
  ["bun", "run", "verify:037:tools"],
  ["bun", "run", "verify:037:evaluation"],
  ["bun", "run", "verify:037:web"],
  ["bun", "run", "--cwd", "apps/server", "check-types"],
] as const;

if (
  commands.some((command) =>
    command.some(
      (argument) => argument.includes(":live") || argument.includes("-live."),
    ),
  )
) {
  throw new Error("Plan 037 repository aggregate cannot execute a live gate.");
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
  "Plan 037 repository verification passed (the combined 035–038 migration and labelled live-provider evaluation remain release gates).",
);
