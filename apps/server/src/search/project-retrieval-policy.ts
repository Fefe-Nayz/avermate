import type { InValue } from "@libsql/client";
import { retrievalFallbackPolicySchema } from "@avermate/agent-contracts";
import { z } from "zod";
import { db } from "../db";
import { badRequest, conflict, notFound } from "../lib/orpc";
import { listProviderServiceKeyMetadata } from "../lib/service-keys";
import { COHERE_RERANK_DISCLOSURE_REVISION } from "./rerank-providers";
import {
  corpusRerankConfiguration,
  createOwnedConfiguredRerankProvider,
} from "./retrieval-runtime";
import { SqliteFts5LexicalSearchBackend } from "./lexical";
import { ensureEmbeddingPublicationFence } from "./embedding-publication-fence";
import { GEMINI_EMBEDDING_DISCLOSURE_REVISION } from "./gemini-embedding";
import {
  deriveProjectRetrievalPolicyState,
  type ProjectRetrievalPolicyConfiguration,
  type ProjectRetrievalPolicyEnvironment,
} from "./project-retrieval-policy-state";
import {
  corpusEmbeddingConfiguration,
  createOwnedCorpusVectorRuntime,
  loadRetrievalProviderConsent,
} from "./vector-runtime";

export const setProjectRetrievalPolicyInputSchema = z.strictObject({
  projectId: z.string().min(1),
  revision: z.number().int().positive(),
  retrievalMode: z.enum(["lexical-only", "advanced-auto"]),
  fallbackPolicy: retrievalFallbackPolicySchema,
  embeddingSpaceId: z.string().min(1).nullable(),
  rerankSpaceId: z.string().min(1).nullable(),
});

type ProjectRow = Record<string, unknown>;

async function ownedProject(userId: string, projectId: string) {
  const result = await db.$client.execute({
    sql: `SELECT id, revision, retrievalMode, retrievalFallbackPolicy,
        embeddingSpaceId, rerankSpaceId
      FROM study_projects
      WHERE id = ? AND userId = ? AND deletedAt IS NULL LIMIT 1`,
    args: [projectId, userId],
  });
  const row = result.rows[0];
  if (!row) notFound("Study project");
  return row as ProjectRow;
}

function configuration(row: ProjectRow): ProjectRetrievalPolicyConfiguration {
  return {
    projectId: String(row.id),
    revision: Number(row.revision),
    retrievalMode:
      row.retrievalMode === "advanced-auto" ? "advanced-auto" : "lexical-only",
    fallbackPolicy: retrievalFallbackPolicySchema
      .catch("lexical-only")
      .parse(row.retrievalFallbackPolicy),
    embeddingSpaceId:
      row.embeddingSpaceId === null ? null : String(row.embeddingSpaceId),
    rerankSpaceId:
      row.rerankSpaceId === null ? null : String(row.rerankSpaceId),
  };
}

function activeProviderKey(
  rows: Awaited<ReturnType<typeof listProviderServiceKeyMetadata>>,
  provider: string,
) {
  return rows.some(
    (row) =>
      row.kind === "inference" &&
      row.provider === provider &&
      row.status === "active" &&
      row.revokedAt === null,
  );
}

async function projectGenerationCoverage(
  userId: string,
  projectId: string,
  spaceId: string | null,
) {
  const generation = spaceId
    ? await db.$client.execute({
        sql: `SELECT id FROM corpus_embedding_generations
          WHERE userId = ? AND spaceId = ? AND state = 'active' LIMIT 1`,
        args: [userId, spaceId],
      })
    : null;
  const generationId = generation?.rows[0]?.id
    ? String(generation.rows[0].id)
    : null;
  const coverage = await db.$client.execute({
    sql: `WITH selected AS (
        SELECT DISTINCT CASE
          WHEN items.trackingMode = 'pinned' THEN items.sourceVersionId
          ELSE sources.currentVersionId
        END AS versionId, sources.placement
        FROM study_project_items AS items
        JOIN study_projects AS projects ON projects.id = items.projectId
        LEFT JOIN content_sources AS sources
          ON sources.userId = projects.userId
          AND sources.originKind = items.kind
          AND sources.originId = items.referenceId
        WHERE projects.id = ? AND projects.userId = ?
          AND projects.deletedAt IS NULL
          AND items.contextMode != 'exclude'
          AND items.selectorReviewRequired = 0
      )
      SELECT count(CASE WHEN selected.placement = 'core' THEN 1 END)
          AS eligibleVersionCount,
        count(CASE WHEN selected.placement = 'core'
          AND generationVersions.indexedAt IS NOT NULL THEN 1 END)
          AS indexedVersionCount,
        count(CASE WHEN selected.placement != 'core' THEN 1 END)
          AS unsupportedVersionCount
      FROM selected
      LEFT JOIN corpus_embedding_generation_versions AS generationVersions
        ON generationVersions.generationId = ?
        AND generationVersions.versionId = selected.versionId
      WHERE selected.versionId IS NOT NULL`,
    args: [projectId, userId, generationId],
  });
  return {
    id: generationId,
    state: generationId ? ("active" as const) : null,
    eligibleVersionCount: Number(coverage.rows[0]?.eligibleVersionCount ?? 0),
    indexedVersionCount: Number(coverage.rows[0]?.indexedVersionCount ?? 0),
    unsupportedVersionCount: Number(
      coverage.rows[0]?.unsupportedVersionCount ?? 0,
    ),
  };
}

async function inspectEnvironment(
  userId: string,
  projectId: string,
): Promise<ProjectRetrievalPolicyEnvironment> {
  const embeddingConfiguration = corpusEmbeddingConfiguration();
  const rerankConfiguration = corpusRerankConfiguration();
  const embeddingConsentRequired = embeddingConfiguration.provider === "gemini";
  const rerankConsentRequired = rerankConfiguration.provider === "cohere";
  const [keys, embeddingConsent, rerankConsent, lexicalCapabilities] =
    await Promise.all([
      listProviderServiceKeyMetadata(userId),
      embeddingConsentRequired
        ? loadRetrievalProviderConsent(
            userId,
            "gemini",
            "embedding",
            GEMINI_EMBEDDING_DISCLOSURE_REVISION,
          )
        : Promise.resolve(null),
      rerankConsentRequired
        ? loadRetrievalProviderConsent(
            userId,
            "cohere",
            "rerank",
            COHERE_RERANK_DISCLOSURE_REVISION,
          )
        : Promise.resolve(null),
      new SqliteFts5LexicalSearchBackend().capabilities().catch(() => ({
        available: false,
        implementation: "sqlite-fts5-unavailable",
        modes: [] as never[],
      })),
    ]);

  let embeddingRuntime: Awaited<
    ReturnType<typeof createOwnedCorpusVectorRuntime>
  > = null;
  try {
    embeddingRuntime = await createOwnedCorpusVectorRuntime(userId);
  } catch {
    // Readiness is fail-closed and never exposes provider or network errors.
  }
  const embeddingDescriptor = embeddingRuntime?.embedding.descriptor() ?? null;
  const generation = await projectGenerationCoverage(
    userId,
    projectId,
    embeddingDescriptor?.id ?? null,
  );
  const vectorCapabilities = !embeddingRuntime
    ? {
        available: false,
        implementation: "not-configured",
        dimensions: [] as number[],
      }
    : generation.id
      ? await embeddingRuntime.vector
          .forGeneration(userId, generation.id)
          .capabilities()
          .catch(() => ({
            available: false,
            implementation: "vector-index-unavailable",
            dimensions: [] as number[],
          }))
      : {
          available: false,
          implementation: "vector-generation-unavailable",
          dimensions: [] as number[],
        };
  const registeredSpace = embeddingDescriptor
    ? await db.$client.execute({
        sql: `SELECT 1 FROM corpus_embedding_spaces WHERE id = ? LIMIT 1`,
        args: [embeddingDescriptor.id],
      })
    : null;

  let rerankProvider: Awaited<
    ReturnType<typeof createOwnedConfiguredRerankProvider>
  > = null;
  try {
    rerankProvider = await createOwnedConfiguredRerankProvider(userId);
  } catch {
    // Paired nodes and BYOK providers are optional; absence degrades honestly.
  }
  const rerankDescriptor = rerankProvider?.descriptor() ?? null;

  return {
    lexical: {
      available: lexicalCapabilities.available,
      implementation: lexicalCapabilities.implementation,
    },
    embedding: {
      configurationReady: embeddingConfiguration.complete,
      provider: embeddingConfiguration.provider,
      placement: embeddingConfiguration.placement,
      sendsSourceContentToThirdParties:
        embeddingConfiguration.sendsSourceContentToThirdParties,
      credentialReady:
        !embeddingConsentRequired || activeProviderKey(keys, "gemini"),
      consentRequired: embeddingConsentRequired,
      consentReady: !embeddingConsentRequired || embeddingConsent !== null,
      runtimeReady: embeddingRuntime !== null,
      vectorAvailable: vectorCapabilities.available,
      vectorImplementation: vectorCapabilities.implementation,
      compatibleSpace: embeddingDescriptor
        ? {
            ...embeddingDescriptor,
            registered: Boolean(registeredSpace?.rows.length),
          }
        : null,
    },
    rerank: {
      configurationReady: rerankConfiguration.complete,
      provider: rerankConfiguration.provider,
      placement: rerankConfiguration.placement,
      credentialReady:
        !rerankConsentRequired || activeProviderKey(keys, "cohere"),
      consentRequired: rerankConsentRequired,
      consentReady: !rerankConsentRequired || rerankConsent !== null,
      runtimeReady: rerankProvider !== null,
      compatibleSpace: rerankDescriptor,
    },
    generation,
  };
}

export async function readOwnedProjectRetrievalPolicy(
  userId: string,
  projectId: string,
) {
  const row = await ownedProject(userId, projectId);
  const environment = await inspectEnvironment(userId, projectId);
  return deriveProjectRetrievalPolicyState(configuration(row), environment);
}

export async function setOwnedProjectRetrievalPolicy(
  userId: string,
  input: z.infer<typeof setProjectRetrievalPolicyInputSchema>,
  dependencies: {
    inspectEnvironment?: (
      userId: string,
      projectId: string,
    ) => Promise<ProjectRetrievalPolicyEnvironment>;
  } = {},
) {
  const row = await ownedProject(userId, input.projectId);
  if (Number(row.revision) !== input.revision) {
    conflict("This study project changed elsewhere — reload it");
  }
  const environment = await (
    dependencies.inspectEnvironment ?? inspectEnvironment
  )(userId, input.projectId);
  const candidate: ProjectRetrievalPolicyConfiguration = {
    projectId: input.projectId,
    revision: input.revision,
    retrievalMode: input.retrievalMode,
    fallbackPolicy: input.fallbackPolicy,
    embeddingSpaceId:
      input.retrievalMode === "advanced-auto" ? input.embeddingSpaceId : null,
    rerankSpaceId:
      input.retrievalMode === "advanced-auto" ? input.rerankSpaceId : null,
  };
  const candidateState = deriveProjectRetrievalPolicyState(
    candidate,
    environment,
  );
  const blockers = candidateState.reasons.filter(
    (reason) => reason !== "embedding-reindex-required",
  );
  if (input.retrievalMode === "advanced-auto" && blockers.length > 0) {
    badRequest(`Advanced retrieval is not ready (${blockers.join(", ")})`);
  }

  const args: InValue[] = [
    candidate.retrievalMode,
    candidate.fallbackPolicy,
    candidate.embeddingSpaceId,
    candidate.rerankSpaceId,
    Math.floor(Date.now() / 1_000),
    candidate.projectId,
    userId,
    candidate.revision,
  ];
  const transaction = await db.$client.transaction("write");
  try {
    const updated = await transaction.execute({
      sql: `UPDATE study_projects SET retrievalMode = ?,
          retrievalFallbackPolicy = ?, embeddingSpaceId = ?, rerankSpaceId = ?,
          revision = revision + 1, updatedAt = ?
        WHERE id = ? AND userId = ? AND revision = ? AND deletedAt IS NULL`,
      args,
    });
    if (Number(updated.rowsAffected) !== 1) {
      conflict("This study project changed elsewhere — reload it");
    }
    const wasAdvanced = row.retrievalMode === "advanced-auto";
    if (!wasAdvanced && candidate.retrievalMode === "advanced-auto") {
      await ensureEmbeddingPublicationFence(userId, true, transaction);
    } else if (wasAdvanced && candidate.retrievalMode === "lexical-only") {
      const remainingAdvanced = await transaction.execute({
        sql: `SELECT 1 FROM study_projects WHERE userId = ?
          AND deletedAt IS NULL AND retrievalMode = 'advanced-auto' LIMIT 1`,
        args: [userId],
      });
      if (remainingAdvanced.rows.length === 0) {
        await ensureEmbeddingPublicationFence(userId, false, transaction);
      }
    }
    await transaction.commit();
  } catch (error) {
    await transaction.rollback().catch(() => undefined);
    throw error;
  }
  return deriveProjectRetrievalPolicyState(
    { ...candidate, revision: candidate.revision + 1 },
    environment,
  );
}
