import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

type BaselineStatus = "adopted" | "fresh" | "journaled";

type MigrationJournal = {
  entries: Array<{
    idx: number;
    tag: string;
    when: number;
  }>;
};

type SchemaObject = {
  name: string;
  sql: string;
  tableName: string;
  type: string;
};

export const defaultMigrationsFolder = fileURLToPath(
  new URL("../drizzle", import.meta.url),
);

function normalizeSql(value: unknown) {
  return String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

async function readSchemaObjects(client: Client): Promise<SchemaObject[]> {
  const result = await client.execute(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%'
      AND name != '__drizzle_migrations'
    ORDER BY type, name
  `);

  return result.rows.map((row) => ({
    name: String(row.name),
    sql: normalizeSql(row.sql),
    tableName: String(row.tbl_name),
    type: String(row.type),
  }));
}

async function readBaseline(migrationsFolder: string) {
  const [journalSource, sql] = await Promise.all([
    readFile(`${migrationsFolder}/meta/_journal.json`, "utf8"),
    readFile(`${migrationsFolder}/0000_init.sql`, "utf8"),
  ]);
  const journal = JSON.parse(journalSource) as MigrationJournal;
  const entry = journal.entries.find((candidate) => candidate.idx === 0);

  if (!entry || entry.tag !== "0000_init") {
    throw new Error("The migration journal has no canonical 0000_init entry.");
  }

  const client = createClient({ url: ":memory:" });
  try {
    await client.executeMultiple(
      sql.replaceAll("--> statement-breakpoint", ""),
    );
    return {
      createdAt: entry.when,
      hash: createHash("sha256").update(sql).digest("hex"),
      objects: await readSchemaObjects(client),
    };
  } finally {
    client.close();
  }
}

async function migrationCount(client: Client) {
  const table = await client.execute(`
    SELECT 1 AS present
    FROM sqlite_master
    WHERE type = 'table' AND name = '__drizzle_migrations'
    LIMIT 1
  `);
  if (table.rows.length === 0) return 0;

  const count = await client.execute(
    "SELECT COUNT(*) AS count FROM __drizzle_migrations",
  );
  return Number(count.rows[0]?.count ?? 0);
}

/**
 * Adopts only the exact schema represented by 0000_init. Older rewrite
 * installations were created with `db:push`, so they can have that schema and
 * an empty Drizzle journal. Any extra, missing, or changed object fails closed.
 */
export async function prepareMigrationBaseline(
  client: Client,
  migrationsFolder = defaultMigrationsFolder,
): Promise<BaselineStatus> {
  if ((await migrationCount(client)) > 0) return "journaled";

  const currentObjects = await readSchemaObjects(client);
  if (currentObjects.length === 0) return "fresh";

  const baseline = await readBaseline(migrationsFolder);
  if (JSON.stringify(currentObjects) !== JSON.stringify(baseline.objects)) {
    throw new Error(
      "Refusing to adopt an unjournaled database because its schema does not exactly match migration 0000_init.",
    );
  }

  await client.batch(
    [
      {
        sql: `
          CREATE TABLE IF NOT EXISTS __drizzle_migrations (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at numeric
          )
        `,
        args: [],
      },
      {
        sql: `
          INSERT INTO __drizzle_migrations (hash, created_at)
          SELECT ?, ?
          WHERE NOT EXISTS (SELECT 1 FROM __drizzle_migrations)
        `,
        args: [baseline.hash, baseline.createdAt],
      },
    ],
    "write",
  );

  return "adopted";
}

export async function migrateClient(
  client: Client,
  migrationsFolder = defaultMigrationsFolder,
) {
  const baseline = await prepareMigrationBaseline(client, migrationsFolder);
  await migrate(drizzle(client), { migrationsFolder });
  return baseline;
}

export async function migrateConfiguredDatabase() {
  const client = createClient({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });

  try {
    const baseline = await migrateClient(client);
    if (baseline === "adopted") {
      console.info(
        "Adopted the exact 0000_init schema as the migration baseline.",
      );
    }
    console.info("Database migrations completed.");
  } finally {
    client.close();
  }
}

if (import.meta.main) {
  await migrateConfiguredDatabase();
}
