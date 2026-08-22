import { expect, test } from "bun:test";
import { join } from "node:path";

/**
 * The server exports a process-wide libSQL client. Run the protocol suite in
 * its own process so Bun's parallel test workers cannot close or migrate the
 * database underneath unrelated router suites.
 */
test("MCP protocol, OAuth and destructive-flow conformance", async () => {
  const child = Bun.spawn(
    ["bun", "test", "./src/mcp/protocol.harness.ts", "--timeout=30000"],
    {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      // The legacy protocol suite continues to verify historical domain route
      // semantics. Production MCP execution is guarded separately and defaults
      // closed for every mutation not yet migrated to the action ledger.
      env: {
        ...process.env,
        BUN_TEST_QUIET: "1",
      },
    },
  );
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  if (exitCode !== 0) {
    console.error([stdout, stderr].filter(Boolean).join("\n"));
  }
  expect(exitCode).toBe(0);
}, 120_000);
