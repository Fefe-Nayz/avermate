import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createClient, type Client } from "@libsql/client";
import {
  defaultMigrationsFolder,
  migrateClient,
  prepareMigrationBaseline,
} from "./migrate";

const expectedMigrationCount = 21;

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

async function expectCardDefinitionSchema(client: Client) {
  const [columns, referenceTable, triggers] = await Promise.all([
    client.execute(
      `SELECT name, "notnull" FROM pragma_table_info('dashboard_cards')
         WHERE name IN ('definitionVersion', 'definitionJson',
                        'metric', 'target_kind', 'targetKind',
                        'target_id', 'targetId', 'display')
         ORDER BY name`,
    ),
    client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'dashboard_card_references'",
    ),
    client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'dashboard_card_%_deleted' ORDER BY name",
    ),
  ]);
  // The definition is the only representation of a card, and it is mandatory. The
  // four columns that projected it — written on every insert, read by nothing — are
  // gone, so asserting the *set* here is what stops one creeping back.
  expect(
    columns.rows.map((row) => ({
      name: String(row.name),
      notNull: Number(row.notnull) === 1,
    })),
  ).toEqual([
    { name: "definitionJson", notNull: true },
    { name: "definitionVersion", notNull: true },
  ]);
  expect(referenceTable.rows).toHaveLength(1);
  expect(triggers.rows.map((row) => String(row.name))).toEqual([
    "dashboard_card_custom_average_deleted",
    "dashboard_card_goal_deleted",
    "dashboard_card_period_deleted",
    "dashboard_card_subject_deleted",
  ]);
}

describe("migration baseline adoption", () => {
  test("keeps legacy dashboard-card rows intact when adding definitions", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`
        CREATE TABLE subjects (id text PRIMARY KEY NOT NULL);
        CREATE TABLE custom_averages (id text PRIMARY KEY NOT NULL);
        CREATE TABLE goals (id text PRIMARY KEY NOT NULL);
        CREATE TABLE periods (id text PRIMARY KEY NOT NULL);
        CREATE TABLE dashboard_cards (
          id text PRIMARY KEY NOT NULL,
          surface text DEFAULT 'overview' NOT NULL,
          metric text NOT NULL,
          targetKind text DEFAULT 'general' NOT NULL,
          targetId text,
          goalId text,
          display text DEFAULT 'value' NOT NULL,
          span integer DEFAULT 1 NOT NULL,
          title text,
          accent text,
          sortOrder integer DEFAULT 0 NOT NULL,
          hidden integer DEFAULT false NOT NULL,
          yearId text NOT NULL,
          userId text NOT NULL,
          createdAt integer NOT NULL,
          updatedAt integer NOT NULL
        );
        INSERT INTO dashboard_cards (
          id, metric, targetKind, targetId, goalId, display, span, title,
          sortOrder, yearId, userId, createdAt, updatedAt
        ) VALUES (
          'card-legacy', 'average', 'subject', 'subject-a', 'goal-a', 'sparkline', 3,
          'Legacy card', 4, 'year-a', 'user-a', 1, 2
        );
      `);
      const migration = await readFile(
        `${defaultMigrationsFolder}/0017_widget_definitions.sql`,
        "utf8",
      );
      await client.executeMultiple(
        migration.replaceAll("--> statement-breakpoint", ""),
      );

      const result = await client.execute(
        "SELECT * FROM dashboard_cards WHERE id = 'card-legacy'",
      );
      expect(result.rows[0]).toMatchObject({
        id: "card-legacy",
        metric: "average",
        targetKind: "subject",
        targetId: "subject-a",
        display: "sparkline",
        span: 3,
        title: "Legacy card",
        sortOrder: 4,
        definitionVersion: null,
        definitionJson: null,
      });
      const references = await client.execute(
        "SELECT kind, referenceId FROM dashboard_card_references WHERE cardId = 'card-legacy' ORDER BY kind",
      );
      expect(
        references.rows.map((row) => ({
          kind: String(row.kind),
          referenceId: String(row.referenceId),
        })),
      ).toEqual([
        { kind: "goal", referenceId: "goal-a" },
        { kind: "subject", referenceId: "subject-a" },
      ]);
    } finally {
      client.close();
    }
  });

  test("migrates a fresh database without manufacturing a baseline", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      expect(await migrateClient(client)).toBe("fresh");
      expect((await migrationRows(client)).length).toBe(expectedMigrationCount);
      await expectAnnouncementAudienceSchema(client);
      await expectCardDefinitionSchema(client);
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
      await expectCardDefinitionSchema(client);

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
      await expectCardDefinitionSchema(client);
    } finally {
      client.close();
    }
  });
});
