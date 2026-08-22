import { createClient, type Client } from "@libsql/client";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { migrateClient } from "./migrate";

type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

const guid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeMicrosoftIssuer(value: string) {
  const issuer = new URL(value);
  if (
    issuer.protocol !== "https:" ||
    issuer.hostname !== "login.microsoftonline.com" ||
    issuer.username ||
    issuer.password ||
    issuer.search ||
    issuer.hash
  ) {
    throw new Error(
      "Microsoft issuer must be a trusted login.microsoftonline.com HTTPS URL.",
    );
  }
  const match = issuer.pathname.match(/^\/([^/]+)\/v2\.0\/?$/);
  if (!match || !guid.test(match[1]!)) {
    throw new Error(
      "Microsoft issuer must contain the verified Entra tenant GUID and /v2.0.",
    );
  }
  return `https://login.microsoftonline.com/${match[1]!.toLowerCase()}/v2.0`;
}

function isTrustedMicrosoftIssuer(value: string) {
  try {
    return normalizeMicrosoftIssuer(value) === value;
  } catch {
    return false;
  }
}

const microsoftIdentityMappingSchema = z
  .object({
    accountRowId: z.string().min(1),
    providerId: z.enum(["microsoft", "microsoft-entra-id"]),
    userId: z.string().min(1),
    expectedLegacyAccountId: z.string().min(1),
    issuer: z.string().url(),
    oid: z.string().regex(guid),
  })
  .strict()
  .transform((mapping) => ({
    ...mapping,
    issuer: normalizeMicrosoftIssuer(mapping.issuer),
    oid: mapping.oid.toLowerCase(),
  }));

const microsoftIdentityMappingsSchema = z
  .array(microsoftIdentityMappingSchema)
  .min(1)
  .superRefine((mappings, context) => {
    const rows = new Set<string>();
    const targets = new Set<string>();
    for (const [index, mapping] of mappings.entries()) {
      if (rows.has(mapping.accountRowId)) {
        context.addIssue({
          code: "custom",
          message: "Every Better Auth account row may appear only once.",
          path: [index, "accountRowId"],
        });
      }
      rows.add(mapping.accountRowId);

      const target = `${mapping.issuer}\0${mapping.oid}`;
      if (targets.has(target)) {
        context.addIssue({
          code: "custom",
          message: "Every Microsoft issuer/oid target may appear only once.",
          path: [index, "oid"],
        });
      }
      targets.add(target);
    }
  });

export type MicrosoftIdentityMapping = z.infer<
  typeof microsoftIdentityMappingSchema
>;

export function parseMicrosoftIdentityMappings(value: JsonValue) {
  return microsoftIdentityMappingsSchema.parse(value);
}

async function accountsHaveIssuer(client: Client) {
  const result = await client.execute(
    "SELECT 1 FROM pragma_table_info('accounts') WHERE name = 'issuer' LIMIT 1",
  );
  return result.rows.length > 0;
}

async function verifySourceAccount(
  client: Pick<Client, "execute">,
  mapping: MicrosoftIdentityMapping,
  withIssuer: boolean,
) {
  const result = await client.execute({
    sql: `
      SELECT id, accountId, providerId, userId${withIssuer ? ", issuer" : ""}
      FROM accounts
      WHERE id = ?
      LIMIT 1
    `,
    args: [mapping.accountRowId],
  });
  const row = result.rows[0];
  if (
    !row ||
    row.accountId !== mapping.expectedLegacyAccountId ||
    row.providerId !== mapping.providerId ||
    row.userId !== mapping.userId
  ) {
    throw new Error(
      `Microsoft identity source mismatch for account row ${mapping.accountRowId}.`,
    );
  }
  if (
    withIssuer &&
    row.issuer !== null &&
    isTrustedMicrosoftIssuer(String(row.issuer))
  ) {
    throw new Error(
      `Account row ${mapping.accountRowId} already has a trusted issuer; refusing to overwrite it.`,
    );
  }
}

async function assertNoTargetCollision(
  client: Pick<Client, "execute">,
  mapping: MicrosoftIdentityMapping,
) {
  const collision = await client.execute({
    sql: `
      SELECT id
      FROM accounts
      WHERE issuer = ? AND accountId = ? AND id != ?
      LIMIT 1
    `,
    args: [mapping.issuer, mapping.oid, mapping.accountRowId],
  });
  if (collision.rows.length > 0) {
    throw new Error(
      `Microsoft identity target collision for account row ${mapping.accountRowId}.`,
    );
  }
}

async function stagePre17Mappings(
  client: Client,
  mappings: MicrosoftIdentityMapping[],
) {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS __better_auth_17_trusted_identity_mappings (
      accountRowId text PRIMARY KEY NOT NULL,
      providerId text NOT NULL,
      userId text NOT NULL,
      legacyAccountId text NOT NULL,
      issuer text NOT NULL,
      accountId text NOT NULL
    )
  `);

  for (const mapping of mappings) {
    await verifySourceAccount(client, mapping, false);
  }
  await client.batch(
    mappings.map((mapping) => ({
      sql: `
          INSERT INTO __better_auth_17_trusted_identity_mappings (
            accountRowId, providerId, userId, legacyAccountId, issuer, accountId
          ) VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(accountRowId) DO UPDATE SET
            providerId = excluded.providerId,
            userId = excluded.userId,
            legacyAccountId = excluded.legacyAccountId,
            issuer = excluded.issuer,
            accountId = excluded.accountId
        `,
      args: [
        mapping.accountRowId,
        mapping.providerId,
        mapping.userId,
        mapping.expectedLegacyAccountId,
        mapping.issuer,
        mapping.oid,
      ],
    })),
    "write",
  );
}

async function updatePost17Accounts(
  client: Client,
  mappings: MicrosoftIdentityMapping[],
) {
  for (const mapping of mappings) {
    await verifySourceAccount(client, mapping, true);
    await assertNoTargetCollision(client, mapping);
  }

  await client.batch(
    [
      {
        sql: `
          CREATE TEMP TABLE __better_auth_17_update_guard (
            changed integer NOT NULL,
            CONSTRAINT better_auth_17_expected_account_update CHECK (changed = 1)
          )
        `,
        args: [],
      },
      ...mappings.flatMap((mapping) => [
        {
          sql: `
          UPDATE accounts
          SET accountId = ?, issuer = ?, updatedAt = ?
          WHERE id = ?
            AND accountId = ?
            AND providerId = ?
            AND userId = ?
            AND issuer NOT LIKE 'https://login.microsoftonline.com/%/v2.0'
        `,
          args: [
            mapping.oid,
            mapping.issuer,
            Math.floor(Date.now() / 1_000),
            mapping.accountRowId,
            mapping.expectedLegacyAccountId,
            mapping.providerId,
            mapping.userId,
          ],
        },
        {
          sql: `
            INSERT INTO __better_auth_17_update_guard (changed)
            VALUES (changes())
          `,
          args: [],
        },
      ]),
      {
        sql: "DROP TABLE __better_auth_17_update_guard",
        args: [],
      },
    ],
    "write",
  );
}

export async function migrateMicrosoftIdentities(
  client: Client,
  input: JsonValue,
) {
  const mappings = parseMicrosoftIdentityMappings(input);
  if (await accountsHaveIssuer(client)) {
    await migrateClient(client);
    await updatePost17Accounts(client, mappings);
  } else {
    await stagePre17Mappings(client, mappings);
    await migrateClient(client);
  }

  for (const mapping of mappings) {
    const migrated = await client.execute({
      sql: `
        SELECT id
        FROM accounts
        WHERE id = ? AND userId = ? AND providerId = ?
          AND issuer = ? AND accountId = ?
      `,
      args: [
        mapping.accountRowId,
        mapping.userId,
        mapping.providerId,
        mapping.issuer,
        mapping.oid,
      ],
    });
    if (migrated.rows.length !== 1) {
      const actual = await client.execute({
        sql: "SELECT id, accountId, providerId, issuer, userId FROM accounts WHERE id = ?",
        args: [mapping.accountRowId],
      });
      throw new Error(
        `Microsoft identity verification failed for account row ${mapping.accountRowId}: ${JSON.stringify(actual.rows[0] ?? null)}.`,
      );
    }
  }

  return mappings.length;
}

async function main() {
  const mappingFile = process.argv[2];
  if (!mappingFile) {
    throw new Error(
      "Usage: bun scripts/migrate-microsoft-identities.ts <trusted-entra-mapping.json>",
    );
  }
  const input: JsonValue = JSON.parse(await readFile(mappingFile, "utf8"));
  const client = createClient({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
    authToken: process.env.DATABASE_AUTH_TOKEN,
  });
  try {
    const count = await migrateMicrosoftIdentities(client, input);
    console.info(`Migrated ${count} Microsoft account identity mapping(s).`);
  } finally {
    client.close();
  }
}

if (import.meta.main) await main();
