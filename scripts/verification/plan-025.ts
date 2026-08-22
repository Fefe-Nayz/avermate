import { Database } from "bun:sqlite";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

type VerificationMode = "workspace" | "clean-clone" | "inside-clean-clone";

interface CommandSpec {
  argv: string[];
  cwd: string;
  env?: Record<string, string | undefined>;
}

interface GateContext {
  repoRoot: string;
  runCommand: (spec: CommandSpec) => Promise<void>;
}

interface VerificationGate {
  id: string;
  run: (context: GateContext) => Promise<void>;
}

const TEMPORARY_DATABASE_PREFIX = "avermate-plan-025-db-";
const CLEAN_CLONE_PREFIX = "avermate-plan-025-clone-";
const REQUIRED_TABLES = [
  "__drizzle_migrations",
  "oauth_client_resources",
  "oauth_resources",
  "users",
  "years",
] as const;

const commandGate = (id: string, argv: string[]): VerificationGate => ({
  id,
  run: ({ repoRoot, runCommand }) => runCommand({ argv, cwd: repoRoot }),
});

export const REQUIRED_GATE_IDS = [
  "release-guard",
  "dependency-audit",
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
] as const;

const STATIC_GATES: VerificationGate[] = [
  commandGate("release-guard", ["bun", "run", "release:guard"]),
  commandGate("dependency-audit", ["bun", "run", "security:audit"]),
  commandGate("format-check", ["bun", "run", "format:check"]),
  commandGate("lint", ["bun", "run", "lint"]),
  commandGate("lint-slop", ["bun", "run", "lint:slop"]),
  commandGate("check-types", ["bun", "run", "check-types"]),
  commandGate("test", ["bun", "run", "test"]),
  commandGate("build", ["bun", "run", "build"]),
];

function describeCommand(argv: string[]): string {
  return argv
    .map((part) => (part.includes(" ") ? JSON.stringify(part) : part))
    .join(" ");
}

async function runCheckedCommand(spec: CommandSpec): Promise<void> {
  console.log(`\n> ${describeCommand(spec.argv)}`);
  const child = Bun.spawn(spec.argv, {
    cwd: spec.cwd,
    env: spec.env ?? process.env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Command failed with exit code ${exitCode}.`);
  }
}

async function captureCheckedCommand(
  argv: string[],
  cwd: string,
): Promise<string> {
  const child = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, , exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).arrayBuffer(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`Required command failed: ${describeCommand(argv)}.`);
  }
  return stdout.trim();
}

async function resolveRepositoryRoot(cwd: string): Promise<string> {
  const root = await captureCheckedCommand(
    ["git", "rev-parse", "--show-toplevel"],
    cwd,
  );
  if (!root) throw new Error("Git returned an empty repository root.");
  return path.resolve(root);
}

export function parseVerificationMode(argv: string[]): VerificationMode {
  if (argv.length === 0) return "workspace";
  if (argv.length === 1 && argv[0] === "--clean-clone") return "clean-clone";
  if (argv.length === 1 && argv[0] === "--inside-clean-clone") {
    return "inside-clean-clone";
  }
  throw new Error(
    "Usage: bun scripts/verification/plan-025.ts [--clean-clone|--inside-clean-clone]",
  );
}

/**
 * Recursive cleanup is allowed only for a directory made directly under the
 * operating-system temporary root with the gate's exact prefix.
 */
export function assertSafeTemporaryTarget(
  target: string,
  prefix: string,
  temporaryRoot = os.tmpdir(),
): void {
  const resolvedRoot = path.resolve(temporaryRoot);
  const resolvedTarget = path.resolve(target);
  const relative = path.relative(resolvedRoot, resolvedTarget);
  if (
    !relative ||
    path.isAbsolute(relative) ||
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    relative.includes(path.sep) ||
    !path.basename(resolvedTarget).startsWith(prefix)
  ) {
    throw new Error("Refusing unsafe recursive temporary-directory cleanup.");
  }
}

async function removeTemporaryDirectory(
  target: string,
  prefix: string,
): Promise<void> {
  assertSafeTemporaryTarget(target, prefix);
  await rm(target, { recursive: true, force: true, maxRetries: 3 });
}

function databaseUrl(databasePath: string): string {
  return `file:${databasePath.replaceAll("\\", "/")}`;
}

function assertMigratedDatabase(
  databasePath: string,
  expectedMigrationCount: number,
): void {
  const database = new Database(databasePath, { readonly: true });
  try {
    // SAFETY: SQLite derives this row shape from a SELECT that returns only the
    // non-null `sqlite_master.name` column.
    const rows = database
      .query(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => "?").join(", ")})
         ORDER BY name`,
      )
      .all(...REQUIRED_TABLES) as Array<{ name: string }>;
    const actualTables = rows.map(({ name }) => name);
    const expectedTables = [...REQUIRED_TABLES].sort();
    if (JSON.stringify(actualTables) !== JSON.stringify(expectedTables)) {
      throw new Error("Empty-database migration omitted a required table.");
    }

    // SAFETY: COUNT(*) always yields one numeric row under this fixed alias.
    const migration = database
      .query("SELECT COUNT(*) AS count FROM __drizzle_migrations")
      .get() as { count: number } | null;
    if (Number(migration?.count ?? -1) !== expectedMigrationCount) {
      throw new Error(
        "Empty-database migration count differs from the journal.",
      );
    }

    // SAFETY: COUNT(*) always yields one numeric row under this fixed alias.
    const resource = database
      .query(
        "SELECT COUNT(*) AS count FROM oauth_resources WHERE identifier = ?",
      )
      .get("http://127.0.0.1:5000/mcp") as { count: number } | null;
    if (Number(resource?.count ?? 0) !== 1) {
      throw new Error(
        "OAuth resource bootstrap did not run on the empty database.",
      );
    }

    if (database.query("PRAGMA foreign_key_check").all().length !== 0) {
      throw new Error("Empty-database migration left a foreign-key violation.");
    }
  } finally {
    database.close();
  }
}

export async function runEmptyDatabaseMigration(
  context: GateContext,
): Promise<void> {
  const temporary = await mkdtemp(
    path.join(os.tmpdir(), TEMPORARY_DATABASE_PREFIX),
  );
  const databasePath = path.join(temporary, "empty.db");
  try {
    await context.runCommand({
      argv: ["bun", "run", "--cwd", "apps/server", "db:migrate"],
      cwd: context.repoRoot,
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl(databasePath),
        DATABASE_AUTH_TOKEN: "",
        BETTER_AUTH_URL: "http://127.0.0.1:5000",
        MCP_RESOURCE_URL: "http://127.0.0.1:5000/mcp",
      },
    });

    const journalSource = await readFile(
      path.join(
        context.repoRoot,
        "apps",
        "server",
        "drizzle",
        "meta",
        "_journal.json",
      ),
      "utf8",
    );
    // SAFETY: the exact checked-in journal shape is validated by the following
    // migration-history gate; here only its array length is consumed.
    const journal = JSON.parse(journalSource) as { entries?: unknown };
    if (!Array.isArray(journal.entries) || journal.entries.length === 0) {
      throw new Error("Migration journal is missing or empty.");
    }
    assertMigratedDatabase(databasePath, journal.entries.length);
  } finally {
    await removeTemporaryDirectory(temporary, TEMPORARY_DATABASE_PREFIX);
  }
}

const MIGRATION_GATES: VerificationGate[] = [
  {
    id: "migration-empty-database",
    run: runEmptyDatabaseMigration,
  },
  commandGate("migration-history-checksums", [
    "bun",
    "run",
    "--cwd",
    "apps/server",
    "test",
    "scripts/migration-history.test.ts",
  ]),
  commandGate("migration-empty-contract", [
    "bun",
    "run",
    "--cwd",
    "apps/server",
    "test",
    "scripts/migrate.test.ts",
  ]),
  commandGate("migration-prefix-upgrades", [
    "bun",
    "run",
    "--cwd",
    "apps/server",
    "test",
    "scripts/migrate-prefix.integration.test.ts",
  ]),
  commandGate("migration-legacy-upgrade", [
    "bun",
    "run",
    "--cwd",
    "apps/server",
    "test",
    "scripts/migrate-legacy.integration.test.ts",
  ]),
];

async function assertPinnedBunRuntime(repoRoot: string): Promise<void> {
  // SAFETY: only the optional packageManager field is observed and compared to
  // an exact primitive string before it can influence execution.
  const manifest = JSON.parse(
    await readFile(path.join(repoRoot, "package.json"), "utf8"),
  ) as { packageManager?: unknown };
  if (manifest.packageManager !== `bun@${Bun.version}`) {
    throw new Error(
      `This verification requires the pinned package manager (${String(manifest.packageManager)}).`,
    );
  }
  const lockfile = Bun.file(path.join(repoRoot, "bun.lock"));
  if (!(await lockfile.exists()) || lockfile.size === 0) {
    throw new Error("The frozen Bun lockfile is missing or empty.");
  }
}

async function assertCleanRepository(repoRoot: string): Promise<void> {
  const status = await captureCheckedCommand(
    ["git", "status", "--porcelain", "--untracked-files=all"],
    repoRoot,
  );
  if (status) {
    throw new Error("Clean-clone verification generated repository changes.");
  }
}

export async function runTechnicalVerification(
  context: GateContext,
  requireCleanRepository = false,
): Promise<void> {
  await assertPinnedBunRuntime(context.repoRoot);
  const completed: string[] = [];
  for (const gate of [...STATIC_GATES, ...MIGRATION_GATES]) {
    console.log(`\n=== plan 025: ${gate.id} ===`);
    try {
      await gate.run(context);
      completed.push(gate.id);
    } catch (error) {
      throw new Error(`Required gate failed: ${gate.id}.`, { cause: error });
    }
  }

  if (JSON.stringify(completed) !== JSON.stringify(REQUIRED_GATE_IDS)) {
    throw new Error("A required plan 025 gate was skipped or reordered.");
  }
  if (requireCleanRepository) await assertCleanRepository(context.repoRoot);

  console.log(
    "\nPlan 025 technical verification passed. The project licence remains an explicit maintainer decision.",
  );
}

async function runCleanCloneVerification(repoRoot: string): Promise<void> {
  const temporary = await mkdtemp(path.join(os.tmpdir(), CLEAN_CLONE_PREFIX));
  const cloneRoot = path.join(temporary, "repository");
  try {
    const head = await captureCheckedCommand(
      ["git", "rev-parse", "HEAD"],
      repoRoot,
    );
    await runCheckedCommand({
      argv: [
        "git",
        "clone",
        "--no-hardlinks",
        "--no-checkout",
        repoRoot,
        cloneRoot,
      ],
      cwd: repoRoot,
    });
    await runCheckedCommand({
      argv: ["git", "checkout", "--detach", head],
      cwd: cloneRoot,
    });
    await runCheckedCommand({
      argv: ["bun", "install", "--frozen-lockfile"],
      cwd: cloneRoot,
    });
    await runCheckedCommand({
      argv: ["bun", "scripts/verification/plan-025.ts", "--inside-clean-clone"],
      cwd: cloneRoot,
    });
  } finally {
    await removeTemporaryDirectory(temporary, CLEAN_CLONE_PREFIX);
  }
}

async function main(): Promise<void> {
  const mode = parseVerificationMode(process.argv.slice(2));
  const repoRoot = await resolveRepositoryRoot(process.cwd());
  if (mode === "clean-clone") {
    await runCleanCloneVerification(repoRoot);
    return;
  }
  await runTechnicalVerification(
    { repoRoot, runCommand: runCheckedCommand },
    mode === "inside-clean-clone",
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Plan 025 verification failed.",
    );
    process.exit(1);
  }
}
