import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultMigrationsFolder, migrateClient } from "./migrate";
import {
  migrateMicrosoftIdentities,
  parseMicrosoftIdentityMappings,
} from "./migrate-microsoft-identities";

type Journal = {
  version: string;
  dialect: string;
  entries: Array<{
    idx: number;
    version: string;
    when: number;
    tag: string;
    breakpoints: boolean;
  }>;
};

const temporaryDirectories: string[] = [];
const clients: Client[] = [];
// Closing migrated clients and removing copied migration directories can take
// about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

async function journal() {
  // SAFETY: `_journal.json` is the checked-in Drizzle journal and the prefix
  // builder validates its terminal index before using any entry.
  return JSON.parse(
    await readFile(`${defaultMigrationsFolder}/meta/_journal.json`, "utf8"),
  ) as Journal;
}

async function migrationPrefix(lastIndex: number) {
  const sourceJournal = await journal();
  const entries = sourceJournal.entries.filter(
    (entry) => entry.idx <= lastIndex,
  );
  expect(entries.at(-1)?.idx).toBe(lastIndex);

  const directory = await mkdtemp(join(tmpdir(), "avermate-migrations-"));
  temporaryDirectories.push(directory);
  await mkdir(join(directory, "meta"));
  await writeFile(
    join(directory, "meta", "_journal.json"),
    `${JSON.stringify({ ...sourceJournal, entries }, null, 2)}\n`,
  );
  await Promise.all(
    entries.map((entry) =>
      copyFile(
        join(defaultMigrationsFolder, `${entry.tag}.sql`),
        join(directory, `${entry.tag}.sql`),
      ),
    ),
  );
  return directory;
}

async function clientAt(lastIndex: number) {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await migrateClient(client, await migrationPrefix(lastIndex));
  return client;
}

async function seedOwner(client: Client, suffix: string) {
  const userId = `user-${suffix}`;
  const yearId = `year-${suffix}`;
  await client.executeMultiple(`
    INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt)
    VALUES ('${userId}', 'Synthetic owner', '${suffix}@example.invalid', true, 1, 1);
    INSERT INTO years (id, name, startsAt, endsAt, userId, createdAt, updatedAt)
    VALUES ('${yearId}', 'Synthetic year', 1, 2, '${userId}', 1, 1);
  `);
  return { userId, yearId };
}

async function expectHealthy(client: Client) {
  expect(
    (await client.execute("PRAGMA integrity_check")).rows[0],
  ).toMatchObject({
    integrity_check: "ok",
  });
  expect((await client.execute("PRAGMA foreign_key_check")).rows).toHaveLength(
    0,
  );
  const sourceJournal = await journal();
  const applied = await client.execute(
    "SELECT COUNT(*) AS count FROM __drizzle_migrations",
  );
  expect(Number(applied.rows[0]?.count)).toBe(sourceJournal.entries.length);
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  for (const directory of temporaryDirectories.splice(0)) {
    await rm(directory, { recursive: true, force: true });
  }
}, databaseHookTimeout);

describe("real migration-prefix upgrades", () => {
  test("upgrades a real pre-0035 database and performs deterministic Better Auth 1.7 backfills", async () => {
    const client = await clientAt(34);
    const { userId, yearId } = await seedOwner(client, "pre-0035");
    await client.executeMultiple(`
      INSERT INTO lecture_recordings (
        id, title, status, recordedAt, durationMs, error,
        subjectId, folderId, yearId, userId, createdAt, updatedAt
      ) VALUES (
        'recording-pre-0035', 'Synthetic recording', 'failed', 1, 10,
        'synthetic failure', NULL, NULL, '${yearId}', '${userId}', 1, 1
      );
      INSERT INTO accounts (
        id, accountId, providerId, userId, password, createdAt, updatedAt
      ) VALUES (
        'credential-row', 'mutable-login@example.invalid', 'credential',
        '${userId}', 'synthetic-hash', 1, 1
      );
      INSERT INTO accounts (
        id, accountId, providerId, userId, createdAt, updatedAt
      ) VALUES (
        'google-row', 'google-stable-sub', 'google', '${userId}', 1, 1
      );
      INSERT INTO oauth_clients (
        id, clientId, clientSecret, redirectUris, tokenEndpointAuthMethod,
        grantTypes, public, type, userId
      ) VALUES
        (
          'public-client-row', 'public-client', NULL, '["avermate://callback"]',
          NULL, '["authorization_code"]', true, 'native', '${userId}'
        ),
        (
          'confidential-client-row', 'confidential-client', 'synthetic-secret',
          '["https://example.invalid/callback"]', NULL,
          '["authorization_code"]', false, 'web', '${userId}'
        );
    `);

    await migrateClient(client);

    expect(
      (
        await client.execute(
          "SELECT id, accountId, issuer FROM accounts ORDER BY id",
        )
      ).rows,
    ).toEqual([
      expect.objectContaining({
        id: "credential-row",
        accountId: userId,
        issuer: "local:credential",
      }),
      expect.objectContaining({
        id: "google-row",
        accountId: "google-stable-sub",
        issuer: "https://accounts.google.com",
      }),
    ]);
    expect(
      (
        await client.execute(`
          SELECT clientId, applicationType, tokenEndpointAuthMethod,
                 clientCredentialsScopes, disabled
          FROM oauth_clients
          ORDER BY clientId
        `)
      ).rows,
    ).toEqual([
      expect.objectContaining({
        clientId: "confidential-client",
        applicationType: "web",
        tokenEndpointAuthMethod: "client_secret_basic",
        clientCredentialsScopes: "[]",
        disabled: 0,
      }),
      expect.objectContaining({
        clientId: "public-client",
        applicationType: "native",
        tokenEndpointAuthMethod: "none",
        clientCredentialsScopes: "[]",
        disabled: 0,
      }),
    ]);
    expect(
      (
        await client.execute(
          "SELECT error, transcriptionRunId FROM lecture_recordings WHERE id = 'recording-pre-0035'",
        )
      ).rows[0],
    ).toMatchObject({
      error: "synthetic failure",
      transcriptionRunId: null,
    });
    await expectHealthy(client);
  });

  test("fails before changing a legacy Microsoft sub without a trusted oid mapping", async () => {
    const client = await clientAt(35);
    const { userId } = await seedOwner(client, "microsoft-cutover");
    await client.execute({
      sql: `
        INSERT INTO accounts (
          id, accountId, providerId, userId, createdAt, updatedAt
        ) VALUES (?, ?, 'microsoft', ?, 1, 1)
      `,
      args: ["legacy-microsoft-row", "pairwise-sub", userId],
    });

    await expect(migrateClient(client)).rejects.toThrow(
      "better_auth_17_microsoft_oid_mapping_required",
    );
    const columns = await client.execute(
      "SELECT name FROM pragma_table_info('accounts') WHERE name = 'issuer'",
    );
    expect(columns.rows).toHaveLength(0);
  });

  test("uses an explicit Entra oid mapping during a pre-0036 upgrade", async () => {
    const client = await clientAt(35);
    const { userId } = await seedOwner(client, "microsoft-mapped");
    await client.execute({
      sql: `
        INSERT INTO accounts (
          id, accountId, providerId, userId, createdAt, updatedAt
        ) VALUES (?, ?, 'microsoft', ?, 1, 1)
      `,
      args: ["mapped-microsoft-row", "pairwise-sub", userId],
    });

    expect(
      await migrateMicrosoftIdentities(client, [
        {
          accountRowId: "mapped-microsoft-row",
          providerId: "microsoft",
          userId,
          expectedLegacyAccountId: "pairwise-sub",
          issuer:
            "https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/v2.0",
          oid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
        },
      ]),
    ).toBe(1);
    expect(
      (
        await client.execute(`
          SELECT accountId, issuer, userId
          FROM accounts WHERE id = 'mapped-microsoft-row'
        `)
      ).rows[0],
    ).toMatchObject({
      accountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      issuer:
        "https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/v2.0",
      userId,
    });
    await expectHealthy(client);
  });

  test("repairs an already-applied 0036 identity atomically and rejects email matching inputs", async () => {
    const client = createClient({ url: ":memory:" });
    clients.push(client);
    await migrateClient(client);
    const { userId } = await seedOwner(client, "microsoft-post-0036");
    await client.execute({
      sql: `
        INSERT INTO accounts (
          id, accountId, providerId, issuer, userId, createdAt, updatedAt
        ) VALUES (?, ?, 'microsoft', 'local:oauth:microsoft', ?, 1, 1)
      `,
      args: ["post-0036-row", "legacy-sub", userId],
    });

    expect(() =>
      parseMicrosoftIdentityMappings([
        {
          accountRowId: "post-0036-row",
          providerId: "microsoft",
          userId,
          expectedLegacyAccountId: "legacy-sub",
          issuer:
            "https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/v2.0",
          oid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          email: "must-not-be-an-identity-key@example.invalid",
        },
      ]),
    ).toThrow();

    await migrateMicrosoftIdentities(client, [
      {
        accountRowId: "post-0036-row",
        providerId: "microsoft",
        userId,
        expectedLegacyAccountId: "legacy-sub",
        issuer:
          "https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/v2.0",
        oid: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      },
    ]);
    expect(
      (
        await client.execute(
          "SELECT accountId, issuer FROM accounts WHERE id = 'post-0036-row'",
        )
      ).rows[0],
    ).toMatchObject({
      accountId: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
      issuer:
        "https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/v2.0",
    });
  });

  test("fails before dropping an OAuth client classification that is ambiguous", async () => {
    const client = await clientAt(35);
    const { userId } = await seedOwner(client, "oauth-review");
    await client.execute({
      sql: `
        INSERT INTO oauth_clients (
          id, clientId, redirectUris, public, type, tokenEndpointAuthMethod,
          userId
        ) VALUES (?, ?, '[]', NULL, 'web', NULL, ?)
      `,
      args: ["ambiguous-row", "ambiguous-client", userId],
    });

    await expect(migrateClient(client)).rejects.toThrow(
      "better_auth_17_oauth_client_review_required",
    );
    const columns = await client.execute(
      "SELECT name FROM pragma_table_info('oauth_clients') WHERE name = 'public'",
    );
    expect(columns.rows).toHaveLength(1);
  });

  test("upgrades a real pre-0038 school connection without recreating a later schema by hand", async () => {
    const client = await clientAt(37);
    const { userId, yearId } = await seedOwner(client, "pre-0038");
    await client.execute({
      sql: `
        INSERT INTO sync_connections (
          id, provider, label, baseUrl, sealedCredentials, capabilities,
          yearId, userId, createdAt, updatedAt
        ) VALUES (?, 'ecoledirecte', 'Synthetic school', ?, ?, ?, ?, ?, 1, 1)
      `,
      args: [
        "connection-pre-0038",
        "https://example.invalid",
        "synthetic-sealed-value",
        '["subjects"]',
        yearId,
        userId,
      ],
    });

    await migrateClient(client);

    expect(
      (
        await client.execute(`
          SELECT id, provider, label, yearId, userId
          FROM sync_connections WHERE id = 'connection-pre-0038'
        `)
      ).rows[0],
    ).toMatchObject({
      id: "connection-pre-0038",
      provider: "ecoledirecte",
      label: "Synthetic school",
      yearId,
      userId,
    });
    await expectHealthy(client);
  });

  test("upgrades a real pre-0046 materials database and preserves legacy artifact projections", async () => {
    const client = await clientAt(45);
    const { userId, yearId } = await seedOwner(client, "pre-0046");
    await client.executeMultiple(`
      INSERT INTO files (
        id, storageKey, url, mimeType, byteSize, purpose,
        userId, createdAt, updatedAt
      ) VALUES
        (
          'pdf-file', 'synthetic/pdf', 'https://example.invalid/file.pdf',
          'application/pdf', 10, 'generated-document', '${userId}', 1, 1
        ),
        (
          'pptx-file', 'synthetic/pptx', 'https://example.invalid/file.pptx',
          'application/vnd.openxmlformats-officedocument.presentationml.presentation',
          10, 'generated-document', '${userId}', 1, 1
        );
      INSERT INTO material_folders (
        id, name, sortOrder, yearId, userId, createdAt, updatedAt
      ) VALUES ('folder-pre-0046', 'Synthetic folder', 0, '${yearId}', '${userId}', 1, 1);
      INSERT INTO material_documents (
        id, title, folderId, yearId, userId, createdAt, updatedAt
      ) VALUES (
        'material-pre-0046', 'Synthetic material', 'folder-pre-0046',
        '${yearId}', '${userId}', 1, 1
      );
      INSERT INTO study_documents (
        id, title, yearId, userId, createdAt, updatedAt
      ) VALUES (
        'document-pre-0046', 'Synthetic document', '${yearId}', '${userId}', 1, 1
      );
      INSERT INTO lecture_recordings (
        id, title, recordedAt, durationMs, yearId, userId, createdAt, updatedAt
      ) VALUES (
        'recording-pre-0046', 'Synthetic recording', 1, 10,
        '${yearId}', '${userId}', 1, 1
      );
      INSERT INTO study_document_builds (
        id, documentId, revision, status, pdfFileId, log,
        userId, createdAt, updatedAt
      ) VALUES (
        'build-pre-0046', 'document-pre-0046', 1, 'succeeded', 'pdf-file',
        'synthetic build', '${userId}', 1, 2
      );
      INSERT INTO study_document_exports (
        documentId, revision, fileId, userId, createdAt, updatedAt
      ) VALUES (
        'document-pre-0046', 2, 'pptx-file', '${userId}', 3, 4
      );
    `);

    await migrateClient(client);

    const preserved = await client.execute(`
      SELECT 'lecture_recordings' AS owner, id, deletedBatchId
      FROM lecture_recordings WHERE id = 'recording-pre-0046'
      UNION ALL
      SELECT 'material_documents', id, deletedBatchId
      FROM material_documents WHERE id = 'material-pre-0046'
      UNION ALL
      SELECT 'material_folders', id, deletedBatchId
      FROM material_folders WHERE id = 'folder-pre-0046'
      UNION ALL
      SELECT 'study_documents', id, deletedBatchId
      FROM study_documents WHERE id = 'document-pre-0046'
      ORDER BY owner
    `);
    expect(preserved.rows).toHaveLength(4);
    expect(preserved.rows.every((row) => row.deletedBatchId === null)).toBe(
      true,
    );
    expect(
      (
        await client.execute(`
          SELECT kind, sourceRevision, status, fileId, log
          FROM document_artifacts
          WHERE documentId = 'document-pre-0046'
          ORDER BY kind
        `)
      ).rows,
    ).toEqual([
      expect.objectContaining({
        kind: "pdf",
        sourceRevision: 1,
        status: "succeeded",
        fileId: "pdf-file",
        log: "synthetic build",
      }),
      expect.objectContaining({
        kind: "pptx",
        sourceRevision: 2,
        status: "succeeded",
        fileId: "pptx-file",
        log: null,
      }),
    ]);
    await expectHealthy(client);
  });

  test("applies 0054 without losing feedback, groups or their child rows", async () => {
    const client = await clientAt(53);
    const { userId, yearId } = await seedOwner(client, "pre-0054");
    await client.executeMultiple(`
      INSERT INTO users (id, name, email, emailVerified, createdAt, updatedAt)
      VALUES (
        'feedback-assignee', 'Synthetic assignee',
        'feedback-assignee@example.invalid', true, 1, 1
      );
      INSERT INTO accounts (
        id, accountId, providerId, issuer, userId, password, createdAt, updatedAt
      ) VALUES (
        'credential-pre-0054', 'mutable-login@example.invalid', 'credential',
        'local:credential', '${userId}', 'synthetic-hash', 1, 1
      );
      INSERT INTO feedback (
        id, subject, message, assignedToUserId, lastSeenAt,
        userId, createdAt, updatedAt
      ) VALUES (
        'feedback-pre-0054', 'Synthetic subject', 'Synthetic message',
        'feedback-assignee', 7, '${userId}', 1, 2
      );
      INSERT INTO feedback_comments (
        id, feedbackId, authorUserId, body, createdAt, updatedAt
      ) VALUES (
        'comment-pre-0054', 'feedback-pre-0054', '${userId}',
        'Synthetic comment', 1, 2
      );
      INSERT INTO social_groups (
        id, ownerUserId, name, sharedSetupYearId, createdAt, updatedAt
      ) VALUES (
        'group-pre-0054', '${userId}', 'Synthetic group', '${yearId}', 1, 2
      );
      INSERT INTO group_memberships (
        id, groupId, userId, yearId, createdAt, updatedAt
      ) VALUES (
        'membership-pre-0054', 'group-pre-0054', '${userId}', '${yearId}', 1, 2
      );
      INSERT INTO oauth_clients (
        id, clientId, clientSecret, redirectUris, tokenEndpointAuthMethod,
        applicationType, grantTypes, clientCredentialsScopes, userId
      ) VALUES
        (
          'recoverable-confidential-row', 'recoverable-confidential',
          'synthetic-secret', '[]', NULL, 'web', '["authorization_code"]',
          NULL, '${userId}'
        ),
        (
          'ambiguous-public-row', 'ambiguous-public', NULL, '[]', NULL,
          'native', '["authorization_code"]', NULL, '${userId}'
        ),
        (
          'machine-scope-row', 'machine-scope-review', 'synthetic-secret',
          '[]', 'client_secret_basic', 'web', '["client_credentials"]',
          NULL, '${userId}'
        ),
        (
          'valid-public-row', 'valid-public', NULL, '[]', 'none', 'native',
          '["authorization_code"]', NULL, '${userId}'
        );
    `);

    await migrateClient(client);

    expect(
      (
        await client.execute(`
          SELECT id, assignedToUserId, lastSeenAt
          FROM feedback WHERE id = 'feedback-pre-0054'
        `)
      ).rows[0],
    ).toMatchObject({
      id: "feedback-pre-0054",
      assignedToUserId: "feedback-assignee",
      lastSeenAt: 7,
    });
    expect(
      (
        await client.execute(
          "SELECT feedbackId FROM feedback_comments WHERE id = 'comment-pre-0054'",
        )
      ).rows[0],
    ).toMatchObject({ feedbackId: "feedback-pre-0054" });
    expect(
      (
        await client.execute(
          "SELECT sharedSetupYearId FROM social_groups WHERE id = 'group-pre-0054'",
        )
      ).rows[0],
    ).toMatchObject({ sharedSetupYearId: yearId });
    expect(
      (
        await client.execute(
          "SELECT groupId FROM group_memberships WHERE id = 'membership-pre-0054'",
        )
      ).rows[0],
    ).toMatchObject({ groupId: "group-pre-0054" });
    expect(
      (
        await client.execute(
          "SELECT accountId, issuer FROM accounts WHERE id = 'credential-pre-0054'",
        )
      ).rows[0],
    ).toMatchObject({ accountId: userId, issuer: "local:credential" });
    expect(
      (
        await client.execute(`
          SELECT clientId, tokenEndpointAuthMethod, clientCredentialsScopes,
                 disabled
          FROM oauth_clients
          WHERE clientId IN (
            'recoverable-confidential', 'ambiguous-public',
            'machine-scope-review', 'valid-public'
          )
          ORDER BY clientId
        `)
      ).rows,
    ).toEqual([
      expect.objectContaining({
        clientId: "ambiguous-public",
        tokenEndpointAuthMethod: null,
        clientCredentialsScopes: "[]",
        disabled: 1,
      }),
      expect.objectContaining({
        clientId: "machine-scope-review",
        tokenEndpointAuthMethod: "client_secret_basic",
        clientCredentialsScopes: "[]",
        disabled: 1,
      }),
      expect.objectContaining({
        clientId: "recoverable-confidential",
        tokenEndpointAuthMethod: "client_secret_basic",
        clientCredentialsScopes: "[]",
        disabled: 0,
      }),
      expect.objectContaining({
        clientId: "valid-public",
        tokenEndpointAuthMethod: "none",
        clientCredentialsScopes: "[]",
        disabled: 0,
      }),
    ]);

    await client.execute("DELETE FROM users WHERE id = 'feedback-assignee'");
    expect(
      (
        await client.execute(
          "SELECT assignedToUserId FROM feedback WHERE id = 'feedback-pre-0054'",
        )
      ).rows[0],
    ).toMatchObject({ assignedToUserId: null });
    await client.execute({
      sql: "UPDATE years SET id = ? WHERE id = ?",
      args: ["year-pre-0054-renamed", yearId],
    });
    expect(
      (
        await client.execute(
          "SELECT sharedSetupYearId FROM social_groups WHERE id = 'group-pre-0054'",
        )
      ).rows[0],
    ).toMatchObject({ sharedSetupYearId: "year-pre-0054-renamed" });
    await expect(
      client.execute({
        sql: `
          INSERT INTO feedback (
            id, subject, message, userId, createdAt, updatedAt
          ) VALUES (?, 'No timestamp', 'Must fail', ?, 1, 1)
        `,
        args: ["feedback-without-last-seen", userId],
      }),
    ).rejects.toThrow();
    await expectHealthy(client);
  });

  test("upgrades a populated 0060 agent database with deterministic agent backfills and controlled payload rewrites", async () => {
    const client = await clientAt(60);
    const { userId, yearId } = await seedOwner(client, "pre-0061-agent");
    await client.executeMultiple(`
      INSERT INTO study_projects (
        id, userId, title, yearId, createdAt, updatedAt
      ) VALUES (
        'project-pre-0061', '${userId}', 'Synthetic project', '${yearId}', 1, 2
      );
      INSERT INTO assistant_threads (
        id, userId, title, projectId, createdAt, updatedAt
      ) VALUES (
        'thread-pre-0061', '${userId}', 'Synthetic thread',
        'project-pre-0061', 1, 2
      );
      INSERT INTO assistant_branches (
        id, threadId, name, createdAt, updatedAt
      ) VALUES (
        'branch-pre-0061', 'thread-pre-0061', 'main', 1, 2
      );
      INSERT INTO assistant_messages (
        id, threadId, role, authorship, status, partsJson, createdAt
      ) VALUES (
        'message-pre-0061', 'thread-pre-0061', 'user', 'user',
        'complete', '[]', 1
      );
      INSERT INTO assistant_runs (
        id, userId, threadId, branchId, inputMessageId,
        reservedOutputMessageId, clientRequestId, runtimeId, runtimeVersion,
        graphSchemaVersion, modelKey, providerKey, status,
        providerDispatchState, sandboxRuntimeCheckpointRef, createdAt, updatedAt
      ) VALUES (
        'run-pre-0061', '${userId}', 'thread-pre-0061', 'branch-pre-0061',
        'message-pre-0061', 'reserved-output-pre-0061', 'request-pre-0061',
        'legacy-runtime', '0.1.0', 1, 'legacy-model', 'legacy-provider',
        'running', 'acknowledged', 'provider-checkpoint-pre-0061', 1, 2
      );
      INSERT INTO assistant_usage (
        runId, providerKey, modelKey, inputTokens, outputTokens,
        estimatedCost, currency, final, createdAt
      ) VALUES (
        'run-pre-0061', 'legacy-provider', 'legacy-model', 12, 4,
        '0.01', 'EUR', true, 2
      );
      INSERT INTO content_sources (
        id, userId, yearId, originKind, originId, status, coverage,
        createdAt, updatedAt
      ) VALUES (
        'source-pre-0061', '${userId}', '${yearId}', 'conversation',
        'thread-pre-0061', 'ready', 'searchable-native-text', 1, 2
      );
      INSERT INTO study_project_items (
        id, projectId, kind, referenceId, position, contextMode, addedAt
      ) VALUES (
        'item-pre-0061', 'project-pre-0061', 'conversation',
        'thread-pre-0061', 0, 'include', 2
      );
    `);

    await migrateClient(client);

    expect(
      (
        await client.execute(`
          SELECT runtimeProtocolVersion, modelRevision, providerRevision,
                 modelPlacementJson, policyRevision, modelPolicyJson,
                 toolCatalogRevision, contextManifestDigest,
                 branchIdentityDigest, sandboxRuntimeCheckpointRef,
                 cancellationRequestedAt, cancellationReason, terminalReason
          FROM assistant_runs WHERE id = 'run-pre-0061'
        `)
      ).rows[0],
    ).toMatchObject({
      runtimeProtocolVersion: 1,
      modelRevision: "legacy/1",
      providerRevision: "legacy/1",
      modelPlacementJson: '{"kind":"core","instanceId":"legacy"}',
      policyRevision: "assistant-policy/1",
      modelPolicyJson: null,
      toolCatalogRevision: "legacy/1",
      contextManifestDigest: null,
      branchIdentityDigest: null,
      sandboxRuntimeCheckpointRef: "provider-checkpoint-pre-0061",
      cancellationRequestedAt: null,
      cancellationReason: null,
      terminalReason: null,
    });
    expect(
      (
        await client.execute(`
          SELECT providerRevision, modelRevision, usageVersion, source,
                 inputTokens, outputTokens, estimatedCost, currency, final
          FROM assistant_usage WHERE runId = 'run-pre-0061'
        `)
      ).rows[0],
    ).toMatchObject({
      providerRevision: "legacy/1",
      modelRevision: "legacy/1",
      usageVersion: 1,
      source: "unknown",
      inputTokens: 12,
      outputTokens: 4,
      estimatedCost: "0.01",
      currency: "EUR",
      final: 1,
    });
    expect(
      (
        await client.execute(`
          SELECT retrievalMode, retrievalFallbackPolicy,
                 embeddingSpaceId, rerankSpaceId
          FROM study_projects WHERE id = 'project-pre-0061'
        `)
      ).rows[0],
    ).toMatchObject({
      retrievalMode: "lexical-only",
      retrievalFallbackPolicy: "lexical-only",
      embeddingSpaceId: null,
      rerankSpaceId: null,
    });
    expect(
      (
        await client.execute(`
          SELECT sourceVersionId, conversationBranchId,
                 conversationHeadMessageId, trackingMode,
                 selectorReviewRequired
          FROM study_project_items WHERE id = 'item-pre-0061'
        `)
      ).rows[0],
    ).toMatchObject({
      sourceVersionId: null,
      conversationBranchId: null,
      conversationHeadMessageId: null,
      trackingMode: "pinned",
      selectorReviewRequired: 1,
    });
    const retainedTriggers = await client.execute(`
      SELECT name FROM sqlite_master
      WHERE type = 'trigger' AND name IN (
        'assistant_messages_links_insert',
        'assistant_messages_immutable_update',
        'assistant_runs_links_insert',
        'assistant_runs_links_update',
        'assistant_run_events_append_only',
        'assistant_run_events_immutable_update',
        'assistant_proof_handles_validate_insert',
        'assistant_citations_validate_insert',
        'assistant_checkpoints_validate_insert',
        'assistant_outbox_validate_insert',
        'study_projects_scope_insert',
        'study_projects_scope_update',
        'study_project_items_scope_insert',
        'study_project_items_scope_update',
        'assistant_threads_project_owner_insert',
        'assistant_threads_project_owner_update',
        'assistant_attachments_validate_insert'
      )
      ORDER BY name
    `);
    expect(retainedTriggers.rows).toHaveLength(17);

    await expect(
      client.execute(`UPDATE assistant_messages SET partsJson = '[1]'
        WHERE id = 'message-pre-0061'`),
    ).rejects.toThrow("assistant messages are immutable");
    await client.execute({
      sql: `INSERT INTO placement_migrations
        (id, accountId, resourceKind, resourceId, sourcePlacementJson,
         destinationPlacementJson, state, copiedBytes, idempotencyKey,
         createdAt, updatedAt)
        VALUES ('migration-payload-core', ?, 'conversations', 'revision-core',
          '{"kind":"core"}', '{"kind":"node","nodeId":"node-a"}',
          'copying', '0', 'migration-payload-core', 3, 3)`,
      args: [userId],
    });
    await expect(
      client.execute(`UPDATE assistant_messages SET partsJson = '[1]'
        WHERE id = 'message-pre-0061'`),
    ).resolves.toMatchObject({ rowsAffected: 1 });
    await client.execute(`UPDATE placement_migrations SET state = 'verifying'
      WHERE id = 'migration-payload-core'`);
    await expect(
      client.execute(`UPDATE assistant_messages SET partsJson = '[2]'
        WHERE id = 'message-pre-0061'`),
    ).rejects.toThrow("assistant messages are immutable");

    await client.executeMultiple(`
      INSERT INTO assistant_threads (
        id, userId, title, placement, placementRef, createdAt, updatedAt
      ) VALUES (
        'thread-node-0062', '${userId}', 'Node thread', 'node', 'node-a', 3, 3
      );
      INSERT INTO assistant_branches (
        id, threadId, name, createdAt, updatedAt
      ) VALUES (
        'branch-node-0062', 'thread-node-0062', 'main', 3, 3
      );
      INSERT INTO assistant_messages (
        id, threadId, role, authorship, status, partsJson, createdAt
      ) VALUES (
        'message-node-0062', 'thread-node-0062', 'user', 'user',
        'complete', '[]', 3
      );
      INSERT INTO assistant_runs (
        id, userId, threadId, branchId, inputMessageId,
        reservedOutputMessageId, clientRequestId, runtimeId, runtimeVersion,
        graphSchemaVersion, modelKey, providerKey, status,
        providerDispatchState, createdAt, updatedAt
      ) VALUES (
        'run-node-0062', '${userId}', 'thread-node-0062', 'branch-node-0062',
        'message-node-0062', 'reserved-output-node-0062', 'request-node-0062',
        'runtime-node', '1.0.0', 1, 'model-node', 'provider-node',
        'running', 'acknowledged', 3, 3
      );
      INSERT INTO assistant_run_events (
        id, runId, sequence, eventId, type, payloadJson,
        terminal, emittedAt, persistedAt
      ) VALUES (
        'event-node-0062', 'run-node-0062', 1, 'event-id-node-0062',
        'avermate.status', '{"phase":"before"}', 0, 3, 3
      );
    `);
    await expect(
      client.execute(`UPDATE assistant_run_events
        SET payloadJson = '{"phase":"forbidden"}'
        WHERE id = 'event-node-0062'`),
    ).rejects.toThrow("assistant run events are append-only");
    await client.execute({
      sql: `INSERT INTO placement_migrations
        (id, accountId, resourceKind, resourceId, sourcePlacementJson,
         destinationPlacementJson, state, copiedBytes, idempotencyKey,
         createdAt, updatedAt)
        VALUES ('migration-payload-node', ?, 'conversations', 'revision-node',
          '{"kind":"node","nodeId":"node-a"}', '{"kind":"core"}',
          'copying', '0', 'migration-payload-node', 4, 4)`,
      args: [userId],
    });
    await expect(
      client.execute(`UPDATE assistant_run_events
        SET payloadJson = '{"phase":"rewritten"}'
        WHERE id = 'event-node-0062'`),
    ).resolves.toMatchObject({ rowsAffected: 1 });

    await client.execute({
      sql: `INSERT INTO content_versions (
          id, sourceId, versionKey, contentHash, extractorId,
          extractorVersion, locatorSchemaVersion, metadataJson, createdAt
        ) VALUES ('version-node-0063', 'source-pre-0061', 'v1', ?,
          'fixture', '1', 1, '{}', 5)`,
      args: ["a".repeat(64)],
    });
    await client.execute({
      sql: `INSERT INTO content_chunks (
          id, versionId, ordinal, text, normalizedText, tokenEstimate,
          contentHash, locatorJson, headingPathJson, evidenceKind, createdAt
        ) VALUES ('chunk-node-0063', 'version-node-0063', 0,
          'plain before migration', 'plain before migration', 4, ?,
          '{"kind":"text","startOffset":0,"endOffset":22}',
          '["Cours"]', 'native-text', 5)`,
      args: ["b".repeat(64)],
    });
    await expect(
      client.execute(`UPDATE content_chunks SET text = 'forbidden'
        WHERE id = 'chunk-node-0063'`),
    ).rejects.toThrow("content chunks are immutable");
    await client.execute({
      sql: `INSERT INTO corpus_payload_rewrite_leases (
          id, userId, sourceId, sourcePlacement, sourceNodeId,
          destinationPlacement, destinationNodeId, expiresAt, createdAt
        ) VALUES ('lease-core-0063', ?, 'source-pre-0061', 'core', NULL,
          'node', 'node-a', 4102444800, 5)`,
      args: [userId],
    });
    await expect(
      client.execute(`UPDATE content_chunks SET text = 'sealed payload',
          normalizedText = 'sealed remainder', headingPathJson = NULL
        WHERE id = 'chunk-node-0063'`),
    ).resolves.toMatchObject({ rowsAffected: 1 });
    await expect(
      client.execute(`UPDATE content_chunks SET ordinal = 1
        WHERE id = 'chunk-node-0063'`),
    ).rejects.toThrow("content chunks are immutable");
    await client.execute(`DELETE FROM corpus_payload_rewrite_leases
      WHERE id = 'lease-core-0063'`);
    await client.execute(`UPDATE content_sources
      SET placement = 'node', placementRef = 'node-a'
      WHERE id = 'source-pre-0061'`);
    await client.execute({
      sql: `INSERT INTO corpus_payload_rewrite_leases (
          id, userId, sourceId, sourcePlacement, sourceNodeId,
          destinationPlacement, destinationNodeId, expiresAt, createdAt
        ) VALUES ('lease-wrong-source-0063', ?, 'source-pre-0061', 'core', NULL,
          'node', 'node-b', 4102444800, 6)`,
      args: [userId],
    });
    await expect(
      client.execute(`UPDATE content_chunks SET text = 'wrong lease'
        WHERE id = 'chunk-node-0063'`),
    ).rejects.toThrow("content chunks are immutable");
    await client.execute(`DELETE FROM corpus_payload_rewrite_leases
      WHERE id = 'lease-wrong-source-0063'`);
    await expectHealthy(client);
  });
});
