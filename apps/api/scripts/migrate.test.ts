import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { createClient, type Client } from "@libsql/client";
import { migrationsFolder, runMigrations } from "./migrate";

type Journal = { version: string; dialect: string; entries: Array<{
  idx: number; version: string; when: number; tag: string; breakpoints: boolean;
}> };

describe("deployment migrations", () => {
  let directory: string;
  let url: string;
  const clients: Client[] = [];

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "avermate-migrations-"));
    url = pathToFileURL(join(directory, "database.sqlite")).href;
  });

  afterEach(async () => {
    for (const client of clients.splice(0)) client.close();
    if (process.platform === "win32") {
      // libSQL's native file handles are finalized after the closed clients are
      // collected; Windows cannot unlink them while those handles remain alive.
      Bun.gc(true);
      await new Promise((done) => setImmediate(done));
      Bun.gc(true);
    }
    assert.ok(resolve(directory).startsWith(resolve(join(tmpdir(), "avermate-migrations-"))));
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });

  function openDatabase() {
    const client = createClient({ url });
    clients.push(client);
    return client;
  }

  async function copyMigrationHistory(count?: number) {
    const folder = join(directory, "migrations");
    await mkdir(join(folder, "meta"), { recursive: true });
    const journal: Journal = JSON.parse(await readFile(join(migrationsFolder, "meta", "_journal.json"), "utf8"));
    journal.entries = journal.entries.slice(0, count ?? journal.entries.length);
    for (const entry of journal.entries) {
      await copyFile(join(migrationsFolder, `${entry.tag}.sql`), join(folder, `${entry.tag}.sql`));
    }
    await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
    return { folder, journal };
  }

  async function seedAcademicData(client: Client) {
    await client.batch([
      "INSERT INTO users (id,name,email,email_verified,created_at,updated_at) VALUES ('owner','Student','student@example.test',1,100,100)",
      "INSERT INTO years (id,name,start_date,end_date,default_out_of,created_at,user_id) VALUES ('current','Current',100,200,2000,100,'owner'), ('reference','Previous',0,99,2000,100,'owner')",
      "INSERT INTO subjects (id,name,coefficient,depth,is_main_subject,is_display_subject,created_at,user_id,year_id) VALUES ('math','Maths',100,0,1,0,100,'owner','current')",
      "INSERT INTO grades (id,name,value,out_of,coefficient,passed_at,created_at,subject_id,user_id,year_id) VALUES ('grade','Exam',1750,2000,200,100,100,'math','owner','current')",
    ], "write");
  }

  it("migrates a fresh database and safely repeats on restart without touching academic data or mappings", async () => {
    await runMigrations({ url });
    const client = openDatabase();
    await seedAcademicData(client);
    await client.execute("INSERT INTO year_comparisons (user_id,year_id,reference_year_id,subject_map,period_map,custom_average_map,created_at,updated_at) VALUES ('owner','current','reference','{\"math\":null}','{}','{}',100,100)");
    const journalBefore = await client.execute("SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at");
    const mappingBefore = await client.execute("SELECT * FROM year_comparisons");
    await runMigrations({ url });
    assert.deepEqual((await client.execute("SELECT hash,created_at FROM __drizzle_migrations ORDER BY created_at")).rows, journalBefore.rows);
    assert.deepEqual((await client.execute("SELECT * FROM year_comparisons")).rows, mappingBefore.rows);
    assert.equal((await client.execute("SELECT value FROM grades WHERE id='grade'")).rows[0].value, 1750);
    assert.equal(journalBefore.rows.length, 8);
  });

  it("upgrades the previously deployed migration history through 0006 and 0007 while preserving grades", async () => {
    const { folder } = await copyMigrationHistory(6);
    await runMigrations({ url, migrationsFolder: folder });
    const client = openDatabase();
    await seedAcademicData(client);
    await runMigrations({ url });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __drizzle_migrations")).rows[0].count, 8);
    const columns = (await client.execute("PRAGMA table_info(year_comparisons)")).rows.map((row) => row.name);
    assert.ok(columns.includes("custom_average_map"));
    assert.equal((await client.execute("SELECT value FROM grades WHERE id='grade'")).rows[0].value, 1750);
    await runMigrations({ url });
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __drizzle_migrations")).rows[0].count, 8);
  });

  it("rolls back all statements and the journal when a pending migration fails", async () => {
    await runMigrations({ url });
    const client = openDatabase();
    await seedAcademicData(client);
    const { folder, journal } = await copyMigrationHistory();
    const previous = journal.entries.at(-1)!;
    journal.entries.push({ ...previous, idx: previous.idx + 1, when: previous.when + 1, tag: "0008_test_failure" });
    await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
    await writeFile(join(folder, "0008_test_failure.sql"), [
      "CREATE TABLE migration_failure_marker (id INTEGER)",
      "UPDATE grades SET value=0",
      "INSERT INTO intentionally_missing_table (id) VALUES (1)",
    ].join(";--> statement-breakpoint\n") + ";");
    await assert.rejects(runMigrations({ url, migrationsFolder: folder }));
    assert.equal((await client.execute("SELECT value FROM grades WHERE id='grade'")).rows[0].value, 1750);
    assert.equal((await client.execute("SELECT name FROM sqlite_master WHERE name='migration_failure_marker'")).rows.length, 0);
    assert.equal((await client.execute("SELECT COUNT(*) AS count FROM __drizzle_migrations")).rows[0].count, 8);
  });

  it("stops the actual start command on schema drift instead of running a push or starting the server", async () => {
    const client = openDatabase();
    await client.execute("CREATE TABLE accounts (id TEXT PRIMARY KEY)");
    await client.execute("INSERT INTO accounts (id) VALUES ('must-survive')");
    const result = spawnSync(process.execPath, ["run", "start"], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...process.env, DATABASE_URL: url, DATABASE_AUTH_TOKEN: "", NODE_ENV: "server-must-not-start" },
      encoding: "utf8",
      timeout: 15_000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    const output = result.stdout + result.stderr;
    assert.match(output, /Migration failed; API startup stopped/);
    assert.doesNotMatch(output, /Invalid environment variables|drizzle-kit push|db:push/);
    assert.equal((await client.execute("SELECT id FROM accounts")).rows[0].id, "must-survive");
  });

  it("rejects a missing database URL or missing migration package", async () => {
    await assert.rejects(runMigrations({ url: " " }), /DATABASE_URL is required/);
    await assert.rejects(runMigrations({ url, migrationsFolder: join(directory, "not-packaged") }));
  });
});
