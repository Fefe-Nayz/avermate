import { expect, test } from "bun:test";
import { join } from "node:path";

/**
 * social-policy imports the process-wide database for its atomic rate limiter.
 * Keep its pure/privacy suite in a child process so Bun's parallel workers do
 * not share the singleton in-memory libSQL connection with router migrations.
 */
test("social eligibility and privacy analytics", async () => {
  const child = Bun.spawn(
    ["bun", "test", "./src/lib/social-policy.harness.ts"],
    {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      env: { ...process.env, BUN_TEST_QUIET: "1" },
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0)
    console.error([stdout, stderr].filter(Boolean).join("\n"));
  expect(exitCode).toBe(0);
}, 30_000);
