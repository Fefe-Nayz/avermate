import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { createClient, type Client } from "@libsql/client";
import {
  bootstrapOAuthResource,
  defaultMigrationsFolder,
  migrateClient,
  prepareMigrationBaseline,
  repairLegacyDemoActionFixtures,
} from "./migrate";
import { demoActionDigests } from "./demo-action-fixtures";

// SAFETY: the checked-in Drizzle journal is exercised by the dedicated
// migration-history test before this count is used.
const migrationJournal = JSON.parse(
  await readFile(`${defaultMigrationsFolder}/meta/_journal.json`, "utf8"),
) as { entries: unknown[] };
const expectedMigrationCount = migrationJournal.entries.length;

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

async function expectGradeSyncSchema(client: Client) {
  const [
    tables,
    connectionColumns,
    connectionYearForeignKey,
    gradeColumn,
    gradeRecordForeignKeys,
    periodMappingForeignKey,
    indexes,
    remoteScopeIndexColumns,
    gradeRecordTable,
  ] = await Promise.all([
    client.execute(
      `SELECT name FROM sqlite_master
       WHERE type = 'table'
         AND name IN ('sync_grade_records', 'sync_period_mappings')
       ORDER BY name`,
    ),
    client.execute(
      `SELECT name, "notnull", dflt_value
       FROM pragma_table_info('sync_connections')
       WHERE name IN (
         'sealedCredentials', 'remoteStudentId', 'remoteAcademicYearId',
         'gradesAuthority', 'disconnectedAt', 'yearId'
       )
       ORDER BY name`,
    ),
    client.execute(
      `SELECT "from", "table", on_delete
       FROM pragma_foreign_key_list('sync_connections')
       WHERE "from" = 'yearId'`,
    ),
    client.execute(
      `SELECT name, "notnull", dflt_value
       FROM pragma_table_info('grades')
       WHERE name IN ('excludedFromAverage', 'syncExcludedFromAverage')
       ORDER BY name`,
    ),
    client.execute(
      `SELECT "from", "table", on_delete
       FROM pragma_foreign_key_list('sync_grade_records')
       WHERE "from" IN ('connectionId', 'localGradeId', 'yearId')
       ORDER BY "from"`,
    ),
    client.execute(
      `SELECT "from", "table", on_delete
       FROM pragma_foreign_key_list('sync_period_mappings')
       WHERE "from" = 'periodId'`,
    ),
    client.execute(
      `SELECT name FROM sqlite_master
       WHERE type = 'index'
         AND name IN (
           'sync_connections_grades_authority_unique',
           'sync_connections_remote_scope_unique',
           'sync_grade_records_conn_external_unique',
           'sync_grade_records_local_grade_unique',
           'sync_period_mappings_conn_external_unique'
         )
       ORDER BY name`,
    ),
    client.execute(
      `SELECT name FROM pragma_index_info('sync_connections_remote_scope_unique')
       ORDER BY seqno`,
    ),
    client.execute(
      `SELECT sql FROM sqlite_master
       WHERE type = 'table' AND name = 'sync_grade_records'`,
    ),
  ]);

  expect(tables.rows.map((row) => String(row.name))).toEqual([
    "sync_grade_records",
    "sync_period_mappings",
  ]);
  expect(connectionColumns.rows).toEqual([
    expect.objectContaining({
      name: "disconnectedAt",
      notnull: 0,
      dflt_value: null,
    }),
    expect.objectContaining({
      name: "gradesAuthority",
      notnull: 1,
      dflt_value: "false",
    }),
    expect.objectContaining({
      name: "remoteAcademicYearId",
      notnull: 0,
      dflt_value: null,
    }),
    expect.objectContaining({
      name: "remoteStudentId",
      notnull: 0,
      dflt_value: null,
    }),
    expect.objectContaining({
      name: "sealedCredentials",
      notnull: 0,
      dflt_value: null,
    }),
    expect.objectContaining({
      name: "yearId",
      notnull: 0,
      dflt_value: null,
    }),
  ]);
  expect(connectionYearForeignKey.rows[0]).toMatchObject({
    from: "yearId",
    table: "years",
    on_delete: "SET NULL",
  });
  expect(gradeColumn.rows).toEqual([
    expect.objectContaining({
      name: "excludedFromAverage",
      notnull: 1,
      dflt_value: "false",
    }),
    expect.objectContaining({
      name: "syncExcludedFromAverage",
      notnull: 1,
      dflt_value: "false",
    }),
  ]);
  expect(gradeRecordForeignKeys.rows).toEqual([
    expect.objectContaining({
      from: "connectionId",
      table: "sync_connections",
      on_delete: "CASCADE",
    }),
    expect.objectContaining({
      from: "localGradeId",
      table: "grades",
      on_delete: "SET NULL",
    }),
    expect.objectContaining({
      from: "yearId",
      table: "years",
      on_delete: "CASCADE",
    }),
  ]);
  expect(periodMappingForeignKey.rows[0]).toMatchObject({
    from: "periodId",
    table: "periods",
    on_delete: "SET NULL",
  });
  expect(indexes.rows.map((row) => String(row.name))).toEqual([
    "sync_connections_grades_authority_unique",
    "sync_connections_remote_scope_unique",
    "sync_grade_records_conn_external_unique",
    "sync_grade_records_local_grade_unique",
    "sync_period_mappings_conn_external_unique",
  ]);
  expect(remoteScopeIndexColumns.rows.map((row) => String(row.name))).toEqual([
    "userId",
    "provider",
    "baseUrl",
    "remoteStudentId",
    "remoteAcademicYearId",
  ]);
  expect(String(gradeRecordTable.rows[0]?.sql)).toContain(
    "sync_grade_records_state_check",
  );
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

async function expectRecordingPlanningSchema(client: Client) {
  const [columns, foreignKeys, table] = await Promise.all([
    client.execute(
      `SELECT name FROM pragma_table_info('lecture_recordings')
       WHERE name IN ('calendarEventId', 'timetableOccurrenceId')
       ORDER BY name`,
    ),
    client.execute(
      `SELECT "from", "table", on_delete FROM pragma_foreign_key_list('lecture_recordings')
       WHERE "from" IN ('calendarEventId', 'timetableOccurrenceId')
       ORDER BY "from"`,
    ),
    client.execute(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'lecture_recordings'",
    ),
  ]);
  expect(columns.rows.map((row) => String(row.name))).toEqual([
    "calendarEventId",
    "timetableOccurrenceId",
  ]);
  expect(
    foreignKeys.rows.map((row) => ({
      from: String(row.from),
      table: String(row.table),
      onDelete: String(row.on_delete),
    })),
  ).toEqual([
    {
      from: "calendarEventId",
      table: "calendar_events",
      onDelete: "SET NULL",
    },
    {
      from: "timetableOccurrenceId",
      table: "timetable_occurrences",
      onDelete: "SET NULL",
    },
  ]);
  expect(String(table.rows[0]?.sql)).toContain(
    "lecture_recordings_planning_target_check",
  );
}

async function expectMaterialsExplorerSchema(client: Client) {
  const [
    tables,
    fileColumns,
    fileForeignKeys,
    oauthColumns,
    adoptionIndex,
    adoptionColumn,
    connectionForeignKeys,
    deletionActorColumns,
    syncFenceColumns,
    ganttColumns,
    deletionBatchColumns,
  ] = await Promise.all([
    client.execute(
      `SELECT name FROM sqlite_master
         WHERE type = 'table'
           AND name IN ('content_connections', 'material_tags',
                        'material_tag_links', 'study_document_builds')
         ORDER BY name`,
    ),
    client.execute(
      `SELECT name FROM pragma_table_info('files')
         WHERE name IN ('previewFileId', 'previewStatus')
         ORDER BY name`,
    ),
    client.execute(
      `SELECT "from", "table", on_delete
         FROM pragma_foreign_key_list('files')
         WHERE "from" = 'previewFileId'`,
    ),
    client.execute(
      `SELECT name FROM pragma_table_info('content_oauth_states')
         WHERE name = 'sealedVerifier'`,
    ),
    client.execute(
      `SELECT name FROM sqlite_master
         WHERE type = 'index'
           AND name = 'material_documents_adoption_key_unique'`,
    ),
    client.execute(
      `SELECT name FROM pragma_table_info('material_documents')
         WHERE name = 'adoptionKey'`,
    ),
    client.execute(
      `SELECT 'material_documents' AS owner, "from", "table", on_delete, on_update
           FROM pragma_foreign_key_list('material_documents')
          WHERE "from" = 'connectionId'
         UNION ALL
         SELECT 'material_folders' AS owner, "from", "table", on_delete, on_update
           FROM pragma_foreign_key_list('material_folders')
          WHERE "from" = 'connectionId'
         ORDER BY owner`,
    ),
    client.execute(
      `SELECT 'lecture_recordings' AS owner, name
           FROM pragma_table_info('lecture_recordings') WHERE name = 'deletedBy'
         UNION ALL SELECT 'material_documents', name
           FROM pragma_table_info('material_documents') WHERE name = 'deletedBy'
         UNION ALL SELECT 'material_folders', name
           FROM pragma_table_info('material_folders') WHERE name = 'deletedBy'
         UNION ALL SELECT 'study_documents', name
           FROM pragma_table_info('study_documents') WHERE name = 'deletedBy'
         ORDER BY owner`,
    ),
    client.execute(
      `SELECT name, "notnull", dflt_value
         FROM pragma_table_info('content_connections')
         WHERE name IN ('syncRevision', 'syncRequestedGeneration', 'syncActiveJobId')
         ORDER BY name`,
    ),
    client.execute(
      `SELECT 'academic_assignments' AS owner, name
           FROM pragma_table_info('academic_assignments') WHERE name = 'startsAt'
         UNION ALL SELECT 'planning_tasks', name
           FROM pragma_table_info('planning_tasks') WHERE name = 'startsAt'
         ORDER BY owner`,
    ),
    client.execute(
      `SELECT 'lecture_recordings' AS owner, name
           FROM pragma_table_info('lecture_recordings') WHERE name = 'deletedBatchId'
         UNION ALL SELECT 'material_documents', name
           FROM pragma_table_info('material_documents') WHERE name = 'deletedBatchId'
         UNION ALL SELECT 'material_folders', name
           FROM pragma_table_info('material_folders') WHERE name = 'deletedBatchId'
         UNION ALL SELECT 'study_documents', name
           FROM pragma_table_info('study_documents') WHERE name = 'deletedBatchId'
         ORDER BY owner`,
    ),
  ]);
  expect(tables.rows.map((row) => String(row.name))).toEqual([
    "content_connections",
    "material_tag_links",
    "material_tags",
    "study_document_builds",
  ]);
  expect(fileColumns.rows.map((row) => String(row.name))).toEqual([
    "previewFileId",
    "previewStatus",
  ]);
  expect(fileForeignKeys.rows[0]).toMatchObject({
    from: "previewFileId",
    table: "files",
    on_delete: "SET NULL",
  });
  expect(oauthColumns.rows).toHaveLength(1);
  expect(adoptionColumn.rows).toHaveLength(1);
  expect(adoptionIndex.rows).toHaveLength(1);
  expect(connectionForeignKeys.rows).toEqual([
    expect.objectContaining({
      owner: "material_documents",
      from: "connectionId",
      table: "content_connections",
      on_delete: "SET NULL",
      on_update: "CASCADE",
    }),
    expect.objectContaining({
      owner: "material_folders",
      from: "connectionId",
      table: "content_connections",
      on_delete: "SET NULL",
      on_update: "CASCADE",
    }),
  ]);
  expect(deletionActorColumns.rows).toEqual([
    expect.objectContaining({ owner: "lecture_recordings", name: "deletedBy" }),
    expect.objectContaining({ owner: "material_documents", name: "deletedBy" }),
    expect.objectContaining({ owner: "material_folders", name: "deletedBy" }),
    expect.objectContaining({ owner: "study_documents", name: "deletedBy" }),
  ]);
  expect(syncFenceColumns.rows).toEqual([
    expect.objectContaining({
      name: "syncActiveJobId",
      notnull: 0,
      dflt_value: null,
    }),
    expect.objectContaining({
      name: "syncRequestedGeneration",
      notnull: 1,
      dflt_value: "0",
    }),
    expect.objectContaining({
      name: "syncRevision",
      notnull: 1,
      dflt_value: "0",
    }),
  ]);
  expect(ganttColumns.rows).toEqual([
    expect.objectContaining({
      owner: "academic_assignments",
      name: "startsAt",
    }),
    expect.objectContaining({ owner: "planning_tasks", name: "startsAt" }),
  ]);
  expect(deletionBatchColumns.rows).toEqual([
    expect.objectContaining({
      owner: "lecture_recordings",
      name: "deletedBatchId",
    }),
    expect.objectContaining({
      owner: "material_documents",
      name: "deletedBatchId",
    }),
    expect.objectContaining({
      owner: "material_folders",
      name: "deletedBatchId",
    }),
    expect.objectContaining({
      owner: "study_documents",
      name: "deletedBatchId",
    }),
  ]);
}

async function expectSchemaCongruence(client: Client) {
  const [feedbackForeignKey, feedbackDefault, socialGroupForeignKey] =
    await Promise.all([
      client.execute(`
        SELECT "from", "table", on_update, on_delete
        FROM pragma_foreign_key_list('feedback')
        WHERE "from" = 'assignedToUserId'
      `),
      client.execute(`
        SELECT name, dflt_value
        FROM pragma_table_info('feedback')
        WHERE name = 'lastSeenAt'
      `),
      client.execute(`
        SELECT "from", "table", on_update, on_delete
        FROM pragma_foreign_key_list('social_groups')
        WHERE "from" = 'sharedSetupYearId'
      `),
    ]);

  expect(feedbackForeignKey.rows[0]).toMatchObject({
    from: "assignedToUserId",
    table: "users",
    on_update: "CASCADE",
    on_delete: "SET NULL",
  });
  expect(feedbackDefault.rows[0]).toMatchObject({
    name: "lastSeenAt",
    dflt_value: null,
  });
  expect(socialGroupForeignKey.rows[0]).toMatchObject({
    from: "sharedSetupYearId",
    table: "years",
    on_update: "CASCADE",
    on_delete: "SET NULL",
  });
  expect((await client.execute("PRAGMA foreign_key_check")).rows).toHaveLength(
    0,
  );
}

describe("migration baseline adoption", () => {
  test("preserves existing school connections while adding grade sync state", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`
        CREATE TABLE users (id text PRIMARY KEY NOT NULL);
        CREATE TABLE years (id text PRIMARY KEY NOT NULL);
        CREATE TABLE periods (id text PRIMARY KEY NOT NULL);
        CREATE TABLE grades (id text PRIMARY KEY NOT NULL);
        CREATE TABLE sync_connections (
          id text PRIMARY KEY NOT NULL,
          provider text NOT NULL,
          label text NOT NULL,
          baseUrl text NOT NULL,
          sealedCredentials text NOT NULL,
          caCertPem text,
          capabilities text NOT NULL,
          status text DEFAULT 'active' NOT NULL,
          lastSyncAt integer,
          lastError text,
          yearId text NOT NULL,
          userId text NOT NULL,
          createdAt integer NOT NULL,
          updatedAt integer NOT NULL
        );
        INSERT INTO users (id) VALUES ('legacy-user');
        INSERT INTO years (id) VALUES ('legacy-year');
        INSERT INTO sync_connections (
          id, provider, label, baseUrl, sealedCredentials, capabilities,
          yearId, userId, createdAt, updatedAt
        ) VALUES (
          'legacy-connection', 'ecoledirecte', 'Legacy school',
          'https://example.invalid', 'sealed-secret', '[]',
          'legacy-year', 'legacy-user', 1, 2
        );
      `);

      const migration = await readFile(
        `${defaultMigrationsFolder}/0047_square_blazing_skull.sql`,
        "utf8",
      );
      const sourceGateMigration = await readFile(
        `${defaultMigrationsFolder}/0048_sticky_the_professor.sql`,
        "utf8",
      );
      const remoteScopeMigration = await readFile(
        `${defaultMigrationsFolder}/0049_youthful_lightspeed.sql`,
        "utf8",
      );
      const gradeActivationMigration = await readFile(
        `${defaultMigrationsFolder}/0050_activate-school-grades.sql`,
        "utf8",
      );
      const tenantScopeMigration = await readFile(
        `${defaultMigrationsFolder}/0051_tenant_school_scope.sql`,
        "utf8",
      );
      await client.executeMultiple(
        `${migration}\n${sourceGateMigration}\n${remoteScopeMigration}\n${gradeActivationMigration}`.replaceAll(
          "--> statement-breakpoint",
          "",
        ),
      );
      await client.executeMultiple(`
        UPDATE sync_connections
        SET remoteStudentId = 'student-1',
            remoteAcademicYearId = 'scope:2026-08-01T00:00:00.000Z:2027-07-31T23:59:59.999Z',
            sealedCredentials = NULL,
            status = 'disconnected',
            disconnectedAt = 2;
        INSERT INTO sync_connections (
          id, provider, label, baseUrl, sealedCredentials, capabilities,
          remoteStudentId, remoteAcademicYearId, gradesAuthority,
          yearId, userId, createdAt, updatedAt
        ) VALUES (
          'legacy-duplicate', 'ecoledirecte', 'Legacy duplicate',
          'https://example.invalid', 'sealed-secret-2', '["grades"]',
          'student-1',
          'scope:2026-08-02T00:00:00.000Z:2027-08-01T23:59:59.999Z',
          true, 'legacy-year', 'legacy-user', 3, 4
        );
      `);
      await client.executeMultiple(
        tenantScopeMigration.replaceAll("--> statement-breakpoint", ""),
      );

      expect(
        (
          await client.execute(
            `SELECT id, sealedCredentials, capabilities, yearId, remoteStudentId,
                    remoteAcademicYearId, gradesAuthority, disconnectedAt
             FROM sync_connections WHERE id = 'legacy-connection'`,
          )
        ).rows[0],
      ).toMatchObject({
        id: "legacy-connection",
        sealedCredentials: null,
        capabilities: '["grades"]',
        yearId: "legacy-year",
        gradesAuthority: 0,
        disconnectedAt: 2,
        remoteStudentId: null,
        remoteAcademicYearId: "school-year:2026",
      });
      expect(
        (
          await client.execute(
            `SELECT sealedCredentials, status, remoteStudentId,
                    remoteAcademicYearId, gradesAuthority
             FROM sync_connections WHERE id = 'legacy-duplicate'`,
          )
        ).rows[0],
      ).toMatchObject({
        sealedCredentials: "sealed-secret-2",
        status: "active",
        gradesAuthority: 1,
        remoteStudentId: "student-1",
        remoteAcademicYearId: "school-year:2026",
      });
      await expectGradeSyncSchema(client);
    } finally {
      client.close();
    }
  });

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
      await expectRecordingPlanningSchema(client);
      await expectMaterialsExplorerSchema(client);
      await expectGradeSyncSchema(client);
      await expectSchemaCongruence(client);
    } finally {
      client.close();
    }
  });

  test("bootstraps the Better Auth resource and links legacy OAuth clients idempotently", async () => {
    const client = createClient({ url: ":memory:" });
    const resourceUrl = "http://localhost:5000/mcp";
    try {
      await migrateClient(client);
      await client.execute({
        sql: `
          INSERT INTO oauth_clients (id, clientId, redirectUris, name)
          VALUES (?, ?, ?, ?)
        `,
        args: ["legacy-row", "legacy-client", "[]", "Legacy client"],
      });

      await bootstrapOAuthResource(client, resourceUrl);
      const resource = await client.execute({
        sql: "SELECT identifier, name FROM oauth_resources WHERE identifier = ?",
        args: [resourceUrl],
      });
      expect(resource.rows).toEqual([
        expect.objectContaining({
          identifier: resourceUrl,
          name: "Avermate MCP",
        }),
      ]);
      const links = await client.execute({
        sql: `
          SELECT clientId, resourceId
          FROM oauth_client_resources
          WHERE clientId = ?
        `,
        args: ["legacy-client"],
      });
      expect(links.rows).toEqual([
        expect.objectContaining({
          clientId: "legacy-client",
          resourceId: resourceUrl,
        }),
      ]);

      await client.execute({
        sql: "UPDATE oauth_resources SET name = ? WHERE identifier = ?",
        args: ["Custom resource policy", resourceUrl],
      });
      await bootstrapOAuthResource(client, resourceUrl);
      const after = await client.execute({
        sql: `
          SELECT resources.name, COUNT(links.id) AS linkCount
          FROM oauth_resources AS resources
          LEFT JOIN oauth_client_resources AS links
            ON links.resourceId = resources.identifier
          WHERE resources.identifier = ?
          GROUP BY resources.identifier
        `,
        args: [resourceUrl],
      });
      expect(after.rows[0]).toMatchObject({
        name: "Custom resource policy",
        linkCount: 1,
      });
    } finally {
      client.close();
    }
  });

  test("repairs only the invalid legacy demo action fixtures idempotently", async () => {
    const client = createClient({ url: ":memory:" });
    try {
      await client.executeMultiple(`
        CREATE TABLE agent_actions (
          id text PRIMARY KEY NOT NULL,
          userId text NOT NULL,
          toolId text NOT NULL,
          idempotencyKey text NOT NULL,
          argumentsHash text NOT NULL,
          previewHash text NOT NULL,
          status text NOT NULL,
          createdAt integer NOT NULL
        );
        CREATE TABLE agent_approvals (
          id text PRIMARY KEY NOT NULL,
          actionId text NOT NULL UNIQUE,
          userId text NOT NULL,
          state text NOT NULL,
          argumentsHash text NOT NULL,
          previewHash text NOT NULL,
          expiresAt integer NOT NULL,
          createdAt integer NOT NULL
        );
        INSERT INTO agent_actions VALUES
          ('task', 'demo', 'planning.tasks.create', 'seed-action-task',
           'seed-hash-task', 'seed-preview-task', 'completed', 1000),
          ('grade', 'demo', 'grades.update', 'seed-action-grade',
           'seed-hash-grade', 'seed-preview-grade', 'awaiting-approval', 1000),
          ('unrelated', 'real-user', 'planning.tasks.create', 'real-action',
           'seed-hash-task', 'seed-preview-task', 'completed', 1000);
      `);

      expect(await repairLegacyDemoActionFixtures(client)).toBe(3);
      expect(await repairLegacyDemoActionFixtures(client)).toBe(0);

      const actions = await client.execute(`
        SELECT id, argumentsHash, previewHash
        FROM agent_actions ORDER BY id
      `);
      expect(actions.rows).toEqual([
        expect.objectContaining({
          id: "grade",
          argumentsHash: demoActionDigests.grade.argumentsHash,
          previewHash: demoActionDigests.grade.previewHash,
        }),
        expect.objectContaining({
          id: "task",
          argumentsHash: demoActionDigests.task.argumentsHash,
          previewHash: demoActionDigests.task.previewHash,
        }),
        expect.objectContaining({
          id: "unrelated",
          argumentsHash: "seed-hash-task",
          previewHash: "seed-preview-task",
        }),
      ]);
      const approvals = await client.execute(`
        SELECT actionId, state, argumentsHash, previewHash, expiresAt
        FROM agent_approvals
      `);
      expect(approvals.rows).toEqual([
        expect.objectContaining({
          actionId: "grade",
          state: "pending",
          argumentsHash: demoActionDigests.grade.argumentsHash,
          previewHash: demoActionDigests.grade.previewHash,
          expiresAt: 605800,
        }),
      ]);
      expect(
        actions.rows
          .filter((row) => row.id !== "unrelated")
          .flatMap((row) => [row.argumentsHash, row.previewHash])
          .every((hash) => /^[a-f0-9]{64}$/u.test(String(hash))),
      ).toBe(true);
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
      await expectRecordingPlanningSchema(client);
      await expectMaterialsExplorerSchema(client);
      await expectGradeSyncSchema(client);
      await expectSchemaCongruence(client);

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
      await expectRecordingPlanningSchema(client);
      await expectMaterialsExplorerSchema(client);
      await expectGradeSyncSchema(client);
      await expectSchemaCongruence(client);
    } finally {
      client.close();
    }
  });
});
