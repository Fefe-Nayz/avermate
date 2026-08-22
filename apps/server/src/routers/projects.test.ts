import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const directory = mkdtempSync(join(tmpdir(), "avermate-projects-test-"));
process.env.DATABASE_URL = `file:${join(directory, "projects.db")}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "test-secret-that-is-at-least-32-chars";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";
process.env.DISABLE_JOBS = "true";
process.env.CORPUS_EMBEDDING_ENABLED = "false";

const migrationDirectory = join(import.meta.dir, "../../drizzle");
const migration = readdirSync(migrationDirectory)
  .filter((file) => /^\d+.*\.sql$/.test(file))
  .sort((left, right) => left.localeCompare(right))
  .map((file) => readFileSync(join(migrationDirectory, file), "utf8"))
  .join("\n");
// Applying the complete migration history through 0060 and releasing its
// relational fixtures can take about 90s on slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

type AppRouter = typeof import("./index").appRouter;
type Api = ReturnType<
  typeof createRouterClient<AppRouter, Record<never, never>>
>;

let database: typeof import("../db").db;
let apiA: Api;
let apiB: Api;

const userA = "projects-user-a";
const userB = "projects-user-b";
const yearA = "projects-year-a";
const yearB = "projects-year-b";
const subjectA = "projects-subject-a";

function sessionFor(id: string) {
  const now = new Date("2026-08-22T00:00:00.000Z");
  return {
    user: {
      id,
      name: id,
      email: `${id}@example.test`,
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
      expiresAt: new Date("2027-08-22T00:00:00.000Z"),
      createdAt: now,
      updatedAt: now,
      ipAddress: null,
      userAgent: null,
      impersonatedBy: null,
    },
  };
}

beforeAll(async () => {
  ({ db: database } = await import("../db"));
  const { registerSharedTestDatabaseLifecycle } =
    await import("../testing/database-lifecycle");
  registerSharedTestDatabaseLifecycle(database.$client, {
    directories: [directory],
  });
  await database.$client.executeMultiple(migration);
  const now = Math.floor(
    new Date("2026-08-22T00:00:00.000Z").getTime() / 1_000,
  );
  await database.$client.batch(
    [
      {
        sql: `INSERT INTO users (id, name, email, emailVerified, role, banned, createdAt, updatedAt) VALUES (?, 'A', 'projects-a@example.test', 1, 'user', 0, ?, ?)`,
        args: [userA, now, now],
      },
      {
        sql: `INSERT INTO users (id, name, email, emailVerified, role, banned, createdAt, updatedAt) VALUES (?, 'B', 'projects-b@example.test', 1, 'user', 0, ?, ?)`,
        args: [userB, now, now],
      },
      {
        sql: `INSERT INTO years (id, name, startsAt, endsAt, userId, createdAt, updatedAt) VALUES (?, 'A', ?, ?, ?, ?, ?)`,
        args: [yearA, now, now + 31_536_000, userA, now, now],
      },
      {
        sql: `INSERT INTO years (id, name, startsAt, endsAt, userId, createdAt, updatedAt) VALUES (?, 'B', ?, ?, ?, ?, ?)`,
        args: [yearB, now, now + 31_536_000, userB, now, now],
      },
      {
        sql: `INSERT INTO subjects (id, name, coefficient, kind, isMain, bonus, sortOrder, yearId, userId, createdAt, updatedAt) VALUES (?, 'Physique', 1, 'subject', 1, 0, 0, ?, ?, ?, ?)`,
        args: [subjectA, yearA, userA, now, now],
      },
      {
        sql: `INSERT INTO material_documents (id, title, sourceType, textContent, origin, yearId, userId, createdAt, updatedAt) VALUES ('projects-material-a', 'Énergie', 'text', 'L énergie cinétique dépend du carré de la vitesse.', 'manual', ?, ?, ?, ?)`,
        args: [yearA, userA, now, now],
      },
    ],
    "write",
  );
  const { appRouter } = await import("./index");
  apiA = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userA) },
  });
  apiB = createRouterClient(appRouter, {
    context: { headers: new Headers(), session: sessionFor(userB) },
  });
}, databaseHookTimeout);

afterAll(() => database.$client.close(), databaseHookTimeout);

describe("owned study projects and corpus API", () => {
  test("creates, indexes, searches, cites, reorders and detaches without moving a source", async () => {
    const project = await apiA.projects.create({
      title: "Révisions mécanique",
      description: "Chapitre énergie",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: "⚙️",
      color: "blue",
    });
    expect(project.revision).toBe(1);
    await expect(
      apiB.projects.get({ projectId: String(project.id) }),
    ).rejects.toThrow("not found");

    const added = await apiA.projects.addItem({
      projectId: String(project.id),
      kind: "material",
      referenceId: "projects-material-a",
      contextMode: "include",
      label: null,
    });
    expect(added.item?.referenceId).toBe("projects-material-a");
    expect(added.indexJobId).toBeString();

    const { runCorpusIndexSourceJob } = await import("../jobs/corpus");
    await runCorpusIndexSourceJob({
      ownerId: userA,
      originKind: "material",
      originId: "projects-material-a",
    });
    const status = await apiA.projects.indexStatus({
      kind: "material",
      referenceId: "projects-material-a",
    });
    expect(status.source.status).toBe("ready");
    expect(status.lexical.available).toBe(true);

    const indexedProject = await apiA.projects.get({
      projectId: String(project.id),
    });
    expect(indexedProject.items[0]).toMatchObject({
      trackingMode: "follow-head",
      selectorReviewRequired: false,
    });
    expect(indexedProject.items[0]!.sourceVersionId).toBeString();
    const pinned = await apiA.projects.setItemTracking({
      projectId: String(project.id),
      itemId: indexedProject.items[0]!.id,
      trackingMode: "pinned",
    });
    expect(pinned.item).toMatchObject({
      trackingMode: "pinned",
      sourceVersionId: indexedProject.items[0]!.currentVersionId,
    });
    await expect(
      apiB.projects.setItemTracking({
        projectId: String(project.id),
        itemId: indexedProject.items[0]!.id,
        trackingMode: "follow-head",
      }),
    ).rejects.toThrow("not found");
    const followed = await apiA.projects.setItemTracking({
      projectId: String(project.id),
      itemId: indexedProject.items[0]!.id,
      trackingMode: "follow-head",
    });
    expect(followed.item?.trackingMode).toBe("follow-head");

    const search = await apiA.projects.search({
      query: "cinétique",
      mode: "terms",
      projectIds: [String(project.id)],
      yearIds: [],
      subjectIds: [],
      originKinds: [],
      limit: 5,
      cursor: null,
    });
    expect(search.evidence).toHaveLength(1);
    const citation = await apiA.projects.readCitation({
      citationId: search.evidence[0]!.citationId,
    });
    expect(citation.text).toContain("cinétique");
    expect(citation.citation.openTarget).toMatchObject({
      kind: "material",
      resourceId: "projects-material-a",
      locator: { kind: "text", startOffset: 0 },
    });
    await expect(
      apiB.projects.readCitation({
        citationId: search.evidence[0]!.citationId,
      }),
    ).rejects.toThrow("not found");

    const current = await apiA.projects.get({ projectId: String(project.id) });
    await apiA.projects.reorderItems({
      projectId: String(project.id),
      revision: Number(current.project.revision),
      itemIds: current.items.map((item) => item.id),
    });
    await apiA.projects.removeItem({
      projectId: String(project.id),
      itemId: String(added.item!.id),
    });
    const sourceStillExists = await database.$client.execute(
      `SELECT id FROM material_documents WHERE id = 'projects-material-a'`,
    );
    expect(sourceStillExists.rows).toHaveLength(1);

    await apiA.projects.star({ projectId: String(project.id), starred: true });
    await apiA.projects.trash({ projectId: String(project.id) });
    expect(
      (await apiA.projects.list({ include: "trashed" })).map(
        (entry) => entry.id,
      ),
    ).toContain(project.id);
    await apiA.projects.restore({ projectId: String(project.id) });
    expect(
      (await apiA.projects.list({ include: "live" })).map((entry) => entry.id),
    ).toContain(project.id);
  });

  test("rejects cross-year and cross-owner sources and stale revisions", async () => {
    const project = await apiA.projects.create({
      title: "Isolation",
      description: "",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    await expect(
      apiB.projects.addItem({
        projectId: String(project.id),
        kind: "material",
        referenceId: "projects-material-a",
        contextMode: "include",
        label: null,
      }),
    ).rejects.toThrow();
    await apiA.projects.update({
      projectId: String(project.id),
      revision: 1,
      title: "Isolation mise à jour",
    });
    await expect(
      apiA.projects.update({
        projectId: String(project.id),
        revision: 1,
        title: "Écriture obsolète",
      }),
    ).rejects.toThrow("changed elsewhere");
  });

  test("reports lexical-only privacy without leaking optional provider configuration", async () => {
    const privacy = await apiA.projects.embeddingPrivacy();
    expect(privacy).toEqual({
      mode: "lexical-only",
      lexicalAvailable: true,
      vectorConfigured: false,
      vectorActive: false,
      vectorImplementation: "not-configured",
      configurationState: "disabled",
      sendsSourceContentToThirdParties: false,
      configuredProvider: null,
    });
  });

  test("rebuilds a configured vector space, reuses unchanged owned chunks and activates atomically", async () => {
    const { runCorpusEmbeddingUnavailableJob, runCorpusIndexSourceJob } =
      await import("../jobs/corpus");
    const { OpenAICompatibleEmbeddingProvider, QdrantVectorIndex } =
      await import("../search/vector-runtime");
    await runCorpusIndexSourceJob({
      ownerId: userA,
      originKind: "material",
      originId: "projects-material-a",
    });

    let embeddingCalls = 0;
    const embedding = new OpenAICompatibleEmbeddingProvider({
      baseUrl: "https://embeddings.example.test/v1",
      providerName: "fixture",
      model: "fixture-v1",
      dimension: 3,
      fetch: async (_input, init) => {
        embeddingCalls += 1;
        const body = JSON.parse(String(init?.body)) as { input: string[] };
        return Response.json({
          data: body.input.map((_, index) => ({
            index,
            embedding: [1, 0, index / Math.max(1, body.input.length)],
          })),
        });
      },
    });
    let collectionExists = false;
    let aliasActivations = 0;
    let storedPoints: Array<{
      payload: Record<string, unknown>;
      vector: number[];
    }> = [];
    const vector = new QdrantVectorIndex({
      baseUrl: "http://qdrant.internal:6333",
      collectionPrefix: "projects_test",
      descriptor: embedding.descriptor(),
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/collections/")) {
          return collectionExists
            ? Response.json({
                result: {
                  config: { params: { vectors: { size: 3 } } },
                },
              })
            : new Response(null, { status: 404 });
        }
        if (method === "PUT" && /\/collections\/[^/]+$/.test(url)) {
          collectionExists = true;
          return Response.json({ result: true });
        }
        if (method === "POST" && url.endsWith("/points/scroll")) {
          return Response.json({ result: { points: storedPoints } });
        }
        if (method === "PUT" && url.includes("/points?wait=true")) {
          const body = JSON.parse(String(init?.body)) as {
            points: typeof storedPoints;
          };
          storedPoints = body.points;
          return Response.json({ result: true });
        }
        if (method === "GET" && url.includes("/aliases/")) {
          return new Response(null, { status: 404 });
        }
        if (method === "POST" && url.endsWith("/collections/aliases")) {
          aliasActivations += 1;
          return Response.json({ result: true });
        }
        return new Response(null, { status: 404 });
      },
    });

    const first = await runCorpusEmbeddingUnavailableJob(
      { ownerId: userA },
      { runtime: { embedding, vector } },
    );
    expect(first).toMatchObject({
      stage: "activated",
      vectors: first.chunks,
      versions: 1,
    });
    expect(first.chunks).toBeGreaterThan(0);
    expect(storedPoints).toHaveLength(first.chunks);

    const second = await runCorpusEmbeddingUnavailableJob(
      { ownerId: userA },
      { runtime: { embedding, vector } },
    );
    expect(second).toMatchObject({
      stage: "activated",
      chunks: first.chunks,
      vectors: first.chunks,
      versions: 1,
    });
    expect(embeddingCalls).toBe(1);
    expect(aliasActivations).toBe(2);
  });
});
