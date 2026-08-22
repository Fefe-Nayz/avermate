import { afterEach, describe, expect, test } from "bun:test";
import { createClient, type Client } from "@libsql/client";
import {
  guardMicrosoftIdentityWrite,
  hasUnsafeMicrosoftIdentity,
  isMicrosoftIdentityWrite,
} from "./microsoft-identity-guard";

const clients: Client[] = [];

async function identityClient() {
  const client = createClient({ url: ":memory:" });
  clients.push(client);
  await client.executeMultiple(`
    CREATE TABLE accounts (
      id text PRIMARY KEY NOT NULL,
      accountId text NOT NULL,
      providerId text NOT NULL,
      issuer text NOT NULL,
      userId text NOT NULL
    );
  `);
  return client;
}

afterEach(() => {
  for (const client of clients.splice(0)) client.close();
});

describe("Microsoft Better Auth 1.7 identity guard", () => {
  test("recognizes every Microsoft authentication write, including callbacks", async () => {
    expect(
      await isMicrosoftIdentityWrite(
        new Request("http://localhost/api/auth/sign-in/social", {
          method: "POST",
          body: JSON.stringify({ provider: "microsoft" }),
        }),
      ),
    ).toBe(true);
    expect(
      await isMicrosoftIdentityWrite(
        new Request("http://localhost/api/auth/link-social", {
          method: "POST",
          body: JSON.stringify({ provider: "microsoft" }),
        }),
      ),
    ).toBe(true);
    expect(
      await isMicrosoftIdentityWrite(
        new Request("http://localhost/api/auth/callback/microsoft"),
      ),
    ).toBe(true);
    expect(
      await isMicrosoftIdentityWrite(
        new Request("http://localhost/api/auth/sign-in/social", {
          method: "POST",
          body: JSON.stringify({ provider: "google" }),
        }),
      ),
    ).toBe(false);
  });

  test("blocks legacy synthetic issuers without consulting email", async () => {
    const client = await identityClient();
    await client.execute({
      sql: `
        INSERT INTO accounts (id, accountId, providerId, issuer, userId)
        VALUES (?, ?, 'microsoft', 'local:oauth:microsoft', ?)
      `,
      args: ["account-row", "legacy-sub", "existing-user"],
    });

    expect(await hasUnsafeMicrosoftIdentity(client)).toBe(true);
    const response = await guardMicrosoftIdentityWrite(
      new Request("http://localhost/api/auth/sign-in/social", {
        method: "POST",
        body: JSON.stringify({ provider: "microsoft" }),
      }),
      client,
    );
    expect(response?.status).toBe(503);
    expect(await response?.json()).toEqual({
      error: "microsoft_identity_migration_required",
      message:
        "Microsoft sign-in and account linking are paused until the existing account identity is migrated by an administrator.",
    });
  });

  test("allows Microsoft after an oid and trusted HTTPS issuer are installed", async () => {
    const client = await identityClient();
    await client.execute({
      sql: `
        INSERT INTO accounts (id, accountId, providerId, issuer, userId)
        VALUES (?, ?, 'microsoft', ?, ?)
      `,
      args: [
        "account-row",
        "11111111-2222-3333-4444-555555555555",
        "https://attacker.invalid/tenant-id/v2.0",
        "existing-user",
      ],
    });

    expect(await hasUnsafeMicrosoftIdentity(client)).toBe(true);
    await client.execute({
      sql: "UPDATE accounts SET issuer = ? WHERE id = 'account-row'",
      args: [
        "https://login.microsoftonline.com/11111111-2222-4333-8444-555555555555/v2.0",
      ],
    });
    expect(await hasUnsafeMicrosoftIdentity(client)).toBe(false);
    expect(
      await guardMicrosoftIdentityWrite(
        new Request("http://localhost/api/auth/callback/microsoft"),
        client,
      ),
    ).toBeNull();
  });
});
