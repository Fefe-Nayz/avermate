import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CredentialsRevokedSyncError,
  NonRetryableSyncError,
  RetryableSyncError,
} from "../sync/errors";
import type {
  ProviderDownload,
  ProviderFile,
  SyncProvider,
} from "../sync/provider";
import { registerSharedTestDatabaseLifecycle } from "../testing/database-lifecycle";

const testDirectory = mkdtempSync(join(tmpdir(), "avermate-sync-router-"));
const testDatabasePath = join(testDirectory, "sync.db").replaceAll("\\", "/");
process.env.DATABASE_URL = `file:${testDatabasePath}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "sync-test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.STORAGE_DRIVER = "local";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");

type AppRouter = typeof import("./index").appRouter;
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let runSyncJob: typeof import("../sync/run").runSyncJob;
let materializeProviderDownload: typeof import("../sync/run").materializeProviderDownload;
let enqueueSyncRun: typeof import("../sync/run").enqueueSyncRun;
let syncRunIdempotencyKey: typeof import("../sync/run").syncRunIdempotencyKey;
let syncJobKind: typeof import("../sync/run").SYNC_JOB_KIND;
let jobQueue: typeof import("../lib/jobs");
let registerAllJobHandlers: typeof import("../jobs/handlers").registerAllJobHandlers;
let openCredential: typeof import("../lib/crypto").open;
let sealCredential: typeof import("../lib/crypto").seal;
let providerRegistry: typeof import("../sync/provider").SYNC_PROVIDERS;
let originalProvider: SyncProvider;
let apiA: Api;
let apiB: Api;

const userA = "sync-user-a";
const userB = "sync-user-b";
const yearA = "sync-year-a";
const yearB = "sync-year-b";
const now = new Date("2026-08-20T09:30:00.000Z");
const isolatedJobClock = new Date("2000-01-01T00:00:00.000Z");

async function runExactQueuedJob(
  jobId: string,
  instanceId: string,
  sequence: number,
) {
  const runAt = new Date(isolatedJobClock.getTime() + sequence * 1_000);
  const [queued] = await database
    .update(schema.jobs)
    .set({ runAt })
    .where(and(eq(schema.jobs.id, jobId), eq(schema.jobs.status, "queued")))
    .returning({ id: schema.jobs.id });
  expect(queued?.id).toBe(jobId);

  const result = await jobQueue.runNextJob(instanceId, runAt);
  expect(result?.id).toBe(jobId);
  return result!;
}

function sessionFor(id: string) {
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      image: null,
      role: "user",
      banned: false,
      banReason: null,
      banExpires: null,
      createdAt: now,
      updatedAt: now,
    },
    session: {
      id: `session-${id}`,
      token: `token-${id}`,
      userId: id,
      expiresAt: new Date("2027-12-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  registerSharedTestDatabaseLifecycle(database.$client, {
    directories: [testDirectory],
  });
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  ({
    runSyncJob,
    materializeProviderDownload,
    enqueueSyncRun,
    syncRunIdempotencyKey,
    SYNC_JOB_KIND: syncJobKind,
  } = await import("../sync/run"));
  jobQueue = await import("../lib/jobs");
  ({ registerAllJobHandlers } = await import("../jobs/handlers"));
  ({ open: openCredential, seal: sealCredential } =
    await import("../lib/crypto"));
  ({ SYNC_PROVIDERS: providerRegistry } = await import("../sync/provider"));
  originalProvider = providerRegistry.moodle!;

  await database
    .insert(schema.users)
    .values([
      {
        id: userA,
        name: "Sync A",
        email: "sync-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: "Sync B",
        email: "sync-b@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();
  await database
    .insert(schema.years)
    .values([
      {
        id: yearA,
        name: "Sync year A",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: userA,
      },
      {
        id: yearB,
        name: "Sync year B",
        startsAt: new Date("2026-09-01T00:00:00.000Z"),
        endsAt: new Date("2027-07-01T00:00:00.000Z"),
        userId: userB,
      },
    ])
    .onConflictDoNothing();

  const { appRouter } = await import("./index");
  apiA = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userA) },
  });
  apiB = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userB) },
  });
}, 30_000);

afterAll(async () => {
  if (!providerRegistry) return;
  providerRegistry.moodle = originalProvider;
  await database
    .delete(schema.jobs)
    .where(inArray(schema.jobs.userId, [userA, userB]));
  await database
    .delete(schema.syncedResources)
    .where(inArray(schema.syncedResources.userId, [userA, userB]));
  await database
    .delete(schema.syncConnections)
    .where(inArray(schema.syncConnections.userId, [userA, userB]));
  await database
    .delete(schema.materialDocuments)
    .where(inArray(schema.materialDocuments.userId, [userA, userB]));
  await database
    .delete(schema.materialFolders)
    .where(inArray(schema.materialFolders.userId, [userA, userB]));
  await database
    .delete(schema.files)
    .where(inArray(schema.files.userId, [userA, userB]));
  await database
    .delete(schema.years)
    .where(inArray(schema.years.userId, [userA, userB]));
  await database
    .delete(schema.users)
    .where(inArray(schema.users.id, [userA, userB]));
}, 30_000);

describe("sync router", () => {
  test("advertises all reviewed school adapters in the development runtime", async () => {
    const providers = await apiA.sync.providers();
    expect(providers).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ecoledirecte",
          capabilities: ["homework", "timetable", "grades", "school-calendar"],
          availability: { status: "ready" },
        }),
        expect.objectContaining({
          id: "pronote",
          capabilities: ["homework", "timetable", "grades", "school-calendar"],
          availability: { status: "ready" },
          developmentOnly: true,
        }),
        expect.objectContaining({
          id: "skolengo",
          capabilities: ["homework", "timetable", "grades", "school-calendar"],
          availability: { status: "ready" },
          developmentOnly: true,
        }),
      ]),
    );
    expect(providerRegistry.pronote?.id).toBe("pronote");
    expect(providerRegistry.skolengo?.id).toBe("skolengo");
  });

  test("creates a development-only PRONOTE connection through the generic sealing boundary", async () => {
    const previous = providerRegistry.pronote;
    let createdId: string | null = null;
    providerRegistry.pronote = {
      id: "pronote",
      capabilities: ["homework", "timetable", "school-calendar"],
      school: {
        id: "pronote",
        facets: {
          homework: {
            async list() {
              return [];
            },
          },
          timetable: {
            async list() {
              return [];
            },
          },
          "school-calendar": {
            async list() {
              return [];
            },
          },
        },
      },
      normalizeBaseUrl(input) {
        return input.replace(/\/$/, "");
      },
      async parseCredentialInput(_baseUrl, credentialInput) {
        expect(credentialInput).toContain("temporary-password");
        return {
          credentials: JSON.stringify({ version: 1, token: "device-token" }),
          accountLabel: "Ada — PRONOTE",
        };
      },
      async listCourses() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        return providerDownload("");
      },
    };
    try {
      const created = await apiA.sync.connections.create({
        provider: "pronote",
        yearId: yearA,
        baseUrl: "https://pronote.example/",
        credentialInput: JSON.stringify({ password: "temporary-password" }),
      });
      createdId = created.id;
      expect(created).toMatchObject({
        provider: "pronote",
        label: "Ada — PRONOTE",
        baseUrl: "https://pronote.example",
        capabilities: ["homework", "timetable", "school-calendar"],
      });
      expect(JSON.stringify(created)).not.toContain("temporary-password");
      const [stored] = await database
        .select()
        .from(schema.syncConnections)
        .where(eq(schema.syncConnections.id, created.id));
      expect(openCredential(stored!.sealedCredentials!)).toBe(
        JSON.stringify({ version: 1, token: "device-token" }),
      );
    } finally {
      if (createdId) {
        await database
          .delete(schema.syncConnections)
          .where(eq(schema.syncConnections.id, createdId));
      }
      providerRegistry.pronote = previous;
    }
  });

  test("creates a development-only Skolengo connection through the generic sealing boundary", async () => {
    const previous = providerRegistry.skolengo;
    let createdId: string | null = null;
    providerRegistry.skolengo = {
      id: "skolengo",
      capabilities: ["homework", "timetable", "school-calendar"],
      school: {
        id: "skolengo",
        facets: {
          homework: {
            async list() {
              return [];
            },
          },
          timetable: {
            async list() {
              return [];
            },
          },
          "school-calendar": {
            async list() {
              return [];
            },
          },
        },
      },
      normalizeBaseUrl() {
        return "https://api.skolengo.com/api/v1/bff-sko-app";
      },
      async parseCredentialInput(_baseUrl, credentialInput) {
        expect(credentialInput).toContain("temporary-refresh-token");
        return {
          credentials: JSON.stringify({
            version: 1,
            refreshToken: "rotating-token",
          }),
          accountLabel: "Ada — Skolengo",
        };
      },
      async listCourses() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        return providerDownload("");
      },
    };
    try {
      const created = await apiA.sync.connections.create({
        provider: "skolengo",
        yearId: yearA,
        baseUrl: "https://api.skolengo.com",
        credentialInput: JSON.stringify({
          tokenSet: { refresh_token: "temporary-refresh-token" },
        }),
      });
      createdId = created.id;
      expect(created).toMatchObject({
        provider: "skolengo",
        label: "Ada — Skolengo",
        baseUrl: "https://api.skolengo.com/api/v1/bff-sko-app",
        capabilities: ["homework", "timetable", "school-calendar"],
      });
      expect(JSON.stringify(created)).not.toContain("temporary-refresh-token");
      const [stored] = await database
        .select()
        .from(schema.syncConnections)
        .where(eq(schema.syncConnections.id, created.id));
      expect(openCredential(stored!.sealedCredentials!)).toBe(
        JSON.stringify({ version: 1, refreshToken: "rotating-token" }),
      );
    } finally {
      if (createdId) {
        await database
          .delete(schema.syncConnections)
          .where(eq(schema.syncConnections.id, createdId));
      }
      providerRegistry.skolengo = previous;
    }
  });

  test("rejects a disabled provider before enqueueing synchronization", async () => {
    const previous = providerRegistry.pronote;
    const connectionId = `sconn-disabled-provider-${crypto.randomUUID()}`;
    await database.insert(schema.syncConnections).values({
      id: connectionId,
      provider: "pronote",
      label: "Disabled PRONOTE",
      baseUrl: "https://pronote.example",
      sealedCredentials: sealCredential(JSON.stringify({ version: 1 })),
      capabilities: ["homework"],
      yearId: yearA,
      userId: userA,
    });
    const jobsBefore = await database
      .select({ id: schema.jobs.id })
      .from(schema.jobs)
      .where(eq(schema.jobs.userId, userA));
    delete providerRegistry.pronote;
    try {
      await expect(apiA.sync.run({ connectionId })).rejects.toThrow(
        "provider is unavailable",
      );
      const jobsAfter = await database
        .select({ id: schema.jobs.id })
        .from(schema.jobs)
        .where(eq(schema.jobs.userId, userA));
      expect(jobsAfter).toHaveLength(jobsBefore.length);
    } finally {
      providerRegistry.pronote = previous;
      await database
        .delete(schema.syncConnections)
        .where(eq(schema.syncConnections.id, connectionId));
    }
  });

  test("creates an ÉcoleDirecte connection through the provider boundary and seals its password", async () => {
    const previous = providerRegistry.ecoledirecte;
    const plaintext = JSON.stringify({
      version: 1,
      username: "ada",
      password: "never-public",
      accountIndex: 0,
    });
    providerRegistry.ecoledirecte = {
      id: "ecoledirecte",
      capabilities: ["homework", "timetable", "school-calendar"],
      school: {
        id: "ecoledirecte",
        facets: {
          homework: {
            async list() {
              return [];
            },
          },
          timetable: {
            async list() {
              return [];
            },
          },
          "school-calendar": {
            async list() {
              return [];
            },
          },
        },
      },
      normalizeBaseUrl() {
        return "https://api.ecoledirecte.com";
      },
      async beginCredentialInput() {
        return {
          status: "connected",
          credentials: plaintext,
          accountLabel: "Ada School",
        };
      },
      async parseCredentialInput() {
        return { credentials: plaintext, accountLabel: "Ada School" };
      },
      async listCourses() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        return providerDownload("");
      },
    };
    try {
      await expect(
        apiA.sync.connections.create({
          provider: "ecoledirecte",
          yearId: yearA,
          baseUrl: "https://www.ecoledirecte.com",
          credentialInput: "browser-password-payload",
        }),
      ).rejects.toThrow("dedicated ÉcoleDirecte");
      const result = await apiA.sync.ecoledirecte.begin({
        yearId: yearA,
        credentialInput: "browser-password-payload",
      });
      expect(result).toMatchObject({
        status: "connected",
        connection: {
          provider: "ecoledirecte",
          baseUrl: "https://api.ecoledirecte.com",
          label: "Ada School",
          capabilities: ["homework", "timetable", "school-calendar"],
        },
      });
      if (result.status !== "connected") throw new Error("connection expected");
      expect(JSON.stringify(result)).not.toContain("password");
      const [stored] = await database
        .select()
        .from(schema.syncConnections)
        .where(eq(schema.syncConnections.id, result.connection.id));
      expect(stored?.sealedCredentials).not.toContain("never-public");
      expect(openCredential(stored!.sealedCredentials!)).toBe(plaintext);
      await apiA.sync.connections.purge({
        connectionId: result.connection.id,
      });
    } finally {
      providerRegistry.ecoledirecte = previous;
    }
  });

  test("keeps an ÉcoleDirecte 2FA token server-side and seals the confirmed credentials", async () => {
    const previous = providerRegistry.ecoledirecte;
    const challengeId = crypto.randomUUID();
    const confirmedCredentials = JSON.stringify({
      version: 1,
      username: "ada",
      password: "confirmed-never-public",
      accountIndex: 0,
      refresh: { accountKind: "E", accessToken: "refresh-never-public" },
    });
    let beginOwner: unknown;
    let confirmInput: unknown;
    providerRegistry.ecoledirecte = {
      id: "ecoledirecte",
      capabilities: ["homework", "timetable", "school-calendar"],
      school: {
        id: "ecoledirecte",
        facets: {
          homework: {
            async list() {
              return [];
            },
          },
          timetable: {
            async list() {
              return [];
            },
          },
          "school-calendar": {
            async list() {
              return [];
            },
          },
        },
      },
      async beginCredentialInput(owner, _baseUrl, credentialInput) {
        beginOwner = { owner, credentialInput };
        return {
          status: "challenge",
          challengeId,
          kind: "totp",
          question: null,
          choices: [],
          expiresAt: new Date("2026-08-20T12:05:00.000Z"),
        };
      },
      async completeCredentialChallenge(owner, receivedId, response) {
        confirmInput = { owner, challengeId: receivedId, response };
        return {
          status: "connected",
          credentials: confirmedCredentials,
          accountLabel: "Ada School",
        };
      },
      async parseCredentialInput() {
        throw new Error("the dedicated 2FA route must be used");
      },
      async listCourses() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        return providerDownload("");
      },
    };
    try {
      const pending = await apiA.sync.ecoledirecte.begin({
        yearId: yearA,
        credentialInput: "browser-password-payload",
      });
      expect(pending).toMatchObject({
        status: "challenge",
        challengeId,
        kind: "totp",
      });
      expect(beginOwner).toEqual({
        owner: { userId: userA, yearId: yearA },
        credentialInput: "browser-password-payload",
      });
      expect(JSON.stringify(pending)).not.toContain("password");
      expect(JSON.stringify(pending)).not.toContain("token");
      expect(
        await database
          .select()
          .from(schema.syncConnections)
          .where(eq(schema.syncConnections.userId, userA)),
      ).toHaveLength(0);

      const connected = await apiA.sync.ecoledirecte.confirm({
        yearId: yearA,
        challengeId,
        response: "123456",
      });
      expect(confirmInput).toEqual({
        owner: { userId: userA, yearId: yearA },
        challengeId,
        response: "123456",
      });
      expect(connected).toMatchObject({
        status: "connected",
        connection: {
          provider: "ecoledirecte",
          label: "Ada School",
          capabilities: ["homework", "timetable", "school-calendar"],
        },
      });
      expect(JSON.stringify(connected)).not.toContain("confirmed-never-public");
      expect(JSON.stringify(connected)).not.toContain("refresh-never-public");
      const [stored] = await database
        .select()
        .from(schema.syncConnections)
        .where(eq(schema.syncConnections.id, connected.connection.id));
      expect(stored?.sealedCredentials).not.toContain("confirmed-never-public");
      expect(openCredential(stored!.sealedCredentials!)).toBe(
        confirmedCredentials,
      );
      await apiA.sync.connections.purge({
        connectionId: connected.connection.id,
      });
    } finally {
      providerRegistry.ecoledirecte = previous;
    }
  });

  test("seals credentials, hides secrets and CA material, and enforces ownership", async () => {
    const plaintext = JSON.stringify({
      version: 1,
      token: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      userId: "42",
    });
    let parsedInput: unknown;
    providerRegistry.moodle = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput(baseUrl, credentialInput, options) {
        parsedInput = {
          baseUrl,
          credentialInput,
          caCertPem: options?.caCertPem,
        };
        return { credentials: plaintext, accountLabel: "Moodle Ada" };
      },
      async listCourses() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        return providerDownload("");
      },
    };

    const created = await apiA.sync.connections.create({
      provider: "moodle",
      yearId: yearA,
      baseUrl: "https://moodle.example.edu///",
      credentialInput: "pasted-secret-input",
      caCertPem:
        "-----BEGIN CERTIFICATE-----\nprivate-ca\n-----END CERTIFICATE-----",
    });
    expect(parsedInput).toEqual({
      baseUrl: "https://moodle.example.edu",
      credentialInput: "pasted-secret-input",
      caCertPem:
        "-----BEGIN CERTIFICATE-----\nprivate-ca\n-----END CERTIFICATE-----",
    });
    expect(created).toMatchObject({
      label: "Moodle Ada",
      baseUrl: "https://moodle.example.edu",
      hasCustomCa: true,
    });
    expect(created).not.toHaveProperty("sealedCredentials");
    expect(created).not.toHaveProperty("caCertPem");
    expect(JSON.stringify(created)).not.toContain("pasted-secret-input");
    expect(JSON.stringify(created)).not.toContain("private-ca");

    const [stored] = await database
      .select()
      .from(schema.syncConnections)
      .where(eq(schema.syncConnections.id, created.id));
    expect(stored?.sealedCredentials).not.toContain(
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    );
    expect(openCredential(stored!.sealedCredentials!)).toBe(plaintext);

    expect(await apiA.sync.connections.list({ yearId: yearA })).toEqual([
      created,
    ]);
    expect(await apiB.sync.connections.list({})).toEqual([]);
    await expect(
      apiB.sync.status({ connectionId: created.id }),
    ).rejects.toThrow("not found");
    await expect(apiB.sync.run({ connectionId: created.id })).rejects.toThrow(
      "not found",
    );
    await expect(
      apiB.sync.connections.delete({ connectionId: created.id }),
    ).rejects.toThrow("not found");

    const firstJob = await apiA.sync.run({ connectionId: created.id });
    const duplicateJob = await apiA.sync.run({ connectionId: created.id });
    expect(duplicateJob.jobId).toBe(firstJob.jobId);
    const status = await apiA.sync.status({ connectionId: created.id });
    expect(status.lastJob?.id).toBe(firstJob.jobId);
    expect(status.lastJob).not.toHaveProperty("lockedBy");
    expect(status.lastJob).not.toHaveProperty("lockedUntil");

    const file = await insertStoredFile(userA, "keep-after-disconnect.pdf");
    const [document] = await database
      .insert(schema.materialDocuments)
      .values({
        title: "Keep after disconnect",
        sourceType: "file",
        fileId: file.id,
        origin: "moodle",
        metaVersion: 1,
        metaJson: { externalId: "external-keep" },
        yearId: yearA,
        userId: userA,
      })
      .returning();
    await database.insert(schema.syncedResources).values({
      connectionId: created.id,
      capability: "files",
      externalId: "external-keep",
      localKind: "materialDocument",
      localId: document!.id,
      syncedAt: now,
      userId: userA,
    });
    await apiA.sync.connections.delete({ connectionId: created.id });
    expect(
      await database
        .select()
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.id, document!.id)),
    ).toHaveLength(1);
    expect(
      await database
        .select()
        .from(schema.syncedResources)
        .where(eq(schema.syncedResources.connectionId, created.id)),
    ).toHaveLength(1);
    const [disconnected] = await database
      .select()
      .from(schema.syncConnections)
      .where(eq(schema.syncConnections.id, created.id));
    expect(disconnected).toMatchObject({
      status: "disconnected",
      sealedCredentials: null,
      gradesAuthority: false,
    });
    expect(disconnected?.disconnectedAt).toBeInstanceOf(Date);
  }, 15_000);

  test("surfaces ambiguous provider subjects for an owned explicit resolution", async () => {
    const connectionId = `sconn-subject-map-${crypto.randomUUID()}`;
    await insertSyncConnection(connectionId);
    const subjectId = `subject-map-${crypto.randomUUID()}`;
    await database.insert(schema.subjects).values({
      id: subjectId,
      name: "Physique",
      kind: "subject",
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.syncSubjectMappings).values({
      connectionId,
      providerSubjectExternalId: "PHYS",
      providerSubjectName: "Sciences physiques",
      subjectId: null,
      matchStatus: "ambiguous",
      yearId: yearA,
      userId: userA,
    });

    await expect(
      apiB.sync.subjectMappings.list({ connectionId }),
    ).rejects.toThrow("not found");
    expect(await apiA.sync.subjectMappings.list({ connectionId })).toEqual([
      expect.objectContaining({
        providerSubjectExternalId: "PHYS",
        subjectId: null,
        subjectName: null,
        matchStatus: "ambiguous",
      }),
    ]);
    const resolved = await apiA.sync.subjectMappings.resolve({
      connectionId,
      providerSubjectExternalId: "PHYS",
      subjectId,
    });
    expect(resolved).toMatchObject({
      subjectId,
      subjectName: "Physique",
      matchStatus: "mapped",
    });
    const replacementSubjectId = `subject-map-replacement-${crypto.randomUUID()}`;
    await database.insert(schema.subjects).values({
      id: replacementSubjectId,
      name: "Sciences physiques",
      kind: "subject",
      yearId: yearA,
      userId: userA,
    });
    const remapped = await apiA.sync.subjectMappings.resolve({
      connectionId,
      providerSubjectExternalId: "PHYS",
      subjectId: replacementSubjectId,
    });
    expect(remapped).toMatchObject({
      subjectId: replacementSubjectId,
      subjectName: "Sciences physiques",
      matchStatus: "mapped",
    });
    expect(await apiA.sync.subjectMappings.list({ connectionId })).toEqual([
      expect.objectContaining({
        providerSubjectExternalId: "PHYS",
        subjectId: replacementSubjectId,
        subjectName: "Sciences physiques",
        matchStatus: "mapped",
      }),
    ]);
    const mappingProvider = providerRegistry.moodle;
    delete providerRegistry.moodle;
    try {
      await expect(
        apiA.sync.subjectMappings.resolve({
          connectionId,
          providerSubjectExternalId: "PHYS",
          subjectId,
        }),
      ).rejects.toThrow("provider is unavailable");
    } finally {
      providerRegistry.moodle = mappingProvider;
    }
    await database
      .update(schema.syncConnections)
      .set({ status: "revoked" })
      .where(eq(schema.syncConnections.id, connectionId));
    expect(
      await apiA.sync.subjectMappings.resolve({
        connectionId,
        providerSubjectExternalId: "PHYS",
        subjectId,
      }),
    ).toMatchObject({ subjectId, matchStatus: "mapped" });
    await apiA.sync.connections.purge({ connectionId });
  });

  test("previews school grades and binds a pending connection to a new or existing year", async () => {
    // Earlier authentication tests intentionally consume connection-attempt
    // slots. This case owns a private database and tests onboarding rather
    // than the limiter, so start its scenario with a clean rate-limit window.
    await database.delete(schema.rateLimits);
    const previous = providerRegistry.pronote;
    const connectionIds: string[] = [];
    const createdYearIds: string[] = [];
    const existingSubjectId = `subject-existing-bind-${crypto.randomUUID()}`;
    const existingPeriodId = `period-existing-bind-${crypto.randomUUID()}`;
    const startsAt = new Date("2026-09-01T00:00:00.000Z");
    const endsAt = new Date("2027-07-01T00:00:00.000Z");
    const disconnectDuringPreview = new Set<string>();
    const providerGrades = [
      {
        externalId: "math-grade-1",
        title: "Contrôle d'algèbre",
        subject: { externalId: "MATHS", name: "Mathématiques" },
        periodExternalId: "TERM-1",
        periodName: "Trimestre 1",
        passedAt: new Date("2026-10-15T08:00:00.000Z"),
        value: 17,
        outOf: 20,
        coefficient: 2,
        significant: true,
        modifiedAt: now,
      },
      {
        externalId: "math-grade-2",
        title: "Compétence observée",
        subject: { externalId: "MATHS", name: "Mathématiques" },
        periodExternalId: "TERM-1",
        periodName: "Trimestre 1",
        passedAt: new Date("2026-11-03T08:00:00.000Z"),
        value: null,
        outOf: null,
        coefficient: 1,
        significant: false,
        modifiedAt: now,
      },
    ];
    providerRegistry.pronote = {
      id: "pronote",
      capabilities: ["grades"],
      school: {
        id: "pronote",
        facets: {
          grades: {
            async list(connection, options) {
              expect(options.window.from).toEqual(startsAt);
              expect(options.window.to).toEqual(endsAt);
              if (disconnectDuringPreview.delete(connection.id)) {
                const [current] = await database
                  .select({ updatedAt: schema.syncConnections.updatedAt })
                  .from(schema.syncConnections)
                  .where(eq(schema.syncConnections.id, connection.id));
                await database
                  .update(schema.syncConnections)
                  .set({
                    sealedCredentials: null,
                    status: "disconnected",
                    gradesAuthority: false,
                    updatedAt: new Date(current!.updatedAt.getTime() + 1_000),
                  })
                  .where(eq(schema.syncConnections.id, connection.id));
              }
              return providerGrades;
            },
          },
        },
      },
      normalizeBaseUrl(input) {
        return input.replace(/\/$/, "");
      },
      async parseCredentialInput(_baseUrl, credentialInput) {
        const isOtherStudent = credentialInput.includes("other student");
        const isThirdStudent = credentialInput.includes("third student");
        return {
          credentials: JSON.stringify({ version: 2, token: "sealed-later" }),
          accountLabel: isThirdStudent
            ? "Linus — PRONOTE grades"
            : isOtherStudent
              ? "Grace — PRONOTE grades"
              : "Ada — PRONOTE grades",
          remoteStudentId: isThirdStudent
            ? "student-linus"
            : isOtherStudent
              ? "student-grace"
              : "student-ada",
          remoteAcademicYearId: "school-year-2026",
        };
      },
      async listCourses() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        return providerDownload("");
      },
    };

    try {
      const pendingForNewYear = await apiA.sync.connections.create({
        provider: "pronote",
        baseUrl: "https://pronote.example/",
        credentialInput: "temporary credentials",
      });
      connectionIds.push(pendingForNewYear.id);
      expect(pendingForNewYear).toMatchObject({
        status: "pending",
        yearId: null,
        remoteStudentId: "student-ada",
        remoteAcademicYearId: "school-year-2026",
        gradesAuthority: false,
      });
      await expect(
        apiB.sync.academic.preview({
          connectionId: pendingForNewYear.id,
          startsAt,
          endsAt,
        }),
      ).rejects.toThrow("not found");
      const preview = await apiA.sync.academic.preview({
        connectionId: pendingForNewYear.id,
        startsAt,
        endsAt,
      });
      expect(preview).toMatchObject({
        subjects: [{ externalId: "MATHS", name: "Mathématiques" }],
        periods: [{ externalId: "TERM-1", name: "Trimestre 1" }],
        grades: { total: 2, numeric: 1, nonNumeric: 1 },
      });

      const createdBinding = await apiA.sync.academic.bind({
        mode: "create",
        connectionId: pendingForNewYear.id,
        name: "Année importée 2026–2027",
        startsAt,
        endsAt,
        scale: 20,
        defaultOutOf: 20,
      });
      createdYearIds.push(createdBinding.yearId);
      expect(createdBinding).toMatchObject({
        alreadyBound: false,
        connection: {
          id: pendingForNewYear.id,
          status: "active",
          gradesAuthority: true,
        },
        preview: { subjects: 1, periods: 1, grades: 2 },
      });
      expect(
        await apiA.sync.subjectMappings.list({
          connectionId: pendingForNewYear.id,
        }),
      ).toEqual([
        expect.objectContaining({
          providerSubjectExternalId: "MATHS",
          subjectName: "Mathématiques",
          matchStatus: "mapped",
        }),
      ]);
      expect(
        await apiA.sync.periodMappings.list({
          connectionId: pendingForNewYear.id,
        }),
      ).toEqual([
        expect.objectContaining({
          providerPeriodExternalId: "TERM-1",
          periodName: "Trimestre 1",
          matchStatus: "mapped",
        }),
      ]);

      await expect(
        apiA.sync.connections.create({
          provider: "pronote",
          baseUrl: "https://pronote.example/",
          credentialInput: "temporary credentials",
        }),
      ).rejects.toThrow("already linked");
      const reauthorized = await apiA.sync.connections.create({
        provider: "pronote",
        yearId: createdBinding.yearId,
        reconnectConnectionId: pendingForNewYear.id,
        baseUrl: "https://pronote.example/",
        credentialInput: "temporary credentials",
      });
      expect(reauthorized).toMatchObject({
        id: pendingForNewYear.id,
        yearId: createdBinding.yearId,
        status: "active",
        remoteStudentId: "student-ada",
        remoteAcademicYearId: "school-year-2026",
      });
      await expect(
        apiA.sync.connections.create({
          provider: "pronote",
          yearId: createdBinding.yearId,
          reconnectConnectionId: pendingForNewYear.id,
          baseUrl: "https://pronote.example/",
          credentialInput: "other student credentials",
        }),
      ).rejects.toThrow("belongs to another student");
      expect(
        await database
          .select()
          .from(schema.syncConnections)
          .where(
            and(
              eq(schema.syncConnections.userId, userA),
              eq(schema.syncConnections.provider, "pronote"),
              eq(schema.syncConnections.remoteStudentId, "student-ada"),
              eq(
                schema.syncConnections.remoteAcademicYearId,
                "school-year-2026",
              ),
            ),
          ),
      ).toHaveLength(1);

      await database.insert(schema.subjects).values({
        id: existingSubjectId,
        name: "Mathématiques",
        kind: "subject",
        yearId: yearA,
        userId: userA,
      });
      await database.insert(schema.periods).values({
        id: existingPeriodId,
        name: "Trimestre 1",
        startAt: startsAt,
        endAt: new Date("2026-12-31T23:59:59.999Z"),
        yearId: yearA,
        userId: userA,
      });
      const pendingForExistingYear = await apiA.sync.connections.create({
        provider: "pronote",
        yearId: null,
        baseUrl: "https://pronote.example/",
        credentialInput: "temporary credentials for other student",
      });
      connectionIds.push(pendingForExistingYear.id);
      const existingBinding = await apiA.sync.academic.bind({
        mode: "existing",
        connectionId: pendingForExistingYear.id,
        yearId: yearA,
      });
      expect(existingBinding).toMatchObject({
        yearId: yearA,
        alreadyBound: false,
        connection: {
          id: pendingForExistingYear.id,
          status: "active",
          gradesAuthority: true,
        },
        preview: { subjects: 1, periods: 1, grades: 2 },
      });
      expect(
        await apiA.sync.subjectMappings.list({
          connectionId: pendingForExistingYear.id,
        }),
      ).toEqual([
        expect.objectContaining({
          providerSubjectExternalId: "MATHS",
          subjectId: existingSubjectId,
          matchStatus: "mapped",
        }),
      ]);
      expect(
        await apiA.sync.periodMappings.list({
          connectionId: pendingForExistingYear.id,
        }),
      ).toEqual([
        expect.objectContaining({
          providerPeriodExternalId: "TERM-1",
          periodId: existingPeriodId,
          matchStatus: "mapped",
        }),
      ]);
      expect(
        await apiA.sync.academic.bind({
          mode: "existing",
          connectionId: pendingForExistingYear.id,
          yearId: yearA,
        }),
      ).toEqual({ yearId: yearA, alreadyBound: true });

      await database.delete(schema.rateLimits);
      await expect(
        apiA.sync.connections.create({
          provider: "pronote",
          reconnectConnectionId: pendingForNewYear.id,
          baseUrl: "https://other-pronote.example/",
          credentialInput: "temporary credentials",
        }),
      ).rejects.toThrow("another school service instance");
      const sameRemoteIdentityOnAnotherTenant =
        await apiA.sync.connections.create({
          provider: "pronote",
          baseUrl: "https://other-pronote.example/",
          credentialInput: "temporary credentials",
        });
      connectionIds.push(sameRemoteIdentityOnAnotherTenant.id);
      expect(sameRemoteIdentityOnAnotherTenant).toMatchObject({
        baseUrl: "https://other-pronote.example",
        remoteStudentId: "student-ada",
        remoteAcademicYearId: "school-year-2026",
      });

      const concurrentlyDisconnected = await apiA.sync.connections.create({
        provider: "pronote",
        baseUrl: "https://pronote.example/",
        credentialInput: "temporary credentials for third student",
      });
      connectionIds.push(concurrentlyDisconnected.id);
      disconnectDuringPreview.add(concurrentlyDisconnected.id);
      await expect(
        apiA.sync.academic.bind({
          mode: "create",
          connectionId: concurrentlyDisconnected.id,
          name: "Must roll back",
          startsAt,
          endsAt,
          timezone: "Europe/Paris",
          scale: 20,
          defaultOutOf: 20,
        }),
      ).rejects.toThrow("changed before it was bound");
      expect(
        await database
          .select({ id: schema.years.id })
          .from(schema.years)
          .where(eq(schema.years.name, "Must roll back")),
      ).toHaveLength(0);
    } finally {
      if (connectionIds.length > 0) {
        await database
          .delete(schema.syncConnections)
          .where(inArray(schema.syncConnections.id, connectionIds));
      }
      if (createdYearIds.length > 0) {
        await database
          .delete(schema.years)
          .where(inArray(schema.years.id, createdYearIds));
      }
      await database
        .delete(schema.periods)
        .where(eq(schema.periods.id, existingPeriodId));
      await database
        .delete(schema.subjects)
        .where(eq(schema.subjects.id, existingSubjectId));
      providerRegistry.pronote = previous;
    }
  }, 15_000);

  test("rechecks provider quotas when a pending school source is bound", async () => {
    const previous = providerRegistry.pronote;
    const boundIds = Array.from(
      { length: 5 },
      () => `sconn-quota-bound-${crypto.randomUUID()}`,
    );
    const pendingId = `sconn-quota-pending-${crypto.randomUUID()}`;
    providerRegistry.pronote = {
      id: "pronote",
      capabilities: ["grades"],
      school: {
        id: "pronote",
        facets: {
          grades: {
            async list() {
              return [];
            },
          },
        },
      },
      async parseCredentialInput() {
        throw new Error("not used");
      },
      async listCourses() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        return providerDownload("");
      },
    };
    await database.insert(schema.syncConnections).values([
      ...boundIds.map((id, index) => ({
        id,
        provider: "pronote" as const,
        label: `PRONOTE quota ${index}`,
        baseUrl: `https://quota-${index}.pronote.example`,
        sealedCredentials: sealCredential(JSON.stringify({ version: 2 })),
        capabilities: ["grades" as const],
        status: "active" as const,
        gradesAuthority: false,
        yearId: yearA,
        userId: userA,
      })),
      {
        id: pendingId,
        provider: "pronote" as const,
        label: "PRONOTE quota pending",
        baseUrl: "https://quota-pending.pronote.example",
        sealedCredentials: sealCredential(JSON.stringify({ version: 2 })),
        capabilities: ["grades" as const],
        status: "pending" as const,
        gradesAuthority: false,
        yearId: null,
        userId: userA,
      },
    ]);
    try {
      await expect(
        apiA.sync.academic.bind({
          mode: "existing",
          connectionId: pendingId,
          yearId: yearA,
        }),
      ).rejects.toThrow("quota has been reached");
      expect(
        (
          await database
            .select()
            .from(schema.syncConnections)
            .where(eq(schema.syncConnections.id, pendingId))
        )[0],
      ).toMatchObject({ status: "pending", yearId: null });
    } finally {
      await database
        .delete(schema.syncConnections)
        .where(inArray(schema.syncConnections.id, [...boundIds, pendingId]));
      providerRegistry.pronote = previous;
    }
  });

  test("locks provider grade facts while preserving overlays and supports dismiss, restore, and detach", async () => {
    const connectionId = `sconn-managed-grade-${crypto.randomUUID()}`;
    const subjectId = `subject-managed-grade-${crypto.randomUUID()}`;
    const periodId = `period-managed-grade-${crypto.randomUUID()}`;
    const gradeId = `grade-managed-${crypto.randomUUID()}`;
    await database.insert(schema.subjects).values({
      id: subjectId,
      name: "Mathématiques gérées",
      kind: "subject",
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.periods).values({
      id: periodId,
      name: "Trimestre géré",
      startAt: new Date("2026-09-01T00:00:00.000Z"),
      endAt: new Date("2026-12-31T23:59:59.999Z"),
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.syncConnections).values({
      id: connectionId,
      provider: "pronote",
      label: "PRONOTE managed grade",
      baseUrl: "https://pronote.example",
      sealedCredentials: sealCredential(JSON.stringify({ version: 2 })),
      capabilities: ["grades"],
      status: "active",
      gradesAuthority: true,
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.grades).values({
      id: gradeId,
      name: "Devoir surveillé",
      value: 14,
      outOf: 20,
      coefficient: 2,
      bonus: 0,
      excludedFromAverage: false,
      syncExcludedFromAverage: false,
      note: null,
      passedAt: new Date("2026-10-10T09:00:00.000Z"),
      subjectId,
      periodId,
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.syncGradeRecords).values({
      connectionId,
      externalId: "grades:managed-1",
      externalModifiedAt: now,
      title: "Devoir surveillé",
      providerSubjectExternalId: "MATHS",
      providerSubjectName: "Mathématiques",
      providerPeriodExternalId: "TERM-1",
      providerPeriodName: "Trimestre 1",
      passedAt: new Date("2026-10-10T09:00:00.000Z"),
      value: 14,
      outOf: 20,
      coefficient: 2,
      significant: true,
      syncState: "managed",
      localGradeId: gradeId,
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.syncSubjectMappings).values({
      connectionId,
      providerSubjectExternalId: "MATHS",
      providerSubjectName: "Mathématiques",
      subjectId,
      matchStatus: "mapped",
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.syncPeriodMappings).values({
      connectionId,
      providerPeriodExternalId: "TERM-1",
      providerPeriodName: "Trimestre 1",
      periodId,
      matchStatus: "mapped",
      yearId: yearA,
      userId: userA,
    });

    try {
      const managed = await apiA.grades.get({ gradeId });
      expect(managed.management).toMatchObject({
        mode: "provider",
        syncState: "managed",
        externalId: "grades:managed-1",
        provider: "pronote",
        providerLabel: "PRONOTE managed grade",
        connectionStatus: "active",
        sourceValue: 14,
        sourceOutOf: 20,
        significant: true,
      });
      expect(managed.management.lockedFields).toEqual([
        "name",
        "value",
        "outOf",
        "coefficient",
        "passedAt",
        "subjectId",
        "periodId",
        "components",
      ]);
      expect(managed.management.editableFields).toEqual([
        "bonus",
        "note",
        "typeId",
        "excludedFromAverage",
      ]);
      await expect(apiB.grades.get({ gradeId })).rejects.toThrow("not found");
      await expect(
        apiA.grades.update({ gradeId, name: "Nom local interdit" }),
      ).rejects.toThrow("Detach this provider grade");
      await expect(
        apiA.grades.update({ gradeId, components: [] }),
      ).rejects.toThrow("Detach this provider grade");
      await expect(
        apiA.grades.reassign({ gradeIds: [gradeId], periodId }),
      ).rejects.toThrow("Detach provider grades");
      await expect(apiA.grades.delete({ gradeId })).rejects.toThrow(
        "Dismiss or detach",
      );

      const overlaid = await apiA.grades.update({
        gradeId,
        bonus: 1.5,
        note: "À retravailler",
      });
      expect(overlaid).toMatchObject({
        id: gradeId,
        name: "Devoir surveillé",
        value: 14,
        bonus: 1.5,
        note: "À retravailler",
        excludedFromAverage: false,
        syncExcludedFromAverage: false,
        management: { mode: "provider", syncState: "managed" },
      });
      await database
        .update(schema.grades)
        .set({ value: 21 })
        .where(eq(schema.grades.id, gradeId));
      expect(
        await apiA.grades.update({
          gradeId,
          note: "Extra credit remains editable",
        }),
      ).toMatchObject({
        value: 21,
        outOf: 20,
        note: "Extra credit remains editable",
      });
      await database
        .update(schema.grades)
        .set({ value: 14, note: "À retravailler" })
        .where(eq(schema.grades.id, gradeId));

      expect(await apiA.grades.dismissManaged({ gradeId })).toEqual({
        ok: true,
      });
      const dismissed = await apiA.grades.get({ gradeId });
      expect(dismissed).toMatchObject({
        excludedFromAverage: false,
        syncExcludedFromAverage: true,
        management: { mode: "provider", syncState: "dismissed" },
      });
      expect(await apiA.grades.restoreManaged({ gradeId })).toEqual({
        ok: true,
      });
      const restored = await apiA.grades.get({ gradeId });
      expect(restored).toMatchObject({
        excludedFromAverage: false,
        syncExcludedFromAverage: false,
        management: { mode: "provider", syncState: "managed" },
      });

      await database
        .update(schema.syncGradeRecords)
        .set({ syncState: "missing" })
        .where(eq(schema.syncGradeRecords.localGradeId, gradeId));
      await database
        .update(schema.grades)
        .set({ syncExcludedFromAverage: true })
        .where(eq(schema.grades.id, gradeId));
      await expect(apiA.grades.restoreManaged({ gradeId })).rejects.toThrow(
        "Only an ignored provider grade",
      );

      await apiA.grades.update({
        gradeId,
        excludedFromAverage: true,
      });
      const detached = await apiA.grades.detachManaged({ gradeId });
      expect(detached).toMatchObject({
        name: "Devoir surveillé",
        value: 14,
        bonus: 1.5,
        note: "À retravailler",
        excludedFromAverage: true,
        syncExcludedFromAverage: false,
        management: { mode: "user", syncState: "detached" },
      });
      expect(detached.id).not.toBe(gradeId);
      await expect(apiA.grades.get({ gradeId })).rejects.toThrow("not found");
      const [retainedSnapshot] = await database
        .select()
        .from(schema.syncGradeRecords)
        .where(eq(schema.syncGradeRecords.connectionId, connectionId));
      expect(retainedSnapshot).toMatchObject({
        externalId: "grades:managed-1",
        syncState: "dismissed",
        localGradeId: null,
      });
      expect(await apiA.grades.delete({ gradeId: detached.id })).toEqual({
        ok: true,
      });
    } finally {
      await database
        .delete(schema.syncConnections)
        .where(eq(schema.syncConnections.id, connectionId));
      await database
        .delete(schema.periods)
        .where(eq(schema.periods.id, periodId));
      await database
        .delete(schema.subjects)
        .where(eq(schema.subjects.id, subjectId));
    }
  });

  test("switches the grade authority without overwriting either source's user overlay", async () => {
    const subjectId = `subject-authority-${crypto.randomUUID()}`;
    const firstConnectionId = `sconn-authority-first-${crypto.randomUUID()}`;
    const secondConnectionId = `sconn-authority-second-${crypto.randomUUID()}`;
    const firstGradeId = `grade-authority-first-${crypto.randomUUID()}`;
    const secondGradeId = `grade-authority-second-${crypto.randomUUID()}`;
    await database.insert(schema.subjects).values({
      id: subjectId,
      name: "Sciences synchronisées",
      kind: "subject",
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.syncConnections).values([
      {
        id: firstConnectionId,
        provider: "pronote",
        label: "PRONOTE authority",
        baseUrl: "https://pronote.example",
        sealedCredentials: sealCredential(JSON.stringify({ version: 2 })),
        capabilities: ["grades"],
        status: "active",
        gradesAuthority: true,
        yearId: yearA,
        userId: userA,
      },
      {
        id: secondConnectionId,
        provider: "skolengo",
        label: "Skolengo candidate",
        baseUrl: "https://api.skolengo.com",
        sealedCredentials: sealCredential(JSON.stringify({ version: 1 })),
        capabilities: ["grades"],
        status: "active",
        gradesAuthority: false,
        yearId: yearA,
        userId: userA,
      },
    ]);
    await database.insert(schema.grades).values([
      {
        id: firstGradeId,
        name: "Note PRONOTE",
        value: 15,
        outOf: 20,
        excludedFromAverage: false,
        syncExcludedFromAverage: false,
        passedAt: new Date("2026-10-01T08:00:00.000Z"),
        subjectId,
        yearId: yearA,
        userId: userA,
      },
      {
        id: secondGradeId,
        name: "Note Skolengo",
        value: 16,
        outOf: 20,
        excludedFromAverage: true,
        syncExcludedFromAverage: true,
        passedAt: new Date("2026-10-02T08:00:00.000Z"),
        subjectId,
        yearId: yearA,
        userId: userA,
      },
    ]);
    await database.insert(schema.syncGradeRecords).values([
      {
        connectionId: firstConnectionId,
        externalId: "grades:first-authority",
        title: "Note PRONOTE",
        providerSubjectExternalId: "SCI",
        providerSubjectName: "Sciences",
        passedAt: new Date("2026-10-01T08:00:00.000Z"),
        value: 15,
        outOf: 20,
        coefficient: 1,
        significant: true,
        localGradeId: firstGradeId,
        yearId: yearA,
        userId: userA,
      },
      {
        connectionId: secondConnectionId,
        externalId: "grades:second-authority",
        title: "Note Skolengo",
        providerSubjectExternalId: "SCI",
        providerSubjectName: "Sciences",
        passedAt: new Date("2026-10-02T08:00:00.000Z"),
        value: 16,
        outOf: 20,
        coefficient: 1,
        significant: true,
        localGradeId: secondGradeId,
        yearId: yearA,
        userId: userA,
      },
    ]);
    await database.insert(schema.syncSubjectMappings).values([
      {
        connectionId: firstConnectionId,
        providerSubjectExternalId: "SCI",
        providerSubjectName: "Sciences",
        subjectId,
        matchStatus: "mapped",
        yearId: yearA,
        userId: userA,
      },
      {
        connectionId: secondConnectionId,
        providerSubjectExternalId: "SCI",
        providerSubjectName: "Sciences",
        subjectId,
        matchStatus: "mapped",
        yearId: yearA,
        userId: userA,
      },
    ]);

    try {
      await expect(
        apiB.sync.connections.setGradesAuthority({
          connectionId: secondConnectionId,
        }),
      ).rejects.toThrow("not found");
      expect(
        await apiA.sync.connections.setGradesAuthority({
          connectionId: secondConnectionId,
        }),
      ).toEqual({ ok: true });
      const connections = await database
        .select({
          id: schema.syncConnections.id,
          gradesAuthority: schema.syncConnections.gradesAuthority,
        })
        .from(schema.syncConnections)
        .where(
          inArray(schema.syncConnections.id, [
            firstConnectionId,
            secondConnectionId,
          ]),
        );
      expect(
        connections.find((connection) => connection.id === firstConnectionId),
      ).toMatchObject({ gradesAuthority: false });
      expect(
        connections.find((connection) => connection.id === secondConnectionId),
      ).toMatchObject({ gradesAuthority: true });
      const switchedGrades = await database
        .select()
        .from(schema.grades)
        .where(inArray(schema.grades.id, [firstGradeId, secondGradeId]));
      expect(
        switchedGrades.find((grade) => grade.id === firstGradeId),
      ).toMatchObject({
        excludedFromAverage: false,
        syncExcludedFromAverage: true,
      });
      expect(
        switchedGrades.find((grade) => grade.id === secondGradeId),
      ).toMatchObject({
        excludedFromAverage: true,
        syncExcludedFromAverage: false,
      });
      const snapshotGrades = (
        await apiA.snapshot.get({ yearId: yearA })
      ).subjects.flatMap((subject) => subject.grades);
      expect(
        snapshotGrades.find((grade) => grade.id === firstGradeId),
      ).toMatchObject({
        excludedFromAverage: false,
        syncExcludedFromAverage: true,
      });
      expect(
        snapshotGrades.find((grade) => grade.id === secondGradeId),
      ).toMatchObject({
        excludedFromAverage: true,
        syncExcludedFromAverage: false,
      });
      await database
        .update(schema.syncSubjectMappings)
        .set({ subjectId: null, matchStatus: "unmatched" })
        .where(eq(schema.syncSubjectMappings.connectionId, secondConnectionId));
      await apiA.sync.connections.setGradesAuthority({
        connectionId: secondConnectionId,
      });
      expect(
        (
          await database
            .select()
            .from(schema.grades)
            .where(eq(schema.grades.id, secondGradeId))
        )[0],
      ).toMatchObject({
        excludedFromAverage: true,
        syncExcludedFromAverage: true,
      });
    } finally {
      await database
        .delete(schema.syncConnections)
        .where(
          inArray(schema.syncConnections.id, [
            firstConnectionId,
            secondConnectionId,
          ]),
        );
      await database
        .delete(schema.subjects)
        .where(eq(schema.subjects.id, subjectId));
    }
  });

  test("disconnects non-destructively and only removes managed grades on explicit purge", async () => {
    const connectionId = `sconn-purge-grade-${crypto.randomUUID()}`;
    const subjectId = `subject-purge-grade-${crypto.randomUUID()}`;
    const gradeId = `grade-purge-${crypto.randomUUID()}`;
    await database.insert(schema.subjects).values({
      id: subjectId,
      name: "Physique synchronisée",
      kind: "subject",
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.syncConnections).values({
      id: connectionId,
      provider: "skolengo",
      label: "Skolengo to disconnect",
      baseUrl: "https://api.skolengo.com",
      sealedCredentials: sealCredential(JSON.stringify({ version: 1 })),
      capabilities: ["grades"],
      status: "active",
      gradesAuthority: false,
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.grades).values({
      id: gradeId,
      name: "Interrogation",
      value: 12,
      outOf: 20,
      coefficient: 1,
      excludedFromAverage: false,
      syncExcludedFromAverage: false,
      passedAt: new Date("2026-10-20T09:00:00.000Z"),
      subjectId,
      yearId: yearA,
      userId: userA,
    });
    await database.insert(schema.syncGradeRecords).values({
      connectionId,
      externalId: "grades:purge-1",
      title: "Interrogation",
      providerSubjectExternalId: "PHYS",
      providerSubjectName: "Physique",
      providerPeriodExternalId: null,
      providerPeriodName: null,
      passedAt: new Date("2026-10-20T09:00:00.000Z"),
      value: 12,
      outOf: 20,
      coefficient: 1,
      significant: true,
      syncState: "managed",
      localGradeId: gradeId,
      yearId: yearA,
      userId: userA,
    });

    try {
      await expect(
        apiB.sync.connections.delete({ connectionId }),
      ).rejects.toThrow("not found");
      expect(await apiA.sync.connections.delete({ connectionId })).toEqual({
        ok: true,
        preservedData: true,
      });
      const [disconnected] = await database
        .select()
        .from(schema.syncConnections)
        .where(eq(schema.syncConnections.id, connectionId));
      expect(disconnected).toMatchObject({
        status: "disconnected",
        sealedCredentials: null,
        gradesAuthority: false,
      });
      expect(disconnected?.disconnectedAt).toBeInstanceOf(Date);
      expect(await apiA.grades.get({ gradeId })).toMatchObject({
        id: gradeId,
        syncExcludedFromAverage: true,
        management: {
          mode: "provider",
          provider: "skolengo",
          connectionStatus: "disconnected",
          syncState: "managed",
        },
      });
      expect(
        await database
          .select()
          .from(schema.syncGradeRecords)
          .where(eq(schema.syncGradeRecords.connectionId, connectionId)),
      ).toHaveLength(1);

      expect(await apiA.sync.connections.purge({ connectionId })).toEqual({
        ok: true,
        removedGrades: 1,
        removedFiles: 0,
      });
      expect(
        await database
          .select()
          .from(schema.syncConnections)
          .where(eq(schema.syncConnections.id, connectionId)),
      ).toHaveLength(0);
      expect(
        await database
          .select()
          .from(schema.syncGradeRecords)
          .where(eq(schema.syncGradeRecords.connectionId, connectionId)),
      ).toHaveLength(0);
      expect(
        await database
          .select()
          .from(schema.grades)
          .where(eq(schema.grades.id, gradeId)),
      ).toHaveLength(0);
    } finally {
      await database
        .delete(schema.syncConnections)
        .where(eq(schema.syncConnections.id, connectionId));
      await database
        .delete(schema.subjects)
        .where(eq(schema.subjects.id, subjectId));
    }
  });
});

async function insertStoredFile(userId: string, name: string, bytes = 10) {
  const [file] = await database
    .insert(schema.files)
    .values({
      storageKey: `sync-test-${crypto.randomUUID()}`,
      url: `https://stored.example/${encodeURIComponent(name)}`,
      mimeType: "application/pdf",
      byteSize: bytes,
      purpose: "course-material",
      provider: "test",
      userId,
    })
    .returning();
  return file!;
}

async function insertSyncConnection(connectionId: string) {
  const [connection] = await database
    .insert(schema.syncConnections)
    .values({
      id: connectionId,
      provider: "moodle",
      label: "Fixture Moodle",
      baseUrl: "https://moodle.example.edu",
      sealedCredentials: sealCredential(
        JSON.stringify({
          version: 1,
          token: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          userId: "42",
        }),
      ),
      caCertPem: null,
      capabilities: ["files"],
      yearId: yearA,
      userId: userA,
    })
    .returning();
  return connection!;
}

async function seedHashMatchedResource(
  connectionId: string,
  file: ProviderFile & { body: string },
) {
  const stored = await insertStoredFile(userA, file.fileName, file.body.length);
  const [document] = await database
    .insert(schema.materialDocuments)
    .values({
      title: file.fileName,
      sourceType: "file",
      fileId: stored.id,
      origin: "moodle",
      metaVersion: 1,
      metaJson: { externalId: file.externalId },
      yearId: yearA,
      userId: userA,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const [resource] = await database
    .insert(schema.syncedResources)
    .values({
      connectionId,
      capability: "files",
      externalId: file.externalId,
      externalModifiedAt: new Date("2026-08-01T00:00:00.000Z"),
      contentHash: createHash("sha256").update(file.body).digest("hex"),
      localKind: "materialDocument",
      localId: document!.id,
      syncedAt: now,
      userId: userA,
    })
    .returning();
  return { document: document!, resource: resource!, stored };
}

describe("sync.run job", () => {
  test("downloads, skips unchanged files, updates modified content, and respects local deletion", async () => {
    const connectionId = `sconn-job-${crypto.randomUUID()}`;
    await database.insert(schema.syncConnections).values({
      id: connectionId,
      provider: "moodle",
      label: "Fixture Moodle",
      baseUrl: "https://moodle.example.edu",
      sealedCredentials: sealCredential(
        JSON.stringify({
          version: 1,
          token: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          userId: "42",
        }),
      ),
      caCertPem: null,
      capabilities: ["files"],
      yearId: yearA,
      userId: userA,
    });

    let files: (ProviderFile & { body: string })[] = [
      fixtureFile("algebra.pdf", 1, "algebra-v1"),
      fixtureFile("geometry.pdf", 1, "geometry-v1"),
    ];
    const downloads: string[] = [];
    const provider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        return [{ externalId: "course-1", name: "Mathematics" }];
      },
      async listFiles() {
        return files;
      },
      async download(_connection, file) {
        downloads.push(file.externalId);
        const fixture = files.find(
          (candidate) => candidate.externalId === file.externalId,
        );
        return providerDownload(fixture?.body ?? "missing");
      },
    };
    const storeFile: typeof import("../lib/storage").storeFile = async (
      input,
    ) => insertStoredFile(input.userId, input.file.name, input.file.size);

    const first = await runSyncJob(
      { connectionId },
      { providers: { moodle: provider }, storeFile, now: () => now },
    );
    expect(first).toEqual({
      downloaded: 2,
      updated: 0,
      skipped: 0,
      errors: [],
    });
    expect(downloads).toHaveLength(2);
    const initialDocuments = await database
      .select()
      .from(schema.materialDocuments)
      .where(
        and(
          eq(schema.materialDocuments.userId, userA),
          eq(schema.materialDocuments.origin, "moodle"),
        ),
      );
    const algebra = initialDocuments.find(
      (document) => document.title === "algebra.pdf",
    );
    expect(algebra?.fileId).toBeTruthy();

    const second = await runSyncJob(
      { connectionId },
      { providers: { moodle: provider }, storeFile, now: () => now },
    );
    expect(second).toEqual({
      downloaded: 0,
      updated: 0,
      skipped: 2,
      errors: [],
    });
    expect(downloads).toHaveLength(2);

    files = [
      fixtureFile("algebra.pdf", 2, "algebra-v2"),
      fixtureFile("geometry.pdf", 1, "geometry-v1"),
    ];
    const third = await runSyncJob(
      { connectionId },
      {
        providers: { moodle: provider },
        storeFile,
        now: () => new Date(now.getTime() + 1_000),
      },
    );
    expect(third).toEqual({
      downloaded: 0,
      updated: 1,
      skipped: 1,
      errors: [],
    });
    expect(downloads).toHaveLength(3);
    const [updatedAlgebra] = await database
      .select()
      .from(schema.materialDocuments)
      .where(eq(schema.materialDocuments.id, algebra!.id));
    expect(updatedAlgebra?.fileId).not.toBe(algebra?.fileId);
    const [oldFile] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, algebra!.fileId!));
    expect(oldFile?.status).toBe("deleted");

    await database
      .delete(schema.materialDocuments)
      .where(eq(schema.materialDocuments.id, algebra!.id));
    files = [
      fixtureFile("algebra.pdf", 3, "algebra-v3"),
      fixtureFile("geometry.pdf", 1, "geometry-v1"),
    ];
    const fourth = await runSyncJob(
      { connectionId },
      {
        providers: { moodle: provider },
        storeFile,
        now: () => new Date(now.getTime() + 2_000),
      },
    );
    expect(fourth).toEqual({
      downloaded: 0,
      updated: 0,
      skipped: 2,
      errors: [],
    });
    expect(downloads).toHaveLength(3);
    expect(
      await database
        .select()
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.id, algebra!.id)),
    ).toHaveLength(0);
  });

  test("does not store or write when aborted between download and storage", async () => {
    const connectionId = `sconn-abort-${crypto.randomUUID()}`;
    await insertSyncConnection(connectionId);
    const file = fixtureFile("abort-before-store.pdf", 1, "not-stored");
    const controller = new AbortController();
    const observedSignals: (AbortSignal | undefined)[] = [];
    let cancelled = false;
    let storeCalls = 0;
    const provider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses(_connection, options) {
        observedSignals.push(options?.signal);
        return [{ externalId: "course-1", name: "Mathematics" }];
      },
      async listFiles(_connection, _courseExternalId, options) {
        observedSignals.push(options?.signal);
        return [file];
      },
      async download(_connection, _file, options) {
        observedSignals.push(options?.signal);
        controller.abort(new Error("lease lost before storage"));
        return {
          body: new ReadableStream<Uint8Array>({
            cancel() {
              cancelled = true;
            },
          }),
          contentLength: file.body.length,
        };
      },
    };
    const [documentsBefore, foldersBefore, resourcesBefore] = await Promise.all(
      [
        database
          .select()
          .from(schema.materialDocuments)
          .where(eq(schema.materialDocuments.userId, userA)),
        database
          .select()
          .from(schema.materialFolders)
          .where(eq(schema.materialFolders.userId, userA)),
        database
          .select()
          .from(schema.syncedResources)
          .where(eq(schema.syncedResources.userId, userA)),
      ],
    );

    await expect(
      runSyncJob(
        { connectionId },
        {
          providers: { moodle: provider },
          signal: controller.signal,
          storeFile: async () => {
            storeCalls += 1;
            throw new Error("storage must not run");
          },
          now: () => now,
        },
      ),
    ).rejects.toThrow("lease lost before storage");

    expect(observedSignals).toEqual([
      controller.signal,
      controller.signal,
      controller.signal,
    ]);
    expect(cancelled).toBe(true);
    expect(storeCalls).toBe(0);
    const [documentsAfter, foldersAfter, resourcesAfter, [connection]] =
      await Promise.all([
        database
          .select()
          .from(schema.materialDocuments)
          .where(eq(schema.materialDocuments.userId, userA)),
        database
          .select()
          .from(schema.materialFolders)
          .where(eq(schema.materialFolders.userId, userA)),
        database
          .select()
          .from(schema.syncedResources)
          .where(eq(schema.syncedResources.userId, userA)),
        database
          .select()
          .from(schema.syncConnections)
          .where(eq(schema.syncConnections.id, connectionId)),
      ]);
    expect(documentsAfter).toEqual(documentsBefore);
    expect(foldersAfter).toEqual(foldersBefore);
    expect(resourcesAfter).toEqual(resourcesBefore);
    expect(connection).toMatchObject({
      status: "active",
      lastSyncAt: null,
      lastError: null,
    });
  });

  test("disconnecting after storage cannot update the local document", async () => {
    const connectionId = `sconn-disconnect-${crypto.randomUUID()}`;
    await insertSyncConnection(connectionId);
    const oldFile = fixtureFile("disconnect.pdf", 1, "old-body");
    const seeded = await seedHashMatchedResource(connectionId, oldFile);
    const changedFile = fixtureFile("disconnect.pdf", 2, "new-body");
    let storeCalls = 0;
    let uploadedFileId: string | null = null;
    const compensatedFileIds: string[] = [];
    const provider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        return [{ externalId: "course-1", name: "Mathematics" }];
      },
      async listFiles() {
        return [changedFile];
      },
      async download() {
        return providerDownload(changedFile.body);
      },
    };

    await expect(
      runSyncJob(
        { connectionId },
        {
          providers: { moodle: provider },
          storeFile: async (input) => {
            storeCalls += 1;
            const uploaded = await insertStoredFile(
              input.userId,
              input.file.name,
              input.file.size,
            );
            uploadedFileId = uploaded.id;
            await database
              .delete(schema.syncConnections)
              .where(eq(schema.syncConnections.id, connectionId));
            return uploaded;
          },
          deleteFile: async (_userId, fileId) => {
            compensatedFileIds.push(fileId);
            const [deleted] = await database
              .update(schema.files)
              .set({ status: "deleted" })
              .where(eq(schema.files.id, fileId))
              .returning();
            return deleted!;
          },
          now: () => new Date(now.getTime() + 5_000),
        },
      ),
    ).rejects.toThrow("no longer available");

    expect(storeCalls).toBe(1);
    expect(uploadedFileId).not.toBeNull();
    expect(compensatedFileIds).toEqual([uploadedFileId!]);
    const [documentAfter] = await database
      .select()
      .from(schema.materialDocuments)
      .where(eq(schema.materialDocuments.id, seeded.document.id));
    expect(documentAfter).toMatchObject({
      title: seeded.document.title,
      fileId: seeded.document.fileId,
      updatedAt: seeded.document.updatedAt,
    });
    expect(
      await database
        .select()
        .from(schema.syncedResources)
        .where(eq(schema.syncedResources.id, seeded.resource.id)),
    ).toHaveLength(0);
    const [storedAfter] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, seeded.stored.id));
    expect(storedAfter?.status).toBe("stored");
    const [uploadedAfter] = await database
      .select()
      .from(schema.files)
      .where(eq(schema.files.id, uploadedFileId!));
    expect(uploadedAfter?.status).toBe("deleted");
  });

  test("keeps a file adopted just before the job lease is lost", async () => {
    const connectionId = `sconn-post-commit-${crypto.randomUUID()}`;
    await insertSyncConnection(connectionId);
    const file = fixtureFile(
      `post-commit-${crypto.randomUUID()}.pdf`,
      1,
      "committed-body",
    );
    const controller = new AbortController();
    let storedFileId: string | null = null;
    const compensatedFileIds: string[] = [];
    const provider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        return [{ externalId: "course-1", name: "Mathematics" }];
      },
      async listFiles() {
        return [file];
      },
      async download() {
        return providerDownload(file.body);
      },
    };

    await expect(
      runSyncJob(
        { connectionId },
        {
          providers: { moodle: provider },
          signal: controller.signal,
          storeFile: async (input) => {
            const stored = await insertStoredFile(
              input.userId,
              input.file.name,
              input.file.size,
            );
            storedFileId = stored.id;
            return stored;
          },
          deleteFile: async (_userId, fileId) => {
            compensatedFileIds.push(fileId);
            const [deleted] = await database
              .update(schema.files)
              .set({ status: "deleted" })
              .where(eq(schema.files.id, fileId))
              .returning();
            return deleted!;
          },
          afterPublication() {
            controller.abort(new Error("lease lost after publication"));
          },
          now: () => new Date(now.getTime() + 6_000),
        },
      ),
    ).rejects.toThrow("lease lost after publication");

    expect(storedFileId).not.toBeNull();
    expect(compensatedFileIds).toEqual([]);
    const [document, resource, stored] = await Promise.all([
      database
        .select()
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.fileId, storedFileId!))
        .limit(1)
        .then((rows) => rows[0]),
      database
        .select()
        .from(schema.syncedResources)
        .where(
          and(
            eq(schema.syncedResources.connectionId, connectionId),
            eq(schema.syncedResources.externalId, file.externalId),
          ),
        )
        .limit(1)
        .then((rows) => rows[0]),
      database
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, storedFileId!))
        .limit(1)
        .then((rows) => rows[0]),
    ]);
    expect(document?.fileId).toBe(storedFileId);
    expect(resource?.localId).toBe(document?.id);
    expect(stored?.status).toBe("stored");
  });

  test("a stale run cannot roll a newer publication back", async () => {
    const connectionId = `sconn-publication-race-${crypto.randomUUID()}`;
    const initialConnection = await insertSyncConnection(connectionId);
    const staleNow = new Date(initialConnection.updatedAt.getTime() + 100);
    const freshNow = new Date(initialConnection.updatedAt.getTime() + 200);
    const name = `publication-race-${crypto.randomUUID()}.pdf`;
    const initial = fixtureFile(name, 1, "initial-v1");
    const older = fixtureFile(name, 2, "older-v2");
    const newer = fixtureFile(name, 3, "newer-v3");
    const seeded = await seedHashMatchedResource(connectionId, initial);
    let releaseOlder!: () => void;
    const olderHold = new Promise<void>((resolve) => {
      releaseOlder = resolve;
    });
    let announceOlderStored!: () => void;
    const olderStored = new Promise<void>((resolve) => {
      announceOlderStored = resolve;
    });
    let olderStoredFileId: string | null = null;
    let newerStoredFileId: string | null = null;
    const deletedFileIds: string[] = [];
    const providerFor = (candidate: ProviderFile & { body: string }) =>
      ({
        id: "moodle",
        capabilities: ["files"],
        async parseCredentialInput() {
          throw new Error("unused");
        },
        async listCourses() {
          return [{ externalId: "course-1", name: "Mathematics" }];
        },
        async listFiles() {
          return [candidate];
        },
        async download() {
          return providerDownload(candidate.body);
        },
      }) satisfies SyncProvider;
    const deleteFile = async (_userId: string, fileId: string) => {
      deletedFileIds.push(fileId);
      const [deleted] = await database
        .update(schema.files)
        .set({ status: "deleted" })
        .where(eq(schema.files.id, fileId))
        .returning();
      return deleted!;
    };

    const staleRun = runSyncJob(
      { connectionId },
      {
        providers: { moodle: providerFor(older) },
        storeFile: async (input) => {
          const stored = await insertStoredFile(
            input.userId,
            input.file.name,
            input.file.size,
          );
          olderStoredFileId = stored.id;
          announceOlderStored();
          await olderHold;
          return stored;
        },
        deleteFile,
        now: () => staleNow,
      },
    );
    await olderStored;

    const freshResult = await runSyncJob(
      { connectionId },
      {
        providers: { moodle: providerFor(newer) },
        storeFile: async (input) => {
          const stored = await insertStoredFile(
            input.userId,
            input.file.name,
            input.file.size,
          );
          newerStoredFileId = stored.id;
          return stored;
        },
        deleteFile,
        now: () => freshNow,
      },
    );
    expect(freshResult).toMatchObject({ updated: 1, errors: [] });
    releaseOlder();
    await expect(staleRun).rejects.toBeInstanceOf(RetryableSyncError);

    const [
      [document],
      [resource],
      [newerStored],
      [olderStoredAfter],
      [connectionAfter],
    ] = await Promise.all([
      database
        .select()
        .from(schema.materialDocuments)
        .where(eq(schema.materialDocuments.id, seeded.document.id)),
      database
        .select()
        .from(schema.syncedResources)
        .where(eq(schema.syncedResources.id, seeded.resource.id)),
      database
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, newerStoredFileId!)),
      database
        .select()
        .from(schema.files)
        .where(eq(schema.files.id, olderStoredFileId!)),
      database
        .select()
        .from(schema.syncConnections)
        .where(eq(schema.syncConnections.id, connectionId)),
    ]);
    expect(document?.fileId).toBe(newerStoredFileId);
    expect(resource?.externalModifiedAt).toEqual(newer.modifiedAt);
    expect(resource?.contentHash).toBe(
      createHash("sha256").update(newer.body).digest("hex"),
    );
    expect(newerStored?.status).toBe("stored");
    expect(olderStoredAfter?.status).toBe("deleted");
    expect(deletedFileIds).toContain(seeded.stored.id);
    expect(deletedFileIds).toContain(olderStoredFileId!);
    expect(connectionAfter).toMatchObject({
      status: "active",
      lastSyncAt: initialConnection.updatedAt,
      lastError: null,
      updatedAt: new Date(initialConnection.updatedAt.getTime() + 1_000),
    });
  });

  test("a stale discovery failure cannot poison a newer successful run", async () => {
    const connectionId = `sconn-discovery-race-${crypto.randomUUID()}`;
    const initialConnection = await insertSyncConnection(connectionId);
    const staleNow = new Date(initialConnection.updatedAt.getTime() + 300);
    const freshNow = new Date(initialConnection.updatedAt.getTime() + 400);
    let releaseStale!: () => void;
    const staleHold = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    let announceStale!: () => void;
    const staleEntered = new Promise<void>((resolve) => {
      announceStale = resolve;
    });
    const staleProvider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        announceStale();
        await staleHold;
        throw new RetryableSyncError("Moodle connection reset");
      },
      async listFiles() {
        throw new Error("must not list files");
      },
      async download() {
        throw new Error("must not download");
      },
    };
    const freshProvider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        throw new Error("must not download");
      },
    };

    const staleRun = runSyncJob(
      { connectionId },
      {
        providers: { moodle: staleProvider },
        now: () => staleNow,
      },
    );
    await staleEntered;
    await expect(
      runSyncJob(
        { connectionId },
        {
          providers: { moodle: freshProvider },
          now: () => freshNow,
        },
      ),
    ).resolves.toEqual({
      downloaded: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    });
    releaseStale();
    await expect(staleRun).rejects.toBeInstanceOf(RetryableSyncError);

    const [connectionAfter] = await database
      .select()
      .from(schema.syncConnections)
      .where(eq(schema.syncConnections.id, connectionId));
    expect(connectionAfter).toMatchObject({
      status: "active",
      lastSyncAt: initialConnection.updatedAt,
      lastError: null,
      updatedAt: new Date(initialConnection.updatedAt.getTime() + 1_000),
    });
  });

  test("a run that lost the CAS retries before repairing a stale failure", async () => {
    const connectionId = `sconn-recovery-order-${crypto.randomUUID()}`;
    const initialConnection = await insertSyncConnection(connectionId);
    const staleNow = new Date(initialConnection.updatedAt.getTime() + 1_000);
    const freshNow = new Date(initialConnection.updatedAt.getTime() + 61_000);
    let releaseStale!: () => void;
    const staleHold = new Promise<void>((resolve) => {
      releaseStale = resolve;
    });
    let announceStale!: () => void;
    const staleEntered = new Promise<void>((resolve) => {
      announceStale = resolve;
    });
    let releaseFresh!: () => void;
    const freshHold = new Promise<void>((resolve) => {
      releaseFresh = resolve;
    });
    let announceFresh!: () => void;
    const freshEntered = new Promise<void>((resolve) => {
      announceFresh = resolve;
    });
    const staleProvider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        announceStale();
        await staleHold;
        throw new RetryableSyncError("stale Moodle failure");
      },
      async listFiles() {
        return [];
      },
      async download() {
        throw new Error("must not download");
      },
    };
    const freshProvider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        announceFresh();
        await freshHold;
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        throw new Error("must not download");
      },
    };

    const staleRun = runSyncJob(
      { connectionId },
      {
        providers: { moodle: staleProvider },
        now: () => staleNow,
      },
    );
    await staleEntered;
    const freshRun = runSyncJob(
      { connectionId },
      {
        providers: { moodle: freshProvider },
        now: () => freshNow,
      },
    );
    await freshEntered;

    releaseStale();
    await expect(staleRun).rejects.toBeInstanceOf(RetryableSyncError);
    const [failedConnection] = await database
      .select()
      .from(schema.syncConnections)
      .where(eq(schema.syncConnections.id, connectionId));
    expect(failedConnection).toMatchObject({
      status: "error",
      updatedAt: staleNow,
    });

    releaseFresh();
    await expect(freshRun).rejects.toThrow(
      "connection changed before publication",
    );
    const retry = await runSyncJob(
      { connectionId },
      {
        providers: { moodle: freshProvider },
        now: () => freshNow,
      },
    );
    expect(retry).toEqual({
      downloaded: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    });
    const [connectionAfter] = await database
      .select()
      .from(schema.syncConnections)
      .where(eq(schema.syncConnections.id, connectionId));
    expect(connectionAfter).toMatchObject({
      status: "active",
      lastSyncAt: freshNow,
      lastError: null,
      updatedAt: freshNow,
    });
  });

  test("a permanent provider rejection is terminal on the first attempt", async () => {
    registerAllJobHandlers();
    const connectionId = `sconn-terminal-provider-${crypto.randomUUID()}`;
    await insertSyncConnection(connectionId);
    const provider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        throw new NonRetryableSyncError(
          "Moodle rejected the request (invalidtoken)",
        );
      },
      async listFiles() {
        throw new Error("must not list files");
      },
      async download() {
        throw new Error("must not download");
      },
    };
    const previousProvider = providerRegistry.moodle;
    providerRegistry.moodle = provider;
    try {
      const bucket = new Date("2026-08-20T18:30:00.000Z");
      const job = await enqueueSyncRun(userA, connectionId, bucket);
      const result = await runExactQueuedJob(
        job.id,
        "sync-terminal-provider",
        1,
      );
      expect(result).toMatchObject({
        id: job.id,
        status: "failed",
        attempts: 1,
        result: null,
      });
      expect(result.error).toContain("invalidtoken");
    } finally {
      providerRegistry.moodle = previousProvider;
    }
  });

  test("marks the connection revoked after a definitive school credential rejection", async () => {
    const connectionId = `sconn-revoked-provider-${crypto.randomUUID()}`;
    await insertSyncConnection(connectionId);
    const provider: SyncProvider = {
      id: "moodle",
      capabilities: ["homework"],
      school: {
        id: "ecoledirecte",
        completeWindowFacets: [],
        facets: {
          homework: {
            async list() {
              throw new CredentialsRevokedSyncError(
                "The provider rejected the stored credentials",
              );
            },
          },
        },
      },
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        return [];
      },
      async listFiles() {
        return [];
      },
      async download() {
        throw new Error("unused");
      },
    };

    await expect(
      runSyncJob(
        { connectionId },
        { providers: { moodle: provider }, now: () => now },
      ),
    ).rejects.toThrow("rejected the stored credentials");
    const [revoked] = await database
      .select()
      .from(schema.syncConnections)
      .where(eq(schema.syncConnections.id, connectionId));
    expect(revoked).toMatchObject({
      status: "revoked",
      lastError: "The provider rejected the stored credentials",
    });
    await expect(apiA.sync.run({ connectionId })).rejects.toThrow(
      "Reconnect the school service",
    );
  });

  test("a failed response stream is retried durably and can then succeed", async () => {
    registerAllJobHandlers();
    await database
      .delete(schema.jobs)
      .where(
        and(eq(schema.jobs.userId, userA), eq(schema.jobs.kind, syncJobKind)),
      );
    const connectionId = `sconn-stream-retry-${crypto.randomUUID()}`;
    await insertSyncConnection(connectionId);
    const file = fixtureFile("stream-retry.pdf", 2, "stable-body");
    const seeded = await seedHashMatchedResource(connectionId, file);
    let downloads = 0;
    const provider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        return [{ externalId: "course-1", name: "Mathematics" }];
      },
      async listFiles() {
        return [file];
      },
      async download() {
        downloads += 1;
        return downloads === 1
          ? failedProviderDownload("stream reset")
          : providerDownload(file.body);
      },
    };
    const previousProvider = providerRegistry.moodle;
    providerRegistry.moodle = provider;
    try {
      const bucket = new Date("2026-08-20T19:15:00.000Z");
      const job = await enqueueSyncRun(userA, connectionId, bucket);
      const firstAttempt = await runExactQueuedJob(job.id, "sync-retry-one", 1);
      expect(firstAttempt).toMatchObject({
        id: job.id,
        status: "queued",
        attempts: 1,
      });
      const [failedConnection] = await database
        .select()
        .from(schema.syncConnections)
        .where(eq(schema.syncConnections.id, connectionId));
      expect(failedConnection).toMatchObject({
        status: "error",
      });
      expect(failedConnection?.lastError).toContain("download was interrupted");

      const secondAttempt = await runExactQueuedJob(
        job.id,
        "sync-retry-two",
        2,
      );
      expect(secondAttempt).toMatchObject({
        id: job.id,
        status: "succeeded",
        attempts: 2,
        result: { downloaded: 0, updated: 0, skipped: 1, errors: [] },
      });
      expect(downloads).toBe(2);
      const [activeConnection] = await database
        .select()
        .from(schema.syncConnections)
        .where(eq(schema.syncConnections.id, connectionId));
      expect(activeConnection).toMatchObject({
        status: "active",
        lastError: null,
      });
      const [resourceAfter] = await database
        .select()
        .from(schema.syncedResources)
        .where(eq(schema.syncedResources.id, seeded.resource.id));
      expect(resourceAfter?.externalModifiedAt).toEqual(file.modifiedAt);
    } finally {
      providerRegistry.moodle = previousProvider;
    }
  });

  test("stream retry exhaustion never creates a succeeded hourly replay", async () => {
    registerAllJobHandlers();
    await database
      .delete(schema.jobs)
      .where(
        and(eq(schema.jobs.userId, userA), eq(schema.jobs.kind, syncJobKind)),
      );
    const connectionId = `sconn-stream-exhaust-${crypto.randomUUID()}`;
    await insertSyncConnection(connectionId);
    const file = fixtureFile("stream-exhaust.pdf", 1, "never-read");
    const provider: SyncProvider = {
      id: "moodle",
      capabilities: ["files"],
      async parseCredentialInput() {
        throw new Error("unused");
      },
      async listCourses() {
        return [{ externalId: "course-1", name: "Mathematics" }];
      },
      async listFiles() {
        return [file];
      },
      async download() {
        return failedProviderDownload("stream stays broken");
      },
    };
    const previousProvider = providerRegistry.moodle;
    providerRegistry.moodle = provider;
    try {
      const bucket = new Date("2026-08-20T20:15:00.000Z");
      const job = await enqueueSyncRun(userA, connectionId, bucket);
      expect(job.idempotencyKey).toBe(
        syncRunIdempotencyKey(connectionId, bucket),
      );
      const statuses: string[] = [];
      let current = job;
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        const result = await runExactQueuedJob(
          job.id,
          `sync-exhaust-${attempt}`,
          attempt,
        );
        expect(result?.id).toBe(job.id);
        expect(result?.attempts).toBe(attempt);
        statuses.push(result!.status);
        current = result!;
      }
      expect(statuses).toEqual(["queued", "queued", "failed"]);
      expect(statuses).not.toContain("succeeded");
      expect(current.result).toBeNull();
      expect(current.error).toContain("download was interrupted");

      const replay = await enqueueSyncRun(userA, connectionId, bucket);
      expect(replay.id).not.toBe(job.id);
      expect(replay).toMatchObject({
        status: "queued",
        attempts: 0,
        result: null,
        error: null,
      });
    } finally {
      providerRegistry.moodle = previousProvider;
    }
  });

  test("deduplicates active syncs but creates a fresh job after terminal success", async () => {
    const connectionId = `sconn-sequential-run-${crypto.randomUUID()}`;
    await insertSyncConnection(connectionId);
    const bucket = new Date("2026-08-20T21:15:00.000Z");
    const first = await enqueueSyncRun(userA, connectionId, bucket);
    const activeDuplicate = await enqueueSyncRun(userA, connectionId, bucket);
    expect(activeDuplicate.id).toBe(first.id);
    const nextHour = new Date(bucket.getTime() + 60 * 60_000);
    const crossHourDuplicate = await enqueueSyncRun(
      userA,
      connectionId,
      nextHour,
    );
    expect(crossHourDuplicate.id).toBe(first.id);
    await database
      .update(schema.jobs)
      .set({ status: "succeeded", result: { downloaded: 0 } })
      .where(eq(schema.jobs.id, first.id));

    const [second, concurrentDuplicate] = await Promise.all([
      enqueueSyncRun(userA, connectionId, nextHour),
      enqueueSyncRun(userA, connectionId, nextHour),
    ]);
    expect(second.id).not.toBe(first.id);
    expect(concurrentDuplicate.id).toBe(second.id);
    expect(second).toMatchObject({ status: "queued", attempts: 0 });
    const [archivedFirst] = await database
      .select()
      .from(schema.jobs)
      .where(eq(schema.jobs.id, first.id));
    expect(archivedFirst?.idempotencyKey).toBe(
      `${syncRunIdempotencyKey(connectionId, bucket)}:terminal:${first.id}`,
    );
  });
});

describe("sync download streaming", () => {
  test("hashes incremental chunks and materializes one storage File", async () => {
    const source = fixtureFile("streamed.pdf", 1, "abcdef");
    const download = chunkedProviderDownload(["ab", "cd", "ef"]);

    const result = await materializeProviderDownload(source, download, 10);

    expect(result.file.size).toBe(6);
    expect(await result.file.text()).toBe("abcdef");
    expect(result.contentHash).toBe(
      "bef57ec7f53a6d40beb640a780a639c83bc29ac8a9816f1fc6c5c6dcd93c4721",
    );
  });

  test("cancels a stream as soon as its bounded byte ceiling is crossed", async () => {
    let cancelled = false;
    let index = 0;
    const chunks = ["abc", "def", "unused"];
    const download: ProviderDownload = {
      body: new ReadableStream<Uint8Array>(
        {
          pull(controller) {
            const chunk = chunks[index];
            index += 1;
            if (chunk === undefined) controller.close();
            else controller.enqueue(new TextEncoder().encode(chunk));
          },
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      contentLength: null,
    };

    await expect(
      materializeProviderDownload(
        fixtureFile("too-large.pdf", 1, ""),
        download,
        5,
      ),
    ).rejects.toThrow("5 byte storage limit");
    expect(cancelled).toBe(true);
    expect(index).toBeLessThanOrEqual(2);
  });

  test("cancels a blocked reader and rejects promptly when the lease is lost", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const download: ProviderDownload = {
      body: new ReadableStream<Uint8Array>(
        {
          cancel() {
            cancelled = true;
          },
        },
        { highWaterMark: 0 },
      ),
      contentLength: null,
    };
    const pending = materializeProviderDownload(
      fixtureFile("blocked.pdf", 1, ""),
      download,
      10,
      controller.signal,
    );

    await Promise.resolve();
    controller.abort(new Error("job lease was lost"));

    await expect(pending).rejects.toThrow("job lease was lost");
    expect(cancelled).toBe(true);
  });
});

function fixtureFile(
  name: string,
  modifiedVersion: number,
  body: string,
): ProviderFile & { body: string } {
  return {
    externalId: `https://moodle.example.edu/pluginfile.php/course-1/${name}`,
    fileName: name,
    folderPath: ["Chapter 1"],
    mimeType: "application/pdf",
    byteSize: body.length,
    modifiedAt: new Date(
      `2026-08-${String(modifiedVersion).padStart(2, "0")}T00:00:00.000Z`,
    ),
    courseRef: { externalId: "course-1", name: "Mathematics" },
    body,
  };
}

function providerDownload(body: string): ProviderDownload {
  const bytes = new TextEncoder().encode(body);
  return {
    body: new Blob([bytes]).stream(),
    contentLength: bytes.byteLength,
  };
}

function failedProviderDownload(message: string): ProviderDownload {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.error(new Error(message));
      },
    }),
    contentLength: null,
  };
}

function chunkedProviderDownload(chunks: string[]): ProviderDownload {
  let index = 0;
  return {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        const chunk = chunks[index];
        index += 1;
        if (chunk === undefined) controller.close();
        else controller.enqueue(new TextEncoder().encode(chunk));
      },
    }),
    contentLength: chunks.reduce(
      (total, chunk) => total + new TextEncoder().encode(chunk).byteLength,
      0,
    ),
  };
}
