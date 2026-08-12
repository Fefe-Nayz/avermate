import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createClient, type Client } from "@libsql/client";
import {
  defaultMigrationsFolder,
  migrateClient,
  prepareMigrationBaseline,
} from "./migrate";

const expectedMigrationCount = 14;

async function migrationRows(client: Client) {
  const result = await client.execute(
    "SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at",
  );
  return result.rows;
}

async function installUnjournaledBaseline(client: Client) {
  const sql = await readFile(
    `${defaultMigrationsFolder}/0000_init.sql`,
    "utf8",
  );
  await client.executeMultiple(sql.replaceAll("--> statement-breakpoint", ""));
  await client.execute(`
    CREATE TABLE __drizzle_migrations (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at numeric
    )
  `);
}

async function expectAnnouncementAudienceSchema(client: Client) {
  const [targetTable, audienceColumn] = await Promise.all([
    client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'announcement_preset_targets'",
    ),
    client.execute(
      "SELECT name FROM pragma_table_info('announcements') WHERE name = 'audience'",
    ),
  ]);
  expect(targetTable.rows).toHaveLength(1);
  expect(audienceColumn.rows).toHaveLength(1);
}

describe("migration baseline adoption", () => {
  test("migrates a fresh database without manufacturing a baseline", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      expect(await migrateClient(client)).toBe("fresh");
      expect((await migrationRows(client)).length).toBe(expectedMigrationCount);
      await expectAnnouncementAudienceSchema(client);
    } finally {
      client.close();
    }
  });

  test("adopts an exact db:push-era 0000 schema before migrating", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await installUnjournaledBaseline(client);
      expect(await migrateClient(client)).toBe("adopted");
      expect((await migrationRows(client)).length).toBe(expectedMigrationCount);
      await expectAnnouncementAudienceSchema(client);

      const social = await client.execute(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'social_profiles'",
      );
      expect(social.rows).toHaveLength(1);
    } finally {
      client.close();
    }
  });

  test("refuses to baseline a divergent unjournaled schema", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await installUnjournaledBaseline(client);
      await client.execute("CREATE TABLE unexpected_user_data (id text)");

      await expect(prepareMigrationBaseline(client)).rejects.toThrow(
        "does not exactly match migration 0000_init",
      );
      expect(await migrationRows(client)).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  test("leaves an existing migration journal untouched", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await migrateClient(client);
      const before = await migrationRows(client);
      expect(await prepareMigrationBaseline(client)).toBe("journaled");
      expect(await migrationRows(client)).toEqual(before);
      await migrateClient(client);
      expect(await migrationRows(client)).toEqual(before);
      await expectAnnouncementAudienceSchema(client);
    } finally {
      client.close();
    }
  });
});
