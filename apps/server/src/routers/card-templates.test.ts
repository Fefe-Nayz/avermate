import { beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import {
  createWidgetDefinition,
  WIDGET_DEFINITION_VERSION,
} from "@avermate/core";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const databaseUrl = "file::memory:";

process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_FEEDBACK = "true";
process.env.DISABLE_UPLOADS = "true";

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

let api: Api;
let adminApi: Api;

function sessionFor(id: string, role: "user" | "admin") {
  const now = new Date("2026-08-01T00:00:00.000Z");
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.com`,
      emailVerified: true,
      image: null,
      role,
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
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

beforeAll(async () => {
  const { db: database } = await import("../db");
  const schema = await import("../db/schema");
  // The db module holds one shared in-memory database for every router test
  // file in this process; migrate only if another bootstrap has not already.
  const migrated = await database.$client.execute(
    "SELECT name FROM sqlite_master WHERE type='table' AND name='users'",
  );
  if (migrated.rows.length === 0) {
    await database.$client.executeMultiple(migration);
  }
  const { appRouter } = await import("./index");

  const now = new Date("2026-08-01T00:00:00.000Z");
  await database
    .insert(schema.users)
    .values([
      {
        id: "ctpl-user-a",
        name: "Template Test User",
        email: "ctpl-user-a@example.com",
        emailVerified: true,
        role: "user",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
      {
        id: "ctpl-admin-a",
        name: "Template Admin User",
        email: "ctpl-admin-a@example.com",
        emailVerified: true,
        role: "admin",
        banned: false,
        createdAt: now,
        updatedAt: now,
      },
    ])
    .onConflictDoNothing();

  api = createRouterClient(appRouter, {
    context: {
      headers: new Headers(),
      session: sessionFor("ctpl-user-a", "user"),
    },
  });
  adminApi = createRouterClient(appRouter, {
    context: {
      headers: new Headers(),
      session: sessionFor("ctpl-admin-a", "admin"),
    },
  });
});

function templateInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "General average",
    description: "The running general average.",
    surfaces: ["overview" as const],
    category: "general",
    definitionVersion: WIDGET_DEFINITION_VERSION,
    definitionJson: createWidgetDefinition("overview") as unknown as Record<
      string,
      unknown
    >,
    ...overrides,
  };
}

describe("card template catalog", () => {
  test("non-admins are denied every admin procedure", async () => {
    expect(adminApi).toBeDefined();
    await expect(api.cardTemplates.create(templateInput())).rejects.toThrow();
    await expect(api.cardTemplates.adminList()).rejects.toThrow();
  });

  test("drafts are hidden from the public list and get", async () => {
    const draft = await adminApi.cardTemplates.create(templateInput());
    expect(draft.status).toBe("draft");
    const listed = await api.cardTemplates.list();
    expect(listed.some((row) => row.id === draft.id)).toBe(false);
    await expect(
      api.cardTemplates.get({ templateId: draft.id }),
    ).rejects.toThrow();
  });

  test("publishing a reference-free draft makes it public", async () => {
    const draft = await adminApi.cardTemplates.create(templateInput());
    const published = await adminApi.cardTemplates.publish({
      templateId: draft.id,
    });
    expect(published.status).toBe("published");
    const listed = await api.cardTemplates.list();
    expect(listed.some((row) => row.id === draft.id)).toBe(true);
    const fetched = await api.cardTemplates.get({ templateId: draft.id });
    expect(fetched.title).toBe("General average");
  });

  test("publish keeps entity references as install-time slots", async () => {
    const definition = createWidgetDefinition("overview");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["subject-of-the-author"],
      includeDescendants: true,
    };
    const draft = await adminApi.cardTemplates.create(
      templateInput({
        definitionJson: definition as unknown as Record<string, unknown>,
      }),
    );
    const published = await adminApi.cardTemplates.publish({
      templateId: draft.id,
    });
    expect(published.status).toBe("published");
    expect(JSON.stringify(published.definitionJson)).toContain(
      "subject-of-the-author",
    );
  });

  test("publish rejects a stale definition version", async () => {
    const draft = await adminApi.cardTemplates.create(
      templateInput({ definitionVersion: WIDGET_DEFINITION_VERSION + 1 }),
    );
    await expect(
      adminApi.cardTemplates.publish({ templateId: draft.id }),
    ).rejects.toThrow(/definition version/i);
  });

  test("published templates are immutable; archived ones leave the list", async () => {
    const draft = await adminApi.cardTemplates.create(templateInput());
    await adminApi.cardTemplates.publish({ templateId: draft.id });
    await expect(
      adminApi.cardTemplates.update({
        templateId: draft.id,
        title: "Renamed",
      }),
    ).rejects.toThrow(/immutable/i);

    const archived = await adminApi.cardTemplates.archive({
      templateId: draft.id,
    });
    expect(archived.status).toBe("archived");
    const listed = await api.cardTemplates.list();
    expect(listed.some((row) => row.id === draft.id)).toBe(false);
  });

  test("drafts stay editable until published", async () => {
    const draft = await adminApi.cardTemplates.create(templateInput());
    const updated = await adminApi.cardTemplates.update({
      templateId: draft.id,
      title: "Adjusted title",
      sortOrder: 5,
    });
    expect(updated.title).toBe("Adjusted title");
    expect(updated.sortOrder).toBe(5);
  });
});
