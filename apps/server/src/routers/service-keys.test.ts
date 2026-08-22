import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { and, eq, inArray } from "drizzle-orm";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.MISTRAL_API_KEY = "operator-mistral-key";
delete process.env.TRANSCRIPTION_API_KEY;

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
let serviceKeys: typeof import("../lib/service-keys");
let crypto: typeof import("../lib/crypto");
let operatorMistralKey: string;
let apiA: Api;
let apiB: Api;

const userA = "service-key-user-a";
const userB = "service-key-user-b";

function sessionFor(id: string) {
  const now = new Date("2026-08-01T00:00:00.000Z");
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
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  serviceKeys = await import("../lib/service-keys");
  crypto = await import("../lib/crypto");
  const { env } = await import("../lib/env");
  operatorMistralKey = env.MISTRAL_API_KEY!;
  const now = new Date("2026-08-01T00:00:00.000Z");
  await database
    .insert(schema.users)
    .values([
      {
        id: userA,
        name: "Service Key A",
        email: "service-key-user-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: userB,
        name: "Service Key B",
        email: "service-key-user-b@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
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
});

afterAll(async () => {
  await database
    .delete(schema.users)
    .where(inArray(schema.users.id, [userA, userB]));
});

describe("per-user service keys", () => {
  test("seals a key, exposes only its four-character hint and opens it server-side", async () => {
    const result = await apiA.serviceKeys.set({
      kind: "transcription",
      key: "user-transcription-9x4f",
    });
    expect(result).toMatchObject({
      kind: "transcription",
      hint: "9x4f",
      status: "active",
    });
    const [stored] = await database
      .select()
      .from(schema.userServiceKeys)
      .where(
        and(
          eq(schema.userServiceKeys.userId, userA),
          eq(schema.userServiceKeys.kind, "transcription"),
        ),
      );
    expect(stored?.sealedKey).not.toContain("user-transcription-9x4f");
    expect(crypto.open(stored!.sealedKey)).toBe("user-transcription-9x4f");
  });

  test("uses an active user key before the operator fallback", async () => {
    await apiA.serviceKeys.set({ kind: "mistral", key: "user-mistral-key" });
    const resolved = await serviceKeys.resolveServiceKey(userA, "mistral");
    expect(resolved).toMatchObject({
      key: "user-mistral-key",
      source: "user",
    });
    expect(
      resolved?.source === "user"
        ? typeof resolved.invalidationToken
        : "missing",
    ).toBe("string");
  });

  test("a provider 401 invalidates the user key without retrying it", async () => {
    const { runMistralOcr } = await import("../lib/ocr");
    process.env.DISABLE_OCR = "false";
    let calls = 0;
    await expect(
      runMistralOcr(
        userA,
        { blob: new Blob(["pdf"]), name: "unauthorized.pdf" },
        {
          fetch: async () => {
            calls += 1;
            return new Response(JSON.stringify({ message: "invalid key" }), {
              status: 401,
            });
          },
          sleep: async () => undefined,
        },
      ),
    ).rejects.toThrow("401");
    expect(calls).toBe(1);
    const row = (await apiA.serviceKeys.list()).find(
      (entry) => entry.kind === "mistral",
    );
    expect(row?.status).toBe("invalid");
  });

  test("uses the operator key when the account has none", async () => {
    expect(await serviceKeys.resolveServiceKey(userB, "mistral")).toEqual({
      key: operatorMistralKey,
      source: "operator",
    });
  });

  test("returns null when neither account nor operator configured a key", async () => {
    expect(
      await serviceKeys.resolveServiceKey(userB, "transcription"),
    ).toBeNull();
  });

  test("list responses never contain sealed or plaintext material", async () => {
    const rows = await apiA.serviceKeys.list();
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual([
        "hint",
        "kind",
        "status",
        "updatedAt",
      ]);
      expect(JSON.stringify(row)).not.toContain("user-mistral-key");
      expect(JSON.stringify(row)).not.toContain("sealedKey");
    }
    expect(await apiB.serviceKeys.list()).toEqual([]);
  });

  test("marks a rejected user credential invalid and falls back once", async () => {
    await apiA.serviceKeys.set({ kind: "mistral", key: "rejected-user-key" });
    const resolved = await serviceKeys.resolveServiceKey(userA, "mistral");
    if (!resolved || resolved.source !== "user") {
      throw new Error("Expected the freshly saved user credential");
    }
    await serviceKeys.markServiceKeyInvalid(
      userA,
      "mistral",
      resolved.invalidationToken,
    );
    const row = (await apiA.serviceKeys.list()).find(
      (entry) => entry.kind === "mistral",
    );
    expect(row?.status).toBe("invalid");
    expect(await serviceKeys.resolveServiceKey(userA, "mistral")).toEqual({
      key: operatorMistralKey,
      source: "operator",
    });
  });

  test("a stale provider rejection cannot invalidate a replacement key", async () => {
    await apiA.serviceKeys.set({ kind: "mistral", key: "generation-k1" });
    const stale = await serviceKeys.resolveServiceKey(userA, "mistral");
    if (!stale || stale.source !== "user") {
      throw new Error("Expected the first user credential");
    }
    await apiA.serviceKeys.set({ kind: "mistral", key: "generation-k2" });

    expect(
      await serviceKeys.markServiceKeyInvalid(
        userA,
        "mistral",
        stale.invalidationToken,
      ),
    ).toBe(false);
    const replacement = await serviceKeys.resolveServiceKey(userA, "mistral");
    expect(replacement).toMatchObject({
      key: "generation-k2",
      source: "user",
    });
    if (!replacement || replacement.source !== "user") {
      throw new Error("Expected the replacement user credential");
    }
    expect(
      await serviceKeys.markServiceKeyInvalid(
        userA,
        "mistral",
        replacement.invalidationToken,
      ),
    ).toBe(true);
    expect(
      (await apiA.serviceKeys.list()).find((row) => row.kind === "mistral")
        ?.status,
    ).toBe("invalid");
  });

  test("transcription 401 invalidation is fenced to the credential actually sent", async () => {
    const { runMistralTranscription } = await import("../lib/transcription");
    process.env.DISABLE_TRANSCRIPTION = "false";
    await apiA.serviceKeys.set({
      kind: "transcription",
      key: "transcription-race-k1",
    });
    await expect(
      runMistralTranscription(
        userA,
        { blob: new Blob(["audio"]), mimeType: "audio/webm" },
        {
          sleep: async () => undefined,
          fetch: async (_url, init) => {
            expect(new Headers(init?.headers).get("authorization")).toBe(
              "Bearer transcription-race-k1",
            );
            await apiA.serviceKeys.set({
              kind: "transcription",
              key: "transcription-race-k2",
            });
            return Response.json({ message: "stale K1" }, { status: 401 });
          },
        },
      ),
    ).rejects.toThrow("401");
    expect(
      await serviceKeys.resolveServiceKey(userA, "transcription"),
    ).toMatchObject({ key: "transcription-race-k2", source: "user" });

    await expect(
      runMistralTranscription(
        userA,
        { blob: new Blob(["audio"]), mimeType: "audio/webm" },
        {
          fetch: async () =>
            Response.json({ message: "current K2" }, { status: 401 }),
        },
      ),
    ).rejects.toThrow("401");
    expect(
      (await apiA.serviceKeys.list()).find(
        (row) => row.kind === "transcription",
      )?.status,
    ).toBe("invalid");
  });

  test("upserts one key per kind and clearing restores fallback behavior", async () => {
    await apiA.serviceKeys.set({ kind: "mistral", key: "test" });
    const rows = await database
      .select()
      .from(schema.userServiceKeys)
      .where(
        and(
          eq(schema.userServiceKeys.userId, userA),
          eq(schema.userServiceKeys.kind, "mistral"),
        ),
      );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe("active");
    expect(await apiA.serviceKeys.clear({ kind: "mistral" })).toEqual({
      ok: true,
    });
    expect(await serviceKeys.resolveServiceKey(userA, "mistral")).toEqual({
      key: operatorMistralKey,
      source: "operator",
    });
  });
});
