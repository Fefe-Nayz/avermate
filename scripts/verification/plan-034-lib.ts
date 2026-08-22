import { resolve } from "node:path";

export const workspaceRoot = resolve(import.meta.dir, "../..");

export async function run034(
  label: string,
  command: string[],
  options: { cwd?: string; env?: Record<string, string> } = {},
) {
  console.log(`\n[plan-034] ${label}`);
  const child = Bun.spawn(command, {
    cwd: options.cwd ?? workspaceRoot,
    env: { ...process.env, ...options.env },
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`PLAN034_COMMAND_FAILED:${label}:${exitCode}`);
  }
}
