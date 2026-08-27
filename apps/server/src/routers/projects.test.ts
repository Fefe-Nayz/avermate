import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createRouterClient } from "@orpc/server";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectRetrievalPolicyEnvironment } from "../search/project-retrieval-policy-state";

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

  test("does not demand cloud credentials or consent for a local embedding configuration", async () => {
    const configured = {
      CORPUS_EMBEDDING_ENABLED: "true",
      CORPUS_EMBEDDING_PROVIDER: "fixture-local",
      CORPUS_EMBEDDING_PLACEMENT: "full-self-host",
      CORPUS_EMBEDDING_BASE_URL: "http://embedding.internal:8080/v1",
      CORPUS_EMBEDDING_MODEL: "fixture-v1",
      CORPUS_EMBEDDING_DIMENSION: "3",
      CORPUS_VECTOR_URL: "http://qdrant.internal:6333",
      CORPUS_EMBEDDING_LOCAL: "true",
    } as const;
    const previous = Object.fromEntries(
      Object.keys(configured).map((key) => [key, process.env[key]]),
    );
    try {
      Object.assign(process.env, configured);
      const readiness = await apiA.retrieval.readiness();
      expect(readiness.embedding).toMatchObject({
        provider: "fixture-local",
        complete: true,
        credentialReady: true,
        consentRequired: false,
        consentReady: true,
        sendsSourceContentToThirdParties: false,
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("never exposes a hostile reranker endpoint through retrieval readiness", async () => {
    const configured = {
      CORPUS_RERANK_ENABLED: "true",
      CORPUS_RERANK_PROVIDER: "tei",
      CORPUS_RERANK_MODEL: "Alibaba-NLP/gte-multilingual-reranker-base",
      CORPUS_RERANK_PLACEMENT: "node",
      CORPUS_RERANK_BASE_URL:
        "https://operator:private-token@rerank.internal:8443?api_key=hidden",
      CORPUS_RERANK_NODE_ID: "private-node-identity",
      CORPUS_RERANK_MODEL_REVISION: "b".repeat(40),
      CORPUS_RERANK_IMAGE_DIGEST: `sha256:${"c".repeat(64)}`,
      CORPUS_RERANK_TEI_REVISION: "d".repeat(40),
    } as const;
    const previous = Object.fromEntries(
      Object.keys(configured).map((key) => [key, process.env[key]]),
    );
    try {
      Object.assign(process.env, configured);
      const readiness = await apiA.retrieval.readiness();
      expect(readiness.rerank).toMatchObject({
        enabled: true,
        complete: false,
        provider: "tei",
        placement: "node",
        reason: "incomplete",
      });
      const serialized = JSON.stringify(readiness);
      expect(serialized).not.toContain("private-token");
      expect(serialized).not.toContain("api_key");
      expect(serialized).not.toContain("private-node-identity");
      expect(serialized).not.toContain("rerank.internal");
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("owns retrieval policy per project, enforces CAS and refuses an unready advanced pipeline", async () => {
    const project = await apiA.projects.create({
      title: "Politique RAG",
      description: "",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    const initial = await apiA.projects.retrievalPolicy({
      projectId: String(project.id),
    });
    expect(initial).toMatchObject({
      projectId: project.id,
      revision: 1,
      configured: {
        retrievalMode: "lexical-only",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: null,
        rerankSpaceId: null,
      },
      status: "active",
      effectiveMode: "lexical",
      fallbackActive: false,
      embedding: {
        configurationReady: false,
        runtimeReady: false,
        vectorAvailable: false,
      },
    });
    await expect(
      apiB.projects.retrievalPolicy({ projectId: String(project.id) }),
    ).rejects.toThrow("not found");

    const updated = await apiA.projects.setRetrievalPolicy({
      projectId: String(project.id),
      revision: 1,
      retrievalMode: "lexical-only",
      fallbackPolicy: "fail",
      embeddingSpaceId: "ignored-for-lexical",
      rerankSpaceId: "ignored-for-lexical",
    });
    expect(updated).toMatchObject({
      revision: 2,
      status: "active",
      effectiveMode: "lexical",
      configured: {
        fallbackPolicy: "fail",
        embeddingSpaceId: null,
        rerankSpaceId: null,
      },
    });
    await expect(
      apiA.projects.setRetrievalPolicy({
        projectId: String(project.id),
        revision: 1,
        retrievalMode: "lexical-only",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: null,
        rerankSpaceId: null,
      }),
    ).rejects.toThrow("changed elsewhere");
    await expect(
      apiA.projects.setRetrievalPolicy({
        projectId: String(project.id),
        revision: 2,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: "emb_unowned-or-incompatible",
        rerankSpaceId: "rerank_unowned-or-incompatible",
      }),
    ).rejects.toThrow("Advanced retrieval is not ready");
  });

  test("activates dense hybrid retrieval without requiring a reranker", async () => {
    const project = await apiA.projects.create({
      title: "Hybride local sans reranker",
      description: "",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    const embeddingSpace = {
      id: "emb_local_ready",
      provider: "fixture-local",
      model: "fixture-v1",
      modelRevision: "1",
      dimensions: 3,
      modalities: ["text"] as ["text"],
      normalization: "provider-unit" as const,
      preprocessingRevision: "avermate-retrieval-v1",
      placement: "core" as const,
      registered: true,
    };
    const environment: ProjectRetrievalPolicyEnvironment = {
      lexical: {
        available: true,
        implementation: "sqlite-fts5-unicode61-v1",
      },
      embedding: {
        configurationReady: true,
        provider: embeddingSpace.provider,
        placement: "full-self-host",
        sendsSourceContentToThirdParties: false,
        credentialReady: true,
        consentRequired: false,
        consentReady: true,
        runtimeReady: true,
        vectorAvailable: true,
        vectorImplementation: "fixture-vector-index",
        compatibleSpace: embeddingSpace,
      },
      rerank: {
        configurationReady: false,
        provider: null,
        placement: null,
        credentialReady: true,
        consentRequired: false,
        consentReady: true,
        runtimeReady: false,
        compatibleSpace: null,
      },
      generation: {
        id: "egen_local_ready",
        state: "active",
        eligibleVersionCount: 1,
        indexedVersionCount: 1,
        unsupportedVersionCount: 0,
      },
    };
    const { setOwnedProjectRetrievalPolicy } =
      await import("../search/project-retrieval-policy");

    await expect(
      setOwnedProjectRetrievalPolicy(
        userA,
        {
          projectId: String(project.id),
          revision: 1,
          retrievalMode: "advanced-auto",
          fallbackPolicy: "hybrid-without-rerank",
          embeddingSpaceId: embeddingSpace.id,
          rerankSpaceId: "rerank_incompatible",
        },
        { inspectEnvironment: async () => environment },
      ),
    ).rejects.toThrow("rerank-space-incompatible");

    const updated = await setOwnedProjectRetrievalPolicy(
      userA,
      {
        projectId: String(project.id),
        revision: 1,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "hybrid-without-rerank",
        embeddingSpaceId: embeddingSpace.id,
        rerankSpaceId: null,
      },
      { inspectEnvironment: async () => environment },
    );

    expect(updated).toMatchObject({
      revision: 2,
      status: "active",
      effectiveMode: "hybrid",
      denseReady: true,
      rerankReady: false,
      fallbackActive: true,
      configured: {
        retrievalMode: "advanced-auto",
        fallbackPolicy: "hybrid-without-rerank",
        embeddingSpaceId: embeddingSpace.id,
        rerankSpaceId: null,
      },
    });
    const stored = await database.$client.execute({
      sql: `SELECT revision, retrievalMode, retrievalFallbackPolicy,
          embeddingSpaceId, rerankSpaceId
        FROM study_projects WHERE id = ? AND userId = ? LIMIT 1`,
      args: [project.id, userA],
    });
    expect(stored.rows[0]).toMatchObject({
      revision: 2,
      retrievalMode: "advanced-auto",
      retrievalFallbackPolicy: "hybrid-without-rerank",
      embeddingSpaceId: embeddingSpace.id,
      rerankSpaceId: null,
    });

    const bootstrapProject = await apiA.projects.create({
      title: "Hybride à indexer sans reranker",
      description: "",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    const bootstrap = await setOwnedProjectRetrievalPolicy(
      userA,
      {
        projectId: String(bootstrapProject.id),
        revision: 1,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "hybrid-without-rerank",
        embeddingSpaceId: embeddingSpace.id,
        rerankSpaceId: null,
      },
      {
        inspectEnvironment: async () => ({
          ...environment,
          embedding: {
            ...environment.embedding,
            vectorAvailable: false,
            vectorImplementation: "vector-generation-unavailable",
          },
          generation: {
            id: null,
            state: null,
            eligibleVersionCount: 1,
            indexedVersionCount: 0,
            unsupportedVersionCount: 0,
          },
        }),
      },
    );
    expect(bootstrap).toMatchObject({
      status: "degraded",
      effectiveMode: "unavailable",
      denseReady: false,
      rerankReady: false,
      reasons: expect.arrayContaining(["embedding-reindex-required"]),
      reindex: { required: true, canReindex: true },
    });
  });

  test("can reactivate advanced retrieval and bootstrap a new generation after the last project disables its owner fence", async () => {
    const userId = "projects-reactivation-user";
    const materialId = "projects-reactivation-material";
    const yearId = "projects-reactivation-year";
    const now = Math.floor(Date.now() / 1_000);
    await database.$client.batch(
      [
        {
          sql: `INSERT INTO users
              (id, name, email, emailVerified, role, banned, createdAt, updatedAt)
            VALUES (?, 'Reactivation', ?, 1, 'user', 0, ?, ?)`,
          args: [userId, `${userId}@example.test`, now, now],
        },
        {
          sql: `INSERT INTO years
              (id, name, startsAt, endsAt, userId, createdAt, updatedAt)
            VALUES (?, 'Reactivation', ?, ?, ?, ?, ?)`,
          args: [yearId, now, now + 31_536_000, userId, now, now],
        },
        {
          sql: `INSERT INTO material_documents
              (id, title, sourceType, textContent, origin, yearId, userId,
               createdAt, updatedAt)
            VALUES (?, 'Fence bootstrap', 'text', ?, 'manual', ?, ?, ?, ?)`,
          args: [
            materialId,
            "A source that must be embedded after explicit reactivation.",
            yearId,
            userId,
            now,
            now,
          ],
        },
      ],
      "write",
    );
    const api = createRouterClient<AppRouter, Record<never, never>>(
      (await import("./index")).appRouter,
      {
        context: { headers: new Headers(), session: sessionFor(userId) },
      },
    );
    const project = await api.projects.create({
      title: "Réactivation du RAG",
      description: "",
      yearId,
      subjectId: null,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    await api.projects.addItem({
      projectId: String(project.id),
      kind: "material",
      referenceId: materialId,
      contextMode: "include",
      label: null,
    });
    const { runCorpusIndexSourceJob } = await import("../jobs/corpus");
    await runCorpusIndexSourceJob({
      ownerId: userId,
      originKind: "material",
      originId: materialId,
    });

    const configured = {
      AVERMATE_DEPLOYMENT_MODE: "full-self-host",
      CORPUS_EMBEDDING_ENABLED: "true",
      CORPUS_EMBEDDING_PROVIDER: "fixture-reactivation",
      CORPUS_EMBEDDING_PLACEMENT: "full-self-host",
      CORPUS_EMBEDDING_BASE_URL: "http://embedding.internal:8080/v1",
      CORPUS_EMBEDDING_MODEL: "fixture-v1",
      CORPUS_EMBEDDING_DIMENSION: "3",
      CORPUS_VECTOR_URL: "http://qdrant.internal:6333",
      CORPUS_EMBEDDING_LOCAL: "true",
      CORPUS_RERANK_ENABLED: "false",
    } as const;
    const previous = Object.fromEntries(
      Object.keys(configured).map((key) => [key, process.env[key]]),
    );
    try {
      Object.assign(process.env, configured);
      const initial = await api.projects.retrievalPolicy({
        projectId: String(project.id),
      });
      const compatibleSpace = initial.embedding.compatibleSpaces[0];
      const embeddingSpaceId = compatibleSpace?.id;
      expect(embeddingSpaceId).toBeString();

      const advanced = await api.projects.setRetrievalPolicy({
        projectId: String(project.id),
        revision: initial.revision,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "hybrid-without-rerank",
        embeddingSpaceId: embeddingSpaceId!,
        rerankSpaceId: null,
      });
      expect(advanced).toMatchObject({
        configured: { retrievalMode: "advanced-auto" },
        reasons: expect.arrayContaining(["embedding-reindex-required"]),
        reindex: { required: true, canReindex: true },
      });

      const { readEmbeddingPublicationFence } =
        await import("../search/embedding-publication-fence");
      const initialFence = await readEmbeddingPublicationFence(userId);
      expect(initialFence.enabled).toBe(true);

      const lexical = await api.projects.setRetrievalPolicy({
        projectId: String(project.id),
        revision: advanced.revision,
        retrievalMode: "lexical-only",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: null,
        rerankSpaceId: null,
      });
      const disabledFence = await readEmbeddingPublicationFence(userId);
      expect(disabledFence).toMatchObject({ enabled: false });
      expect(disabledFence.publicationEpoch).toBeGreaterThan(
        initialFence.publicationEpoch,
      );
      await database.$client.batch(
        [
          {
            sql: `INSERT INTO corpus_embedding_spaces
                (id, descriptorJson, descriptorDigest, createdAt)
              VALUES (?, ?, ?, ?)`,
            args: [
              embeddingSpaceId!,
              JSON.stringify(compatibleSpace),
              "d".repeat(64),
              now,
            ],
          },
          {
            sql: `INSERT INTO corpus_embedding_generations
                (id, userId, spaceId, state, publicationEpoch,
                 versionSetDigest, expectedVersionCount, indexedVersionCount,
                 activatedAt, createdAt, updatedAt)
              VALUES ('projects-reactivation-stale-generation', ?, ?, 'active',
                ?, ?, 1, 1, ?, ?, ?)`,
            args: [
              userId,
              embeddingSpaceId!,
              initialFence.publicationEpoch,
              "e".repeat(64),
              now,
              now,
              now,
            ],
          },
        ],
        "write",
      );
      const disabledReadiness = await api.retrieval.readiness();
      expect(disabledReadiness.embedding.publicationFence).toEqual(
        disabledFence,
      );
      expect(
        disabledReadiness.embedding.generations.find(
          (generation) =>
            generation.id === "projects-reactivation-stale-generation",
        ),
      ).toMatchObject({
        state: "active",
        effectiveState: "superseded",
        publicationEpoch: initialFence.publicationEpoch,
        isCurrentPublicationEpoch: false,
        publicationAuthorized: false,
      });

      const disabledReadModel = await api.projects.retrievalPolicy({
        projectId: String(project.id),
      });
      expect(disabledReadModel).toMatchObject({
        revision: lexical.revision,
        configured: { retrievalMode: "lexical-only" },
        embedding: {
          runtimeReady: true,
          compatibleSpaces: [{ id: embeddingSpaceId }],
        },
      });

      const reactivated = await api.projects.setRetrievalPolicy({
        projectId: String(project.id),
        revision: lexical.revision,
        retrievalMode: "advanced-auto",
        fallbackPolicy: "hybrid-without-rerank",
        embeddingSpaceId: embeddingSpaceId!,
        rerankSpaceId: null,
      });
      expect(reactivated).toMatchObject({
        configured: { retrievalMode: "advanced-auto" },
        reasons: expect.arrayContaining(["embedding-reindex-required"]),
        reindex: {
          required: true,
          canReindex: true,
          eligibleVersionCount: 1,
          indexedVersionCount: 0,
        },
      });
      const reenabledFence = await readEmbeddingPublicationFence(userId);
      expect(reenabledFence).toMatchObject({ enabled: true });
      expect(reenabledFence.publicationEpoch).toBeGreaterThan(
        disabledFence.publicationEpoch,
      );
      expect(
        (await api.retrieval.readiness()).embedding.generations.find(
          (generation) =>
            generation.id === "projects-reactivation-stale-generation",
        ),
      ).toMatchObject({
        state: "active",
        effectiveState: "superseded",
        publicationAuthorized: false,
      });

      const rebuild = await api.retrieval.reindex({
        projectId: String(project.id),
      });
      const queued = await database.$client.execute({
        sql: `SELECT payload, status FROM jobs
          WHERE id = ? AND userId = ? LIMIT 1`,
        args: [rebuild.jobId, userId],
      });
      expect(queued.rows[0]?.status).toBe("queued");
      expect(JSON.parse(String(queued.rows[0]?.payload))).toMatchObject({
        ownerId: userId,
        scope: "advanced-projects",
        requestedProjectId: project.id,
        publicationEpoch: reenabledFence.publicationEpoch,
      });
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("fences a captured rebuild when one advanced project leaves and rebuilds the remaining live corpus", async () => {
    const userId = "projects-policy-race-user";
    const yearId = "projects-policy-race-year";
    const now = Math.floor(Date.now() / 1_000);
    await database.$client.batch(
      [
        {
          sql: `INSERT INTO users
              (id, name, email, emailVerified, role, banned, createdAt, updatedAt)
            VALUES (?, 'Policy race', ?, 1, 'user', 0, ?, ?)`,
          args: [userId, `${userId}@example.test`, now, now],
        },
        {
          sql: `INSERT INTO years
              (id, name, startsAt, endsAt, userId, createdAt, updatedAt)
            VALUES (?, 'Policy race', ?, ?, ?, ?, ?)`,
          args: [yearId, now, now + 31_536_000, userId, now, now],
        },
        ...["a", "b"].map((suffix) => ({
          sql: `INSERT INTO material_documents
              (id, title, sourceType, textContent, origin, yearId, userId,
               createdAt, updatedAt)
            VALUES (?, ?, 'text', ?, 'manual', ?, ?, ?, ?)`,
          args: [
            `projects-policy-race-material-${suffix}`,
            `Policy race ${suffix}`,
            `Corpus ${suffix} captured before the policy transition.`,
            yearId,
            userId,
            now,
            now,
          ],
        })),
      ],
      "write",
    );
    const api = createRouterClient<AppRouter, Record<never, never>>(
      (await import("./index")).appRouter,
      {
        context: { headers: new Headers(), session: sessionFor(userId) },
      },
    );
    const projects = [];
    const { runCorpusEmbeddingUnavailableJob, runCorpusIndexSourceJob } =
      await import("../jobs/corpus");
    for (const suffix of ["a", "b"] as const) {
      const project = await api.projects.create({
        title: `Policy race ${suffix}`,
        description: "",
        yearId,
        subjectId: null,
        instructionsMarkdown: null,
        contextPolicyVersion: 1,
        contextPolicyJson: null,
        emoji: null,
        color: null,
      });
      await api.projects.addItem({
        projectId: String(project.id),
        kind: "material",
        referenceId: `projects-policy-race-material-${suffix}`,
        contextMode: "include",
        label: null,
      });
      await runCorpusIndexSourceJob({
        ownerId: userId,
        originKind: "material",
        originId: `projects-policy-race-material-${suffix}`,
      });
      projects.push(project);
    }

    const descriptor = {
      id: "emb_projects_policy_race",
      provider: "fixture",
      model: "fixture-v1",
      modelRevision: "1",
      dimensions: 3,
      modalities: ["text" as const],
      normalization: "provider-unit" as const,
      preprocessingRevision: "avermate-retrieval-v1",
      placement: "core" as const,
    };
    const environment: ProjectRetrievalPolicyEnvironment = {
      lexical: {
        available: true,
        implementation: "sqlite-fts5-unicode61-v1",
      },
      embedding: {
        configurationReady: true,
        provider: descriptor.provider,
        placement: "full-self-host",
        sendsSourceContentToThirdParties: false,
        credentialReady: true,
        consentRequired: false,
        consentReady: true,
        runtimeReady: true,
        vectorAvailable: false,
        vectorImplementation: "vector-generation-unavailable",
        compatibleSpace: { ...descriptor, registered: false },
      },
      rerank: {
        configurationReady: false,
        provider: null,
        placement: null,
        credentialReady: true,
        consentRequired: false,
        consentReady: true,
        runtimeReady: false,
        compatibleSpace: null,
      },
      generation: {
        id: null,
        state: null,
        eligibleVersionCount: 1,
        indexedVersionCount: 0,
        unsupportedVersionCount: 0,
      },
    };
    const { setOwnedProjectRetrievalPolicy } =
      await import("../search/project-retrieval-policy");
    for (const project of projects) {
      const current = await api.projects.get({
        projectId: String(project.id),
      });
      await setOwnedProjectRetrievalPolicy(
        userId,
        {
          projectId: String(project.id),
          revision: current.project.revision,
          retrievalMode: "advanced-auto",
          fallbackPolicy: "hybrid-without-rerank",
          embeddingSpaceId: descriptor.id,
          rerankSpaceId: null,
        },
        { inspectEnvironment: async () => environment },
      );
    }

    const { readEmbeddingPublicationFence } =
      await import("../search/embedding-publication-fence");
    const capturedFence = await readEmbeddingPublicationFence(userId);
    let reusableEnteredResolve!: () => void;
    let releaseReusableResolve!: () => void;
    const reusableEntered = new Promise<void>((resolve) => {
      reusableEnteredResolve = resolve;
    });
    const releaseReusable = new Promise<void>((resolve) => {
      releaseReusableResolve = resolve;
    });
    let blocked = false;
    let providerCallsAfterPolicyBoundary = 0;
    const { QdrantVectorIndex } = await import("../search/vector-runtime");
    const vector = new QdrantVectorIndex({
      baseUrl: "http://qdrant.internal:6333",
      collectionPrefix: "projects_policy_race",
      descriptor,
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/collections/")) {
          return Response.json({
            result: { config: { params: { vectors: { size: 3 } } } },
          });
        }
        if (method === "POST" && url.endsWith("/points/scroll")) {
          if (!blocked) {
            blocked = true;
            reusableEnteredResolve();
            await releaseReusable;
          }
          return Response.json({ result: { points: [] } });
        }
        if (method === "POST" && url.includes("/points/delete?wait=true")) {
          return Response.json({ result: true });
        }
        return Response.json({ result: true });
      },
    });
    const embedding = {
      descriptor: () => descriptor,
      embedText: async (input: readonly { contentHash: string }[]) => {
        providerCallsAfterPolicyBoundary += 1;
        return input.map((entry) => ({
          contentHash: entry.contentHash,
          values: [1, 0, 0],
        }));
      },
    };
    const capturedRebuild = runCorpusEmbeddingUnavailableJob(
      {
        ownerId: userId,
        scope: "advanced-projects",
        publicationEpoch: capturedFence.publicationEpoch,
      },
      { runtime: { embedding, vector } as never },
    );
    await reusableEntered;

    const leaving = await api.projects.get({
      projectId: String(projects[0]!.id),
    });
    await setOwnedProjectRetrievalPolicy(
      userId,
      {
        projectId: String(projects[0]!.id),
        revision: leaving.project.revision,
        retrievalMode: "lexical-only",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: null,
        rerankSpaceId: null,
      },
      { inspectEnvironment: async () => environment },
    );
    const reducedFence = await readEmbeddingPublicationFence(userId);
    expect(reducedFence).toMatchObject({ enabled: true });
    expect(reducedFence.publicationEpoch).toBeGreaterThan(
      capturedFence.publicationEpoch,
    );
    const replacement = await database.$client.execute({
      sql: `SELECT id, payload, status FROM jobs
        WHERE userId = ? AND kind = 'corpus.reembedSpace'
          AND idempotencyKey = ? LIMIT 1`,
      args: [
        userId,
        `retrieval-auto-reindex:epoch:${reducedFence.publicationEpoch}`,
      ],
    });
    expect(replacement.rows[0]?.status).toBe("queued");
    expect(JSON.parse(String(replacement.rows[0]?.payload))).toMatchObject({
      ownerId: userId,
      scope: "advanced-projects",
      publicationEpoch: reducedFence.publicationEpoch,
    });

    releaseReusableResolve();
    await expect(capturedRebuild).rejects.toThrow(
      "CORPUS_EMBEDDING_PUBLICATION_FENCE_CHANGED",
    );
    expect(providerCallsAfterPolicyBoundary).toBe(0);

    await api.projects.trash({ projectId: String(projects[1]!.id) });
    const trashedFence = await readEmbeddingPublicationFence(userId);
    expect(trashedFence.enabled).toBe(false);
    expect(trashedFence.publicationEpoch).toBeGreaterThan(
      reducedFence.publicationEpoch,
    );
    const cancelledReplacement = await database.$client.execute({
      sql: `SELECT status FROM jobs WHERE id = ? AND userId = ? LIMIT 1`,
      args: [String(replacement.rows[0]?.id), userId],
    });
    expect(cancelledReplacement.rows[0]?.status).toBe("cancelled");

    await api.projects.restore({ projectId: String(projects[1]!.id) });
    const restoredFence = await readEmbeddingPublicationFence(userId);
    expect(restoredFence.enabled).toBe(true);
    expect(restoredFence.publicationEpoch).toBeGreaterThan(
      trashedFence.publicationEpoch,
    );
    const restoredRebuild = await database.$client.execute({
      sql: `SELECT payload, status FROM jobs WHERE userId = ? AND kind = ?
        AND idempotencyKey = ? LIMIT 1`,
      args: [
        userId,
        "corpus.reembedSpace",
        `retrieval-auto-reindex:epoch:${restoredFence.publicationEpoch}`,
      ],
    });
    expect(restoredRebuild.rows[0]?.status).toBe("queued");
  });

  test("bumps the project revision atomically when retrieval coverage membership changes", async () => {
    const project = await apiA.projects.create({
      title: "Révision du corpus projet",
      description: "",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    const added = await apiA.projects.addItem({
      projectId: String(project.id),
      kind: "material",
      referenceId: "projects-material-a",
      contextMode: "include",
      label: null,
    });
    expect(
      (await apiA.projects.retrievalPolicy({ projectId: String(project.id) }))
        .revision,
    ).toBe(2);
    await expect(
      apiA.projects.setRetrievalPolicy({
        projectId: String(project.id),
        revision: 1,
        retrievalMode: "lexical-only",
        fallbackPolicy: "lexical-only",
        embeddingSpaceId: null,
        rerankSpaceId: null,
      }),
    ).rejects.toThrow("changed elsewhere");

    const contextMode = await apiA.projects.setItemContextMode({
      projectId: String(project.id),
      itemId: String(added.item?.id),
      contextMode: "on-demand",
    });
    expect(contextMode).toMatchObject({
      revision: 3,
      item: { contextMode: "on-demand" },
    });
    await expect(
      apiB.projects.setItemContextMode({
        projectId: String(project.id),
        itemId: String(added.item?.id),
        contextMode: "exclude",
      }),
    ).rejects.toThrow("not found");

    await apiA.projects.setItemTracking({
      projectId: String(project.id),
      itemId: String(added.item?.id),
      trackingMode: "pinned",
    });
    expect(
      (await apiA.projects.get({ projectId: String(project.id) })).project
        .revision,
    ).toBe(4);

    await apiA.projects.removeItem({
      projectId: String(project.id),
      itemId: String(added.item?.id),
    });
    expect(
      (await apiA.projects.get({ projectId: String(project.id) })).project
        .revision,
    ).toBe(5);
  });

  test("summarizes indexed and context sources without surfacing excluded recent context", async () => {
    const { runCorpusIndexSourceJob } = await import("../jobs/corpus");
    await runCorpusIndexSourceJob({
      ownerId: userA,
      originKind: "material",
      originId: "projects-material-a",
    });
    const now = Math.floor(Date.now() / 1_000);
    await database.$client.batch(
      [
        {
          sql: `INSERT INTO material_documents (id, title, sourceType, textContent, origin, yearId, userId, createdAt, updatedAt) VALUES ('projects-material-on-demand', 'Annexe', 'text', 'Une annexe à demander.', 'manual', ?, ?, ?, ?)`,
          args: [yearA, userA, now, now],
        },
        {
          sql: `INSERT INTO material_documents (id, title, sourceType, textContent, origin, yearId, userId, createdAt, updatedAt) VALUES ('projects-material-excluded', 'Brouillon', 'text', 'Un brouillon exclu.', 'manual', ?, ?, ?, ?)`,
          args: [yearA, userA, now, now],
        },
      ],
      "write",
    );

    const project = await apiA.projects.create({
      title: "Résumé des sources",
      description: "",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    const included = await apiA.projects.addItem({
      projectId: String(project.id),
      kind: "material",
      referenceId: "projects-material-a",
      contextMode: "include",
      label: null,
    });
    const onDemand = await apiA.projects.addItem({
      projectId: String(project.id),
      kind: "material",
      referenceId: "projects-material-on-demand",
      contextMode: "on-demand",
      label: null,
    });
    const excluded = await apiA.projects.addItem({
      projectId: String(project.id),
      kind: "material",
      referenceId: "projects-material-excluded",
      contextMode: "exclude",
      label: null,
    });
    await runCorpusIndexSourceJob({
      ownerId: userA,
      originKind: "material",
      originId: "projects-material-excluded",
    });

    const result = await apiA.projects.get({ projectId: String(project.id) });
    expect(result.sourceSummary).toMatchObject({
      total: 3,
      indexed: 2,
      included: 1,
      onDemand: 1,
      excluded: 1,
      contextEligible: 2,
      contextSearchable: 1,
      automaticEligible: 1,
      automaticSearchable: 1,
    });
    expect(result.sourceSummary.recentContextItemIds).toContain(
      String(included.item?.id),
    );
    expect(result.sourceSummary.recentContextItemIds).toContain(
      String(onDemand.item?.id),
    );
    expect(result.sourceSummary.recentContextItemIds).not.toContain(
      String(excluded.item?.id),
    );
  });

  test("scopes project reindexing to opted-in Core sources, preserves other advanced projects and reuses chunks", async () => {
    const { runCorpusEmbeddingUnavailableJob, runCorpusIndexSourceJob } =
      await import("../jobs/corpus");
    const { OpenAICompatibleEmbeddingProvider, QdrantVectorIndex } =
      await import("../search/vector-runtime");
    const now = Math.floor(Date.now() / 1_000);
    const scopedOrigins = [
      "projects-reindex-include",
      "projects-reindex-on-demand",
      "projects-reindex-exclude",
      "projects-reindex-other-advanced",
      "projects-reindex-node-private",
      "projects-reindex-lexical-only",
    ] as const;
    await database.$client.batch(
      scopedOrigins.map((id) => ({
        sql: `INSERT INTO material_documents (
            id, title, sourceType, textContent, origin, yearId, userId,
            createdAt, updatedAt
          ) VALUES (?, ?, 'text', ?, 'manual', ?, ?, ?, ?)`,
        args: [id, id, `Contenu ${id}`, yearA, userA, now, now],
      })),
      "write",
    );
    const scopedProject = await apiA.projects.create({
      title: "Réindexation privée",
      description: "",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    const otherAdvancedProject = await apiA.projects.create({
      title: "Autre projet avancé",
      description: "",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    const lexicalProject = await apiA.projects.create({
      title: "Projet lexical",
      description: "",
      yearId: yearA,
      subjectId: subjectA,
      instructionsMarkdown: null,
      contextPolicyVersion: 1,
      contextPolicyJson: null,
      emoji: null,
      color: null,
    });
    for (const [referenceId, contextMode] of [
      ["projects-reindex-include", "include"],
      ["projects-reindex-on-demand", "on-demand"],
      ["projects-reindex-exclude", "exclude"],
    ] as const) {
      await apiA.projects.addItem({
        projectId: String(scopedProject.id),
        kind: "material",
        referenceId,
        contextMode,
        label: null,
      });
    }
    for (const referenceId of [
      "projects-reindex-other-advanced",
      "projects-reindex-node-private",
    ] as const) {
      await apiA.projects.addItem({
        projectId: String(otherAdvancedProject.id),
        kind: "material",
        referenceId,
        contextMode: "include",
        label: null,
      });
    }
    await apiA.projects.addItem({
      projectId: String(lexicalProject.id),
      kind: "material",
      referenceId: "projects-reindex-lexical-only",
      contextMode: "include",
      label: null,
    });
    for (const originId of scopedOrigins) {
      await runCorpusIndexSourceJob({
        ownerId: userA,
        originKind: "material",
        originId,
      });
    }

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
    const rerankDescriptor = {
      id: "rerank-fixture",
      provider: "fixture",
      model: "fixture-reranker",
      modelRevision: "fixture-reranker@1",
      languages: ["fr"],
      modalities: ["text" as const],
      maximumCandidates: 50,
      maximumTokensPerCandidate: 8_192,
      scoreSemantics: "relevance-ordered" as const,
      placement: "node" as const,
      costUnit: "compute-token" as const,
    };
    let collectionExists = false;
    let aliasActivations = 0;
    let storedPoints: Array<{
      id: string | number;
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
        if (method === "POST" && url.endsWith("/points/query")) {
          return Response.json({
            result: {
              points: storedPoints.map((point, index) => ({
                score: 1 - index / Math.max(1, storedPoints.length + 1),
                payload: point.payload,
              })),
            },
          });
        }
        if (method === "PUT" && url.includes("/points?wait=true")) {
          const body = JSON.parse(String(init?.body)) as {
            points: typeof storedPoints;
          };
          for (const point of body.points) {
            const current = storedPoints.findIndex(
              (candidate) => candidate.id === point.id,
            );
            if (current === -1) storedPoints.push(point);
            else storedPoints[current] = point;
          }
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

    const embeddingDescriptor = embedding.descriptor();
    const { projectGenerationCoverage, setOwnedProjectRetrievalPolicy } =
      await import("../search/project-retrieval-policy");
    const readyEnvironment =
      (eligibleVersionCount: number, vectorAvailable = true) =>
      async () => ({
        lexical: {
          available: true,
          implementation: "sqlite-fts5-unicode61-v1",
        },
        embedding: {
          configurationReady: true,
          provider: embeddingDescriptor.provider,
          placement: "full-self-host",
          sendsSourceContentToThirdParties: false,
          credentialReady: true,
          consentRequired: false,
          consentReady: true,
          runtimeReady: true,
          vectorAvailable,
          vectorImplementation: vectorAvailable
            ? "fixture-vector-index"
            : "vector-generation-unavailable",
          compatibleSpace: { ...embeddingDescriptor, registered: false },
        },
        rerank: {
          configurationReady: true,
          provider: rerankDescriptor.provider,
          placement: "node",
          credentialReady: true,
          consentRequired: false,
          consentReady: true,
          runtimeReady: true,
          compatibleSpace: rerankDescriptor,
        },
        generation: {
          id: null,
          state: null,
          eligibleVersionCount,
          indexedVersionCount: 0,
          unsupportedVersionCount: 0,
        },
      });
    for (const [projectId, eligibleVersionCount, vectorAvailable] of [
      [String(scopedProject.id), 2, false],
      [String(otherAdvancedProject.id), 2, true],
    ] as const) {
      const policy = await apiA.projects.retrievalPolicy({ projectId });
      const updated = await setOwnedProjectRetrievalPolicy(
        userA,
        {
          projectId,
          revision: policy.revision,
          retrievalMode: "advanced-auto",
          fallbackPolicy: "fail",
          embeddingSpaceId: embeddingDescriptor.id,
          rerankSpaceId: rerankDescriptor.id,
        },
        {
          inspectEnvironment: readyEnvironment(
            eligibleVersionCount,
            vectorAvailable,
          ),
        },
      );
      expect(updated).toMatchObject({
        configured: { retrievalMode: "advanced-auto" },
        status: "degraded",
        reasons: ["embedding-reindex-required"],
      });
    }
    await database.$client.execute({
      sql: `UPDATE content_sources SET placement = 'node',
          placementRef = 'node-private'
        WHERE userId = ? AND originKind = 'material'
          AND originId = 'projects-reindex-node-private'`,
      args: [userA],
    });
    const placementState = await apiA.projects.retrievalPolicy({
      projectId: String(otherAdvancedProject.id),
    });
    expect(placementState.reindex.unsupportedVersionCount).toBe(1);
    expect(placementState.reasons).toContain(
      "embedding-source-placement-unsupported",
    );

    const projectJob = await apiA.retrieval.reindex({
      projectId: String(scopedProject.id),
    });
    const projectJobRow = await database.$client.execute({
      sql: `SELECT payload FROM jobs WHERE id = ? AND userId = ? LIMIT 1`,
      args: [projectJob.jobId, userA],
    });
    const projectJobPayload = JSON.parse(
      String(projectJobRow.rows[0]?.payload),
    ) as Record<string, unknown>;
    expect(projectJobPayload).toMatchObject({
      ownerId: userA,
      scope: "advanced-projects",
      requestedProjectId: scopedProject.id,
    });
    expect(projectJobPayload.publicationEpoch).toBeNumber();
    await expect(
      apiB.retrieval.reindex({ projectId: String(scopedProject.id) }),
    ).rejects.toThrow("not found");
    const globalJob = await apiA.retrieval.reindex({});
    const globalJobRow = await database.$client.execute({
      sql: `SELECT payload FROM jobs WHERE id = ? AND userId = ? LIMIT 1`,
      args: [globalJob.jobId, userA],
    });
    const globalJobPayload = JSON.parse(
      String(globalJobRow.rows[0]?.payload),
    ) as Record<string, unknown>;
    expect(globalJobPayload).toMatchObject({
      ownerId: userA,
      scope: "all",
    });
    expect(globalJobPayload.publicationEpoch).toBeNumber();
    expect(Number(globalJobPayload.publicationEpoch)).toBe(
      Number(projectJobPayload.publicationEpoch),
    );
    const publicationEpoch = Number(globalJobPayload.publicationEpoch);

    const first = await runCorpusEmbeddingUnavailableJob(
      {
        ownerId: userA,
        scope: "advanced-projects",
        requestedProjectId: scopedProject.id,
        publicationEpoch,
      },
      { runtime: { embedding, vector } },
    );
    expect(first).toMatchObject({
      stage: "activated",
      versions: 3,
      vectors: first.chunks,
    });
    if (first.stage !== "activated") {
      throw new Error("Expected an activated project embedding generation");
    }
    const firstGenerationFence = await database.$client.execute({
      sql: `SELECT publicationEpoch FROM corpus_embedding_generations
        WHERE id = ? AND userId = ? LIMIT 1`,
      args: [first.generationId, userA],
    });
    expect(Number(firstGenerationFence.rows[0]?.publicationEpoch)).toBe(
      publicationEpoch,
    );
    expect(first.chunks).toBeGreaterThan(0);
    expect(storedPoints).toHaveLength(first.chunks);
    const embeddedSourceIds = [
      ...new Set(storedPoints.map((point) => String(point.payload.sourceId))),
    ];
    const embeddedSources = await database.$client.execute({
      sql: `SELECT originId FROM content_sources
        WHERE userId = ? AND id IN (${embeddedSourceIds.map(() => "?").join(", ")})
        ORDER BY originId`,
      args: [userA, ...embeddedSourceIds],
    });
    expect(embeddedSources.rows.map((row) => String(row.originId))).toEqual([
      "projects-reindex-include",
      "projects-reindex-on-demand",
      "projects-reindex-other-advanced",
    ]);

    const { hybridCorpusSearch } = await import("../search/hybrid");
    const operationId = `project-policy-hybrid-${Date.now()}`;
    const hybrid = await hybridCorpusSearch(
      {
        ownerId: userA,
        query: "Contenu projects reindex include",
        mode: "terms",
        projectIds: [String(scopedProject.id)],
        contextAccess: "automatic",
        yearIds: [],
        subjectIds: [],
        originKinds: [],
        limit: 3,
        cursor: null,
        operationId,
      },
      {
        runtime: { embedding, vector },
        reranker: {
          descriptor: () => rerankDescriptor,
          rerank: async ({ operationId: rerankOperationId, candidates }) =>
            candidates.map((candidate, rank) => ({
              operationId: rerankOperationId,
              candidateId: candidate.id,
              rank,
              score: 1 - rank / Math.max(1, candidates.length + 1),
            })),
        },
        corpusGenerationId: first.generationId,
      },
    );
    expect(hybrid).toMatchObject({
      retrievalMode: "reranked",
      vectorUsed: true,
      rerankUsed: true,
    });
    for (const stage of ["dense", "fusion", "rerank"] as const) {
      expect(hybrid.stages.find((entry) => entry.stage === stage)?.status).toBe(
        "used",
      );
    }
    const trace = await database.$client.execute({
      sql: `SELECT stagesJson FROM retrieval_traces
        WHERE userId = ? AND operationId = ? LIMIT 1`,
      args: [userA, operationId],
    });
    const tracedStages = JSON.parse(
      String(trace.rows[0]?.stagesJson),
    ) as Array<{
      stage: string;
      status: string;
    }>;
    for (const stage of ["dense", "fusion", "rerank"] as const) {
      expect(tracedStages).toContainEqual(
        expect.objectContaining({ stage, status: "used" }),
      );
    }
    const callsAfterFirstGeneration = embeddingCalls;

    const second = await runCorpusEmbeddingUnavailableJob(
      {
        ownerId: userA,
        scope: "advanced-projects",
        requestedProjectId: scopedProject.id,
        publicationEpoch,
      },
      { runtime: { embedding, vector } },
    );
    expect(second).toMatchObject({
      stage: "activated",
      chunks: first.chunks,
      vectors: first.chunks,
      versions: first.versions,
    });
    expect(embeddingCalls).toBe(callsAfterFirstGeneration);
    expect(aliasActivations).toBe(2);

    const legacyBeforeFirstFenceRotation =
      await runCorpusEmbeddingUnavailableJob(
        { ownerId: userA },
        { runtime: { embedding, vector } },
      );
    expect(legacyBeforeFirstFenceRotation).toMatchObject({
      stage: "activated",
      versions: 3,
    });
    expect(aliasActivations).toBe(3);

    const lexicalVersion = await database.$client.execute({
      sql: `SELECT currentVersionId FROM content_sources
        WHERE userId = ? AND originKind = 'material'
          AND originId = 'projects-reindex-lexical-only' LIMIT 1`,
      args: [userA],
    });
    const skipped = await runCorpusEmbeddingUnavailableJob(
      {
        ownerId: userA,
        scope: "advanced-projects",
        triggerVersionId: String(lexicalVersion.rows[0]?.currentVersionId),
        publicationEpoch,
      },
      { runtime: { embedding, vector } },
    );
    expect(skipped).toMatchObject({
      stage: "skipped",
      reason: "trigger-version-not-in-advanced-project-scope",
      versions: 3,
    });
    expect(aliasActivations).toBe(3);
    await expect(
      runCorpusEmbeddingUnavailableJob(
        {
          ownerId: userA,
          scope: "advanced-projects",
          requestedProjectId: lexicalProject.id,
          publicationEpoch,
        },
        { runtime: { embedding, vector } },
      ),
    ).rejects.toThrow("CORPUS_REINDEX_PROJECT_POLICY_CHANGED");

    let firstAliasEnteredResolve!: () => void;
    let releaseFirstAliasResolve!: () => void;
    let secondAliasEnteredResolve!: () => void;
    const firstAliasEntered = new Promise<void>((resolve) => {
      firstAliasEnteredResolve = resolve;
    });
    const releaseFirstAlias = new Promise<void>((resolve) => {
      releaseFirstAliasResolve = resolve;
    });
    const secondAliasEntered = new Promise<void>((resolve) => {
      secondAliasEnteredResolve = resolve;
    });
    const aliasTargets: string[] = [];
    const appliedAliasTargets: string[] = [];
    const generationSearchTargets: string[] = [];
    const racingVector = new QdrantVectorIndex({
      baseUrl: "http://qdrant.internal:6333",
      collectionPrefix: "projects_race",
      descriptor: embedding.descriptor(),
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/collections/")) {
          return Response.json({
            result: { config: { params: { vectors: { size: 3 } } } },
          });
        }
        if (method === "POST" && url.endsWith("/points/scroll")) {
          return Response.json({ result: { points: [] } });
        }
        if (method === "PUT" && url.includes("/points?wait=true")) {
          return Response.json({ result: true });
        }
        if (method === "GET" && url.includes("/aliases/")) {
          return new Response(null, { status: 404 });
        }
        if (method === "POST" && url.endsWith("/collections/aliases")) {
          const body = JSON.parse(String(init?.body)) as {
            actions: Array<{
              create_alias?: { collection_name?: string };
            }>;
          };
          const target = String(
            body.actions.find((action) => action.create_alias)?.create_alias
              ?.collection_name,
          );
          aliasTargets.push(target);
          if (aliasTargets.length === 1) {
            firstAliasEnteredResolve();
            await releaseFirstAlias;
          } else {
            secondAliasEnteredResolve();
          }
          appliedAliasTargets.push(target);
          return Response.json({ result: true });
        }
        if (method === "POST" && url.endsWith("/points/query")) {
          generationSearchTargets.push(
            decodeURIComponent(
              new URL(url).pathname.split("/collections/")[1]!.split("/")[0]!,
            ),
          );
          return Response.json({ result: { points: [] } });
        }
        return new Response(null, { status: 404 });
      },
    });
    const concurrentA = runCorpusEmbeddingUnavailableJob(
      {
        ownerId: userA,
        scope: "advanced-projects",
        publicationEpoch,
      },
      { runtime: { embedding, vector: racingVector } },
    );
    await firstAliasEntered;
    const concurrentB = runCorpusEmbeddingUnavailableJob(
      {
        ownerId: userA,
        scope: "advanced-projects",
        publicationEpoch,
      },
      { runtime: { embedding, vector: racingVector } },
    );
    await secondAliasEntered;
    const publishedB = await concurrentB;
    releaseFirstAliasResolve();
    const publishedA = await concurrentA;
    if (publishedA.stage !== "activated" || publishedB.stage !== "activated") {
      throw new Error("Expected both concurrent generations to activate");
    }
    const activeAfterRace = await database.$client.execute({
      sql: `SELECT id FROM corpus_embedding_generations
        WHERE userId = ? AND spaceId = ? AND state = 'active' LIMIT 1`,
      args: [userA, embeddingDescriptor.id],
    });
    expect(String(activeAfterRace.rows[0]?.id)).toBe(publishedB.generationId);
    expect(appliedAliasTargets.at(-1)).toBe(aliasTargets[0]);
    expect(aliasTargets[0]).not.toBe(aliasTargets[1]);
    await racingVector
      .forGeneration(userA, String(activeAfterRace.rows[0]?.id))
      .search({
        ownerId: userA,
        spaceId: embeddingDescriptor.id,
        values: [1, 0, 0],
        limit: 1,
      });
    expect(generationSearchTargets.at(-1)).toBe(aliasTargets[1]);
    expect(generationSearchTargets.at(-1)).not.toBe(appliedAliasTargets.at(-1));

    const { readEmbeddingPublicationFence } =
      await import("../search/embedding-publication-fence");
    const { GEMINI_EMBEDDING_DISCLOSURE_REVISION } =
      await import("../search/gemini-embedding");
    const { COHERE_RERANK_DISCLOSURE_REVISION } =
      await import("../search/rerank-providers");
    await apiA.retrieval.grantConsent({
      provider: "gemini",
      capability: "embedding",
      disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
      policyRevision: "projects-test/1",
      confirmed: true,
    });
    await apiA.retrieval.grantConsent({
      provider: "cohere",
      capability: "rerank",
      disclosureRevision: COHERE_RERANK_DISCLOSURE_REVISION,
      policyRevision: "projects-test/1",
      confirmed: true,
    });
    await database.$client.execute({
      sql: `INSERT INTO jobs
          (id, kind, payload, status, runAt, idempotencyKey, userId,
           createdAt, updatedAt)
        VALUES ('projects-consent-running', 'corpus.reembedSpace', ?,
          'running', ?, 'projects-consent-running', ?, ?, ?)`,
      args: [
        JSON.stringify({
          ownerId: userA,
          scope: "advanced-projects",
          publicationEpoch,
        }),
        now,
        userA,
        now,
        now,
      ],
    });

    let reusableEnteredResolve!: () => void;
    let releaseReusableResolve!: () => void;
    const reusableEntered = new Promise<void>((resolve) => {
      reusableEnteredResolve = resolve;
    });
    const releaseReusable = new Promise<void>((resolve) => {
      releaseReusableResolve = resolve;
    });
    let reusableBlocked = false;
    let providerCallsAfterRevokeBoundary = 0;
    const revokeRaceVector = new QdrantVectorIndex({
      baseUrl: "http://qdrant.internal:6333",
      collectionPrefix: "projects_revoke_race",
      descriptor: embedding.descriptor(),
      fetch: async (input, init) => {
        const url = String(input);
        const method = init?.method ?? "GET";
        if (method === "GET" && url.includes("/collections/")) {
          return Response.json({
            result: { config: { params: { vectors: { size: 3 } } } },
          });
        }
        if (method === "POST" && url.endsWith("/points/scroll")) {
          if (!reusableBlocked) {
            reusableBlocked = true;
            reusableEnteredResolve();
            await releaseReusable;
          }
          return Response.json({ result: { points: [] } });
        }
        if (method === "POST" && url.includes("/points/delete?wait=true")) {
          return Response.json({ result: true });
        }
        return Response.json({ result: true });
      },
    });
    const revokeRaceEmbedding = {
      descriptor: () => embedding.descriptor(),
      embedText: async (input: readonly { contentHash: string }[]) => {
        providerCallsAfterRevokeBoundary += 1;
        return input.map((entry) => ({
          contentHash: entry.contentHash,
          values: [1, 0, 0],
        }));
      },
    };
    const revokeRace = runCorpusEmbeddingUnavailableJob(
      {
        ownerId: userA,
        scope: "advanced-projects",
        publicationEpoch,
      },
      {
        runtime: {
          embedding: revokeRaceEmbedding,
          vector: revokeRaceVector,
        },
      },
    );
    await reusableEntered;
    const fenceBeforeCohereRevoke = await readEmbeddingPublicationFence(userA);
    const cohereRevoked = await apiA.retrieval.revokeConsent({
      provider: "cohere",
      capability: "rerank",
    });
    expect(cohereRevoked).toMatchObject({
      revoked: true,
      publicationEpoch: null,
      queuedJobsCancelled: 0,
      runningJobsCancellationRequested: 0,
      requiresExplicitReenable: false,
    });
    expect(await readEmbeddingPublicationFence(userA)).toEqual(
      fenceBeforeCohereRevoke,
    );
    const revoked = await apiA.retrieval.revokeConsent({
      provider: "gemini",
      capability: "embedding",
    });
    expect(revoked).toMatchObject({
      revoked: true,
      queuedJobsCancelled: 2,
      runningJobsCancellationRequested: 1,
      requiresExplicitReenable: true,
    });
    if (revoked.publicationEpoch === null) {
      throw new Error("Expected Gemini revocation to rotate the fence");
    }
    expect(revoked.publicationEpoch).toBeGreaterThan(publicationEpoch);
    const revokedFence = await readEmbeddingPublicationFence(userA);
    expect(revokedFence).toEqual({
      enabled: false,
      publicationEpoch: revoked.publicationEpoch,
    });
    releaseReusableResolve();
    await expect(revokeRace).rejects.toThrow(
      "CORPUS_EMBEDDING_PUBLICATION_FENCE_CHANGED",
    );
    expect(providerCallsAfterRevokeBoundary).toBe(0);
    const cancelledByRevoke = await database.$client.execute({
      sql: `SELECT id, status FROM jobs WHERE id IN (?, ?, ?)`,
      args: [projectJob.jobId, globalJob.jobId, "projects-consent-running"],
    });
    const cancelledStatus = Object.fromEntries(
      cancelledByRevoke.rows.map((row) => [String(row.id), row.status]),
    );
    expect(cancelledStatus).toEqual({
      [globalJob.jobId]: "cancelled",
      "projects-consent-running": "running",
      [projectJob.jobId]: "cancelled",
    });
    const requestedCancellation = await database.$client.execute({
      sql: `SELECT cancellation FROM job_runtime_metadata
        WHERE jobId = 'projects-consent-running' LIMIT 1`,
    });
    expect(requestedCancellation.rows[0]?.cancellation).toBe("requested");
    const repeatedRevoke = await apiA.retrieval.revokeConsent({
      provider: "gemini",
      capability: "embedding",
    });
    expect(repeatedRevoke).toMatchObject({
      revoked: false,
      publicationEpoch: null,
      queuedJobsCancelled: 0,
      runningJobsCancellationRequested: 0,
      requiresExplicitReenable: false,
    });
    expect(await readEmbeddingPublicationFence(userA)).toEqual(revokedFence);

    await apiA.retrieval.grantConsent({
      provider: "gemini",
      capability: "embedding",
      disclosureRevision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
      policyRevision: "projects-test/2",
      confirmed: true,
    });
    expect(await readEmbeddingPublicationFence(userA)).toEqual(revokedFence);
    const reenabledJob = await apiA.retrieval.reindex({
      projectId: String(scopedProject.id),
    });
    const reenabledJobRow = await database.$client.execute({
      sql: `SELECT payload FROM jobs WHERE id = ? AND userId = ? LIMIT 1`,
      args: [reenabledJob.jobId, userA],
    });
    const reenabledPayload = JSON.parse(
      String(reenabledJobRow.rows[0]?.payload),
    ) as Record<string, unknown>;
    const reenabledEpoch = Number(reenabledPayload.publicationEpoch);
    expect(reenabledEpoch).toBeGreaterThan(revokedFence.publicationEpoch);
    expect(await readEmbeddingPublicationFence(userA)).toEqual({
      enabled: true,
      publicationEpoch: reenabledEpoch,
    });
    const coverageBeforeRebuild = await projectGenerationCoverage(
      userA,
      String(scopedProject.id),
      embeddingDescriptor.id,
      reenabledEpoch,
    );
    expect(coverageBeforeRebuild).toMatchObject({
      id: null,
      state: null,
      eligibleVersionCount: 2,
      indexedVersionCount: 0,
    });
    const protectedSource = await database.$client.execute({
      sql: `SELECT sources.id, sources.currentVersionId
        FROM content_sources AS sources
        WHERE sources.userId = ? AND sources.originKind = 'material'
          AND sources.originId = 'projects-reindex-include' LIMIT 1`,
      args: [userA],
    });
    const protectedVersionId = String(
      protectedSource.rows[0]?.currentVersionId,
    );
    const derivativeId = "projects-clear-protected-derivative";
    const derivativeFileId = "projects-clear-protected-file";
    const policiesBeforeClear = await database.$client.execute({
      sql: `SELECT id, revision, retrievalMode, retrievalFallbackPolicy,
          embeddingSpaceId, rerankSpaceId
        FROM study_projects WHERE id IN (?, ?) ORDER BY id`,
      args: [scopedProject.id, otherAdvancedProject.id],
    });
    await database.$client.batch(
      [
        {
          sql: `INSERT INTO files
            (id, provider, storageKey, url, mimeType, byteSize, purpose,
             status, previewStatus, userId, createdAt, updatedAt)
            VALUES (?, 'local', ?, ?, 'image/png', 128, 'preview',
              'stored', 'ready', ?, ?, ?)`,
          args: [
            derivativeFileId,
            `projects-clear/${derivativeFileId}`,
            `/files/${derivativeFileId}`,
            userA,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO content_derivatives
            (id, versionId, fileId, kind, status, locatorSchemaVersion,
             locatorJson, contentHash, mimeType, byteSize,
             estimatedInputTokens, rendererProfile, rendererImageDigest,
             metadataJson, createdAt, updatedAt)
            VALUES (?, ?, ?, 'page-image', 'ready', 1, ?, ?, 'image/png',
              128, 32, 'test-page-renderer', ?, '{}', ?, ?)`,
          args: [
            derivativeId,
            protectedVersionId,
            derivativeFileId,
            JSON.stringify({ kind: "pdf", page: 1 }),
            "a".repeat(64),
            `sha256:${"b".repeat(64)}`,
            now,
            now,
          ],
        },
        {
          sql: `INSERT INTO corpus_embedding_generations
            (id, userId, spaceId, state, versionSetDigest,
             expectedVersionCount, indexedVersionCount, activatedAt,
             createdAt, updatedAt)
            VALUES ('projects-clear-user-b-active', ?, ?, 'active', ?,
              0, 0, ?, ?, ?)`,
          args: [userB, embeddingDescriptor.id, "c".repeat(64), now, now, now],
        },
      ],
      "write",
    );

    let clearProviderEnteredResolve!: () => void;
    let releaseClearProviderResolve!: () => void;
    const clearProviderEntered = new Promise<void>((resolve) => {
      clearProviderEnteredResolve = resolve;
    });
    const releaseClearProvider = new Promise<void>((resolve) => {
      releaseClearProviderResolve = resolve;
    });
    let clearProviderCalls = 0;
    const clearRaceEmbedding = {
      descriptor: () => embedding.descriptor(),
      embedText: async (input: readonly { contentHash: string }[]) => {
        clearProviderCalls += 1;
        clearProviderEnteredResolve();
        await releaseClearProvider;
        return input.map((entry) => ({
          contentHash: entry.contentHash,
          values: [1, 0, 0],
        }));
      },
    };
    const clearRaceVector = new QdrantVectorIndex({
      baseUrl: "http://qdrant.internal:6333",
      collectionPrefix: "projects_clear_race",
      descriptor: embedding.descriptor(),
      fetch: async () => new Response(null, { status: 404 }),
    });
    const usageBeforeClearRace = await database.$client.execute({
      sql: `SELECT COUNT(*) AS count FROM corpus_embedding_usage
        WHERE userId = ? AND spaceId = ?`,
      args: [userA, embeddingDescriptor.id],
    });
    const inFlightAtClear = runCorpusEmbeddingUnavailableJob(
      {
        ownerId: userA,
        scope: "advanced-projects",
        publicationEpoch: reenabledEpoch,
      },
      {
        runtime: {
          embedding: clearRaceEmbedding,
          vector: clearRaceVector,
        },
      },
    );
    await clearProviderEntered;

    await expect(
      apiA.retrieval.clearIndex({
        projectId: String(scopedProject.id),
        confirmation: "disable-all-vector-generations",
      } as never),
    ).rejects.toThrow();
    const stillPublishedAfterRejectedProjectClear =
      await database.$client.execute({
        sql: `SELECT COUNT(*) AS count FROM corpus_embedding_generations
          WHERE userId = ? AND state IN ('active', 'staging')`,
        args: [userA],
      });
    expect(Number(stillPublishedAfterRejectedProjectClear.rows[0]?.count)).toBe(
      2,
    );

    const cleared = await apiA.retrieval.clearIndex({
      confirmation: "disable-all-vector-generations",
    });
    expect(cleared).toMatchObject({
      generationsDisabled: 2,
      versions: 3,
      queuedJobsCancelled: 1,
      runningJobsCancellationRequested: 1,
      vectorGenerationsCleaned: 0,
      vectorCleanup: "deferred",
      publicationState: "disabled",
      contentDerivativesDeleted: 0,
      sourceFilesDeleted: 0,
    });
    expect("projectsDisabled" in cleared).toBe(false);
    releaseClearProviderResolve();
    await expect(inFlightAtClear).rejects.toThrow(
      "CORPUS_EMBEDDING_PUBLICATION_FENCE_CHANGED",
    );
    expect(clearProviderCalls).toBe(1);
    const usageAfterClearRace = await database.$client.execute({
      sql: `SELECT COUNT(*) AS count FROM corpus_embedding_usage
        WHERE userId = ? AND spaceId = ?`,
      args: [userA, embeddingDescriptor.id],
    });
    expect(Number(usageAfterClearRace.rows[0]?.count)).toBe(
      Number(usageBeforeClearRace.rows[0]?.count) + 1,
    );
    const generationStates = await database.$client.execute({
      sql: `SELECT userId, state FROM corpus_embedding_generations
        WHERE (userId = ? OR id = 'projects-clear-user-b-active')
          AND state IN ('active', 'staging')
        ORDER BY userId`,
      args: [userA],
    });
    expect(generationStates.rows).toEqual([
      expect.objectContaining({ userId: userB, state: "active" }),
    ]);
    const preserved = await database.$client.execute({
      sql: `SELECT derivatives.status AS derivativeStatus,
          files.status AS fileStatus, sources.currentVersionId AS currentVersionId
        FROM content_derivatives AS derivatives
        JOIN files ON files.id = derivatives.fileId
        JOIN content_versions AS versions ON versions.id = derivatives.versionId
        JOIN content_sources AS sources ON sources.id = versions.sourceId
        WHERE derivatives.id = ? AND sources.userId = ? LIMIT 1`,
      args: [derivativeId, userA],
    });
    expect(preserved.rows[0]).toMatchObject({
      derivativeStatus: "ready",
      fileStatus: "stored",
      currentVersionId: protectedVersionId,
    });
    const policiesAfterClear = await database.$client.execute({
      sql: `SELECT id, revision, retrievalMode, retrievalFallbackPolicy,
          embeddingSpaceId, rerankSpaceId
        FROM study_projects WHERE id IN (?, ?) ORDER BY id`,
      args: [scopedProject.id, otherAdvancedProject.id],
    });
    expect(policiesAfterClear.rows).toEqual(policiesBeforeClear.rows);
    const disabledFence = await readEmbeddingPublicationFence(userA);
    expect(disabledFence.enabled).toBe(false);
    expect(disabledFence.publicationEpoch).toBeGreaterThan(reenabledEpoch);
    const { enqueueEmbedding } = await import("../jobs/corpus-derivatives");
    expect(await enqueueEmbedding(userA, protectedVersionId)).toBeNull();
    const queuedAfterClear = await database.$client.execute({
      sql: `SELECT COUNT(*) AS count FROM jobs WHERE userId = ?
        AND kind = 'corpus.reembedSpace' AND status = 'queued'`,
      args: [userA],
    });
    expect(Number(queuedAfterClear.rows[0]?.count)).toBe(0);

    const explicitRebuild = await apiA.retrieval.reindex({
      projectId: String(scopedProject.id),
    });
    const explicitRebuildRow = await database.$client.execute({
      sql: `SELECT payload FROM jobs WHERE id = ? AND userId = ? LIMIT 1`,
      args: [explicitRebuild.jobId, userA],
    });
    const explicitRebuildPayload = JSON.parse(
      String(explicitRebuildRow.rows[0]?.payload),
    ) as Record<string, unknown>;
    const explicitRebuildEpoch = Number(
      explicitRebuildPayload.publicationEpoch,
    );
    expect(explicitRebuildEpoch).toBeGreaterThan(
      disabledFence.publicationEpoch,
    );
    expect(await readEmbeddingPublicationFence(userA)).toEqual({
      enabled: true,
      publicationEpoch: explicitRebuildEpoch,
    });
  });
});
