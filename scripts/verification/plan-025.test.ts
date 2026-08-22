import { describe, expect, test } from "bun:test";
import os from "node:os";
import path from "node:path";

import {
  assertSafeTemporaryTarget,
  parseVerificationMode,
  REQUIRED_GATE_IDS,
  runEmptyDatabaseMigration,
} from "./plan-025";

describe("plan 025 verification contract", () => {
  test("keeps every required gate in fail-closed execution order", () => {
    expect(REQUIRED_GATE_IDS).toEqual([
      "release-guard",
      "format-check",
      "lint",
      "lint-slop",
      "check-types",
      "test",
      "build",
      "migration-empty-database",
      "migration-history-checksums",
      "migration-empty-contract",
      "migration-prefix-upgrades",
      "migration-legacy-upgrade",
    ]);
  });

  test("accepts only the explicit workspace and clean-clone modes", () => {
    expect(parseVerificationMode([])).toBe("workspace");
    expect(parseVerificationMode(["--clean-clone"])).toBe("clean-clone");
    expect(parseVerificationMode(["--inside-clean-clone"])).toBe(
      "inside-clean-clone",
    );
    expect(() => parseVerificationMode(["--skip", "test"])).toThrow();
    expect(() => parseVerificationMode(["--clean-clone", "--skip"])).toThrow();
  });

  test("allows cleanup only for one exact prefixed child of the temp root", () => {
    const prefix = "avermate-plan-025-test-";
    const safe = path.join(os.tmpdir(), `${prefix}012345`);
    expect(() => assertSafeTemporaryTarget(safe, prefix)).not.toThrow();
    expect(() => assertSafeTemporaryTarget(os.tmpdir(), prefix)).toThrow();
    expect(() =>
      assertSafeTemporaryTarget(path.join(os.tmpdir(), "unrelated"), prefix),
    ).toThrow();
    expect(() =>
      assertSafeTemporaryTarget(
        path.join(os.tmpdir(), `${prefix}012345`, "nested"),
        prefix,
      ),
    ).toThrow();
    expect(() =>
      assertSafeTemporaryTarget(
        path.resolve(os.tmpdir(), "..", `${prefix}escape`),
        prefix,
      ),
    ).toThrow();
  });

  test("migrates and inspects a real isolated empty database", async () => {
    const repoRoot = path.resolve(import.meta.dir, "..", "..");
    await runEmptyDatabaseMigration({
      repoRoot,
      runCommand: async ({ argv, cwd, env }) => {
        const child = Bun.spawn(argv, {
          cwd,
          env: env ?? process.env,
          stdin: "ignore",
          stdout: "pipe",
          stderr: "pipe",
        });
        const [, , exitCode] = await Promise.all([
          new Response(child.stdout).arrayBuffer(),
          new Response(child.stderr).arrayBuffer(),
          child.exited,
        ]);
        expect(exitCode).toBe(0);
      },
    });
  }, 30_000);
});
