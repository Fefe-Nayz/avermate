import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));

const commands = [
  ["bun", "run", "--cwd", "apps/server", "check-types"],
  ["bun", "run", "verify:036:contracts"],
  ["bun", "run", "verify:036:derivatives"],
  ["bun", "run", "verify:036:retrieval"],
  ["bun", "run", "verify:036:web"],
  ["bun", "run", "verify:036:eval"],
  ["bun", "run", "verify:029:citations"],
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
  "Plan 036 repository verification passed (live providers separate).",
);
