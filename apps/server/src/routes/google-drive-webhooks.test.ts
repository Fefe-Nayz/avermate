import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDirectory = mkdtempSync(join(tmpdir(), "avermate-google-webhook-"));
const databasePath = join(testDirectory, "google-drive.db").replaceAll(
  "\\",
  "/",
);
process.env.DATABASE_URL = `file:${databasePath}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_JOBS = "true";
process.env.GOOGLE_DRIVE_CLIENT_ID = "google-drive-client";
process.env.GOOGLE_DRIVE_CLIENT_SECRET = "google-drive-secret";

let createRoutes: typeof import("./google-drive-webhooks").createGoogleDriveWebhookRoutes;
let db: typeof import("../db").db;
let schema: typeof import("../db/schema");
let seal: typeof import("../lib/crypto").seal;
let stateHash: typeof import("../lib/googledrive").googleDriveOauthStateHash;
let webhookHash: typeof import("../lib/googledrive").googleDriveWebhookTokenHash;

const userId = "google-route-user";
const yearId = "google-route-year";
const fixedNow = new Date("2026-08-21T12:00:00.000Z");

beforeAll(async () => {
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ seal } = await import("../lib/crypto"));
  ({
    googleDriveOauthStateHash: stateHash,
    googleDriveWebhookTokenHash: webhookHash,
  } = await import("../lib/googledrive"));
  ({ createGoogleDriveWebhookRoutes: createRoutes } =
    await import("./google-drive-webhooks"));
  const { registerSharedTestDatabaseLifecycle } =
    await import("../testing/database-lifecycle");
  registerSharedTestDatabaseLifecycle(db.$client, {
    directories: [testDirectory],
  });
  const migrationDirectory = join(import.meta.dir, "../../drizzle");
  const migration = readdirSync(migrationDirectory)
    .filter((file) => /^\d+.*\.sql$/.test(file))
    .sort((left, right) => left.localeCompare(right))
    .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
    .join("\n");
  const migrated = await db.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await db.$client.executeMultiple(migration);
  }
  await db.insert(schema.users).values({
    id: userId,
    name: "Google route test",
    email: "google-route@example.test",
    emailVerified: true,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  });
  await db.insert(schema.years).values({
    id: yearId,
    name: "2026-2027",
    startsAt: new Date("2026-09-01T00:00:00.000Z"),
    endsAt: new Date("2027-07-01T00:00:00.000Z"),
    userId,
  });
}, 30_000);

afterAll(async () => {
  await db.delete(schema.users).where(eq(schema.users.id, userId));
}, 30_000);

async function oauthState(state: string, expiresAt: Date) {
  await db.insert(schema.contentOauthStates).values({
    stateHash: stateHash(state),
    provider: "googledrive",
    sealedVerifier: seal(`verifier:${state}`),
    expiresAt,
    yearId,
    userId,
    createdAt: fixedNow,
  });
}

function fakeJob(id: string) {
  return {
    id,
    kind: "connectors.googledrive.sync",
    payload: null,
    payloadVersion: 1,
    status: "queued" as const,
    attempts: 0,
    maxAttempts: 3,
    runAt: fixedNow,
    lockedUntil: null,
    lockedBy: null,
    idempotencyKey: null,
    result: null,
    error: null,
    userId,
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };
}

describe("Google Drive OAuth and webhook ingress", () => {
  test("consumes sealed PKCE state once and reuses a stable account connection", async () => {
    let exchanges = 0;
    const routes = createRoutes({
      now: () => fixedNow,
      exchangeAuthorizationCode: async (code, verifier) => {
        exchanges += 1;
        expect(code).toBe("authorization-code");
        expect(verifier).toStartWith("verifier:");
        return {
          accountLabel: "ada@example.test",
          credentials: {
            version: 1 as const,
            accessToken: `access-${exchanges}`,
            accessTokenExpiresAt: fixedNow.getTime() + 3_600_000,
            refreshToken: exchanges === 1 ? "refresh-1" : null,
            scope: "https://www.googleapis.com/auth/drive.readonly",
            accountId: "permission-1",
          },
        };
      },
      getStartPageToken: async () => "start-1",
      createChannel: async () => null,
    });

    await oauthState("valid-state", new Date(fixedNow.getTime() + 600_000));
    const first = await routes.request(
      "/connectors/googledrive/callback?state=valid-state&code=authorization-code",
    );
    expect(first.status).toBe(303);
    expect(
      new URL(first.headers.get("location")!).searchParams.get("googledrive"),
    ).toBe("connected");

    const replay = await routes.request(
      "/connectors/googledrive/callback?state=valid-state&code=authorization-code",
    );
    expect(
      new URL(replay.headers.get("location")!).searchParams.get("reason"),
    ).toBe("state");
    expect(exchanges).toBe(1);

    await oauthState("reconnect-state", new Date(fixedNow.getTime() + 600_000));
    const reconnect = await routes.request(
      "/connectors/googledrive/callback?state=reconnect-state&code=authorization-code",
    );
    expect(reconnect.status).toBe(303);
    const connections = await db
      .select()
      .from(schema.contentConnections)
      .where(
        and(
          eq(schema.contentConnections.userId, userId),
          eq(schema.contentConnections.provider, "googledrive"),
        ),
      );
    expect(connections).toHaveLength(1);
    expect(connections[0]?.syncRevision).toBe(1);
    const { parseGoogleDriveCredentials } = await import("../lib/googledrive");
    expect(
      parseGoogleDriveCredentials(connections[0]!.sealedCredentials)
        .refreshToken,
    ).toBe("refresh-1");
  });

  test("rejects expired state before code exchange", async () => {
    let exchanged = false;
    const routes = createRoutes({
      now: () => fixedNow,
      exchangeAuthorizationCode: async () => {
        exchanged = true;
        throw new Error("must not run");
      },
    });
    await oauthState("expired-state", new Date(fixedNow.getTime() - 1));
    const response = await routes.request(
      "/connectors/googledrive/callback?state=expired-state&code=authorization-code",
    );
    expect(
      new URL(response.headers.get("location")!).searchParams.get("reason"),
    ).toBe("state");
    expect(exchanged).toBeFalse();
  });

  test("verifies channel token plus resource id and NACKs a queue failure", async () => {
    const clientToken = "valid-google-channel-token";
    await db.insert(schema.contentConnections).values({
      id: "google-webhook-connection",
      provider: "googledrive",
      accountLabel: "webhook@example.test",
      status: "connected",
      scopeJson: { folderIds: [] },
      sealedCredentials: seal("test-credentials"),
      webhookSecretHash: webhookHash(clientToken),
      subscriptionId: "channel-1",
      subscriptionResourceId: "resource-1",
      subscriptionExpiresAt: new Date(fixedNow.getTime() + 60 * 60_000),
      yearId,
      userId,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
    const enqueued: string[] = [];
    const routes = createRoutes({
      enqueueSync: async (_ownerId, connectionId) => {
        enqueued.push(connectionId);
        return fakeJob(`job-${connectionId}`);
      },
    });
    const request = (token: string, resourceId: string) =>
      routes.request("/webhooks/google-drive", {
        method: "POST",
        headers: {
          "x-goog-channel-id": "channel-1",
          "x-goog-channel-token": token,
          "x-goog-resource-id": resourceId,
          "x-goog-resource-state": "change",
          "x-goog-message-number": "2",
        },
      });
    expect((await request("spoofed", "resource-1")).status).toBe(204);
    expect((await request(clientToken, "spoofed-resource")).status).toBe(204);
    expect(enqueued).toEqual([]);
    expect((await request(clientToken, "resource-1")).status).toBe(204);
    expect(enqueued).toEqual(["google-webhook-connection"]);

    const unavailable = createRoutes({
      enqueueSync: async () => {
        throw new Error("queue unavailable");
      },
    });
    const failed = await unavailable.request("/webhooks/google-drive", {
      method: "POST",
      headers: {
        "x-goog-channel-id": "channel-1",
        "x-goog-channel-token": clientToken,
        "x-goog-resource-id": "resource-1",
        "x-goog-resource-state": "sync",
        "x-goog-message-number": "1",
      },
    });
    expect(failed.status).toBe(503);
  });
});
