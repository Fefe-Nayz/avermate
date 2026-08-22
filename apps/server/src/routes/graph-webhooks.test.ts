import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const testDirectory = mkdtempSync(join(tmpdir(), "avermate-graph-webhook-"));
const databasePath = join(testDirectory, "graph.db").replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${databasePath}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_JOBS = "true";

let routes: typeof import("./graph-webhooks").graphWebhookRoutes;
let createRoutes: typeof import("./graph-webhooks").createGraphWebhookRoutes;
let db: typeof import("../db").db;
let schema: typeof import("../db/schema");
let seal: typeof import("../lib/crypto").seal;
let stateHash: typeof import("../lib/onedrive").oneDriveOauthStateHash;
let webhookHash: typeof import("../lib/onedrive").oneDriveWebhookSecretHash;

const userId = "graph-route-user";
const yearId = "graph-route-year";
const fixedNow = new Date("2026-08-21T12:00:00.000Z");

beforeAll(async () => {
  ({ db } = await import("../db"));
  schema = await import("../db/schema");
  ({ seal } = await import("../lib/crypto"));
  ({
    oneDriveOauthStateHash: stateHash,
    oneDriveWebhookSecretHash: webhookHash,
  } = await import("../lib/onedrive"));
  ({ graphWebhookRoutes: routes, createGraphWebhookRoutes: createRoutes } =
    await import("./graph-webhooks"));
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
    name: "Graph route test",
    email: "graph-route@example.test",
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
    provider: "onedrive",
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
    kind: "connectors.onedrive.sync",
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

describe("Microsoft Graph webhook ingress", () => {
  test("echoes the validation token as plain text", async () => {
    const response = await routes.request(
      "/webhooks/graph?validationToken=opaque%20token",
      { method: "POST" },
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("opaque token");
  });

  test("rejects an oversized chunked body before JSON buffering", async () => {
    const chunk = new Uint8Array(140 * 1024);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const request = new Request("http://localhost/webhooks/graph", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "transfer-encoding": "chunked",
      },
      body,
      // Required by Fetch implementations for streaming request bodies.
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    const response = await routes.fetch(request);
    expect(response.status).toBe(413);
    expect(await response.json()).toEqual({ error: "payload_too_large" });
  });

  test("consumes sealed PKCE state once, rejects expiry/replay and reuses a reconnect", async () => {
    let exchanges = 0;
    const callbackRoutes = createRoutes({
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
            refreshToken: `refresh-${exchanges}`,
            scope: "Files.Read offline_access",
            accountId: "account-1",
            driveId: "drive-1",
          },
        };
      },
      createSubscription: async () => null,
    });

    await oauthState("valid-state", new Date(fixedNow.getTime() + 10 * 60_000));
    const first = await callbackRoutes.request(
      "/connectors/onedrive/callback?state=valid-state&code=authorization-code",
    );
    expect(first.status).toBe(303);
    expect(
      new URL(first.headers.get("location")!).searchParams.get("onedrive"),
    ).toBe("connected");
    expect(exchanges).toBe(1);

    const replay = await callbackRoutes.request(
      "/connectors/onedrive/callback?state=valid-state&code=authorization-code",
    );
    expect(replay.status).toBe(303);
    const replayLocation = new URL(replay.headers.get("location")!);
    expect(replayLocation.searchParams.get("onedrive")).toBe("error");
    expect(replayLocation.searchParams.get("reason")).toBe("state");
    expect(exchanges).toBe(1);

    await oauthState("expired-state", new Date(fixedNow.getTime() - 1));
    const expired = await callbackRoutes.request(
      "/connectors/onedrive/callback?state=expired-state&code=authorization-code",
    );
    expect(
      new URL(expired.headers.get("location")!).searchParams.get("reason"),
    ).toBe("state");
    expect(exchanges).toBe(1);

    await oauthState(
      "reconnect-state",
      new Date(fixedNow.getTime() + 10 * 60_000),
    );
    const reconnect = await callbackRoutes.request(
      "/connectors/onedrive/callback?state=reconnect-state&code=authorization-code",
    );
    expect(reconnect.status).toBe(303);
    const connections = await db
      .select()
      .from(schema.contentConnections)
      .where(
        and(
          eq(schema.contentConnections.userId, userId),
          eq(schema.contentConnections.yearId, yearId),
        ),
      );
    expect(exchanges).toBe(2);
    expect(connections).toHaveLength(1);
    expect(connections[0]?.syncRevision).toBe(1);
    expect(
      await db
        .select()
        .from(schema.contentOauthStates)
        .where(eq(schema.contentOauthStates.userId, userId)),
    ).toHaveLength(0);
  });

  test("ignores unknown/invalid notifications, deduplicates valid ones and NACKs queue failure", async () => {
    const clientState = "valid-client-state";
    await db.insert(schema.contentConnections).values({
      id: "graph-webhook-connection",
      provider: "onedrive",
      accountLabel: "webhook@example.test",
      status: "connected",
      scopeJson: { folderIds: [] },
      sealedCredentials: seal("test-credentials"),
      webhookSecretHash: webhookHash(clientState),
      subscriptionId: "subscription-1",
      subscriptionExpiresAt: new Date(fixedNow.getTime() + 60 * 60_000),
      yearId,
      userId,
      createdAt: fixedNow,
      updatedAt: fixedNow,
    });
    const enqueued: string[] = [];
    const webhookRoutes = createRoutes({
      enqueueSync: async (_ownerId, connectionId) => {
        enqueued.push(connectionId);
        return fakeJob(`job-${connectionId}`);
      },
    });
    const response = await webhookRoutes.request("/webhooks/graph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: [
          { subscriptionId: "unknown", clientState },
          {
            subscriptionId: "subscription-1",
            clientState: "invalid-client-state",
          },
          { subscriptionId: "subscription-1", clientState },
          { subscriptionId: "subscription-1", clientState },
        ],
      }),
    });
    expect(response.status).toBe(202);
    expect(enqueued).toEqual(["graph-webhook-connection"]);

    const unavailableRoutes = createRoutes({
      enqueueSync: async () => {
        throw new Error("queue unavailable");
      },
    });
    const unavailable = await unavailableRoutes.request("/webhooks/graph", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: [{ subscriptionId: "subscription-1", clientState }],
      }),
    });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "queue_unavailable" });
  });
});
