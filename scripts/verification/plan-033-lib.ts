import { resolve } from "node:path";

export const workspaceRoot = resolve(import.meta.dir, "../..");

export async function run033(
  label: string,
  command: string[],
  options: { cwd?: string } = {},
) {
  console.log(`\n[plan-033] ${label}`);
  const child = Bun.spawn(command, {
    cwd: options.cwd ?? workspaceRoot,
    env: process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`PLAN033_COMMAND_FAILED:${label}:${exitCode}`);
  }
}

