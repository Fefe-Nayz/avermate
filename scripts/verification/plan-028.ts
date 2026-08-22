import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../..", import.meta.url));
const commands = [
  ["bun", "run", "--cwd", "apps/server", "test", "src/search"],
  [
    "bun",
    "run",
    "--cwd",
    "apps/server",
    "test",
    "src/routers/projects.test.ts",
  ],
  [
    "bun",
    "test",
    "apps/web/src/components/projects",
    "apps/web/src/components/assistant/assistant-citation-navigation.test.ts",
  ],
  ["bun", "run", "verify:029:citations"],
  ["bun", "run", "--cwd", "apps/server", "check-types"],
  ["bun", "run", "--cwd", "apps/web", "check-types"],
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
  "Plan 028 repository verification passed (live provider quality remains external under Plan 036).",
);
