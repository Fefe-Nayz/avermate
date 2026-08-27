import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";

import { databaseClientConfig } from "../src/db/client-config";
import { demoActionDigests } from "./demo-action-fixtures";

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

/**
 * Better Auth 1.7 stores protected resources separately and, when per-client
 * resources are enforced, pre-1.7 clients need an explicit link. Keep this
 * bootstrap beside the schema migration so the first OAuth request never has
 * to repair deployment state. Existing resource policy edits are preserved.
 */
export async function bootstrapOAuthResource(
  client: Client,
  resourceUrl: string,
) {
  const identifier = new URL(resourceUrl).href;
  const now = Math.floor(Date.now() / 1_000);
  await client.batch(
    [
      {
        sql: `
          INSERT INTO oauth_resources (
            id, identifier, name, dpopBoundAccessTokensRequired, disabled,
            createdAt, updatedAt, policyVersion
          ) VALUES (
            'ors_' || lower(hex(randomblob(8))), ?, 'Avermate MCP',
            0, 0, ?, ?, 1
          )
          ON CONFLICT(identifier) DO NOTHING
        `,
        args: [identifier, now, now],
      },
      {
        sql: `
          INSERT INTO oauth_client_resources (
            id, clientId, resourceId, createdAt
          )
          SELECT
            'ocr_' || lower(hex(randomblob(8))), clientId, ?, ?
          FROM oauth_clients AS clients
          WHERE NOT EXISTS (
            SELECT 1
            FROM oauth_client_resources AS links
            WHERE links.clientId = clients.clientId
              AND links.resourceId = ?
          )
        `,
        args: [identifier, now, identifier],
      },
    ],
    "write",
  );
}

/**
 * Repairs the two showcase actions written by the original plan-030 demo seed.
 *
 * Those fixtures used human-readable placeholders where the public action DTO
 * requires 64-character SHA-256 digests. Reading action activity therefore
 * failed contract validation for every account that owned the showcase data.
 * Match every legacy marker so real ledger rows can never be rewritten.
 */
export async function repairLegacyDemoActionFixtures(client: Client) {
  const result = await client.batch(
    [
      {
        sql: `
          UPDATE agent_actions
          SET argumentsHash = ?, previewHash = ?
          WHERE toolId = 'planning.tasks.create'
            AND idempotencyKey = 'seed-action-task'
            AND argumentsHash = 'seed-hash-task'
            AND previewHash = 'seed-preview-task'
        `,
        args: [
          demoActionDigests.task.argumentsHash,
          demoActionDigests.task.previewHash,
        ],
      },
      {
        sql: `
          UPDATE agent_actions
          SET argumentsHash = ?, previewHash = ?
          WHERE toolId = 'grades.update'
            AND idempotencyKey = 'seed-action-grade'
            AND argumentsHash = 'seed-hash-grade'
            AND previewHash = 'seed-preview-grade'
        `,
        args: [
          demoActionDigests.grade.argumentsHash,
          demoActionDigests.grade.previewHash,
        ],
      },
      {
        sql: `
          INSERT INTO agent_approvals (
            id, actionId, userId, state, argumentsHash, previewHash,
            expiresAt, createdAt
          )
          SELECT
            'aappr_' || lower(hex(randomblob(8))), action.id, action.userId,
            'pending', action.argumentsHash, action.previewHash,
            action.createdAt + 604800, action.createdAt
          FROM agent_actions AS action
          WHERE action.toolId = 'grades.update'
            AND action.idempotencyKey = 'seed-action-grade'
            AND action.argumentsHash = ?
            AND action.previewHash = ?
            AND action.status = 'awaiting-approval'
            AND NOT EXISTS (
              SELECT 1 FROM agent_approvals AS approval
              WHERE approval.actionId = action.id
            )
        `,
        args: [
          demoActionDigests.grade.argumentsHash,
          demoActionDigests.grade.previewHash,
        ],
      },
    ],
    "write",
  );
  return result.reduce((count, item) => count + item.rowsAffected, 0);
}

export async function migrateConfiguredDatabase() {
  const client = createClient(
    databaseClientConfig({
      url: process.env.DATABASE_URL ?? "file:./dev.db",
      authToken: process.env.DATABASE_AUTH_TOKEN,
    }),
  );

  try {
    const baseline = await migrateClient(client);
    await repairLegacyDemoActionFixtures(client);
    const resourceUrl =
      process.env.MCP_RESOURCE_URL ??
      (process.env.BETTER_AUTH_URL
        ? `${process.env.BETTER_AUTH_URL.replace(/\/$/, "")}/mcp`
        : undefined);
    if (resourceUrl) {
      await bootstrapOAuthResource(client, resourceUrl);
    }
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
