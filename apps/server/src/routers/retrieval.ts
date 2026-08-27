import { z } from "zod";
import { db } from "../db";
import {
  CORPUS_EVALUATE_JOB_KIND,
  CORPUS_REEMBED_SPACE_JOB_KIND,
  CORPUS_REPAIR_JOB_KIND,
} from "../jobs/corpus";
import { enqueueJob } from "../lib/jobs";
import { badRequest, notFound, protectedProcedure } from "../lib/orpc";
import { listProviderServiceKeyMetadata } from "../lib/service-keys";
import { GEMINI_EMBEDDING_DISCLOSURE_REVISION } from "../search/gemini-embedding";
import { COHERE_RERANK_DISCLOSURE_REVISION } from "../search/rerank-providers";
import {
  cancelOwnedEmbeddingJobs,
  ensureEmbeddingPublicationFence,
  readEmbeddingPublicationFence,
  rotateEmbeddingPublicationFence,
} from "../search/embedding-publication-fence";
import {
  grantRetrievalProviderConsent,
  revokeRetrievalProviderConsent,
} from "../search/retrieval-consent";
import {
  corpusRerankConfiguration,
  publicCorpusRerankConfiguration,
} from "../search/retrieval-runtime";
import {
  corpusEmbeddingConfiguration,
  createOwnedCorpusVectorRuntime,
} from "../search/vector-runtime";
import {
  setOwnedProjectRetrievalPolicy,
  setProjectRetrievalPolicyInputSchema,
} from "../search/project-retrieval-policy";
import { jsonValue } from "../search/values";
import {
  FRENCH_SCHOOL_FIXTURE_REVISION,
  retrievalEvaluationConfigurationSchema,
} from "../search/eval/evaluation";

const consentTarget = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("gemini"),
    capability: z.literal("embedding"),
  }),
  z.strictObject({
    provider: z.literal("cohere"),
    capability: z.literal("rerank"),
  }),
]);

const DISCLOSURES = [
  {
    provider: "gemini" as const,
    capability: "embedding" as const,
    revision: GEMINI_EMBEDDING_DISCLOSURE_REVISION,
    summary:
      "Les contenus sources sélectionnés — texte, images et pages PDF, segments audio ou vidéo — sont envoyés à Google Gemini pour créer des embeddings. Les requêtes de recherche sont également envoyées ; une question de suivi peut inclure au plus deux messages utilisateur récents et trois titres de projet. Aucun secret ni URL signée n’est transmis.",
  },
  {
    provider: "cohere" as const,
    capability: "rerank" as const,
    revision: COHERE_RERANK_DISCLOSURE_REVISION,
    summary:
      "La requête et un extrait borné des candidats déjà autorisés sont envoyés à Cohere pour les classer. Le corpus complet, les secrets et les URL signées ne sont pas transmis.",
  },
] as const;

function iso(value: unknown) {
  if (value === null || value === undefined) return null;
  return new Date(Number(value) * 1_000).toISOString();
}

async function ownedProject(userId: string, projectId: string) {
  const result = await db.$client.execute({
    sql: `SELECT * FROM study_projects
      WHERE id = ? AND userId = ? AND deletedAt IS NULL LIMIT 1`,
    args: [projectId, userId],
  });
  if (!result.rows[0]) notFound("Study project");
  return result.rows[0]!;
}

function configuredRerankSpaceId() {
  return corpusRerankConfiguration().descriptorId;
}

export const retrievalRouter = {
  readiness: protectedProcedure.handler(async ({ context }) => {
    const userId = context.session.user.id;
    const [
      keyRows,
      consentRows,
      spaces,
      generations,
      jobs,
      evaluations,
      publicationFence,
    ] = await Promise.all([
      listProviderServiceKeyMetadata(userId),
      db.$client.execute({
        sql: `SELECT provider, capability, disclosureRevision, policyRevision,
              grantedAt, revokedAt
            FROM retrieval_provider_consents WHERE userId = ?`,
        args: [userId],
      }),
      db.$client.execute(
        `SELECT id, descriptorJson, createdAt FROM corpus_embedding_spaces ORDER BY createdAt DESC`,
      ),
      db.$client.execute({
        sql: `SELECT id, spaceId, state, publicationEpoch,
              expectedVersionCount,
              indexedVersionCount, activatedAt, errorCode, updatedAt
            FROM corpus_embedding_generations
            WHERE userId = ? ORDER BY updatedAt DESC`,
        args: [userId],
      }),
      db.$client.execute({
        sql: `SELECT id, kind, status, error, createdAt, updatedAt
            FROM jobs WHERE userId = ? AND kind IN (?, ?, ?, ?)
            ORDER BY createdAt DESC LIMIT 20`,
        args: [
          userId,
          CORPUS_REEMBED_SPACE_JOB_KIND,
          CORPUS_REPAIR_JOB_KIND,
          "corpus.embedChunks",
          CORPUS_EVALUATE_JOB_KIND,
        ],
      }),
      db.$client.execute({
        sql: `SELECT id, fixtureRevision, status, metricsJson, errorCode,
              evaluatedAt, createdAt
            FROM retrieval_evaluations WHERE userId = ?
            ORDER BY createdAt DESC LIMIT 5`,
        args: [userId],
      }),
      readEmbeddingPublicationFence(userId),
    ]);
    const consents = consentRows.rows.map((row) => ({
      provider: String(row.provider),
      capability: String(row.capability),
      disclosureRevision: String(row.disclosureRevision),
      policyRevision: String(row.policyRevision),
      grantedAt: iso(row.grantedAt),
      revokedAt: iso(row.revokedAt),
      active: row.revokedAt === null,
    }));
    const keys = keyRows
      .filter((row) => row.provider === "gemini" || row.provider === "cohere")
      .map((row) => ({
        provider: row.provider,
        kind: row.kind,
        hint: row.hint,
        status: row.status,
        lastValidatedAt: row.lastValidatedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(),
      }));
    const embeddingConfiguration = corpusEmbeddingConfiguration();
    const rerankConfiguration = corpusRerankConfiguration();
    const publicRerankConfiguration = publicCorpusRerankConfiguration();
    const embeddingCredentialRequired =
      embeddingConfiguration.provider === "gemini";
    const rerankCredentialRequired = rerankConfiguration.provider === "cohere";
    const activeGeminiConsent = consents.some(
      (entry) =>
        entry.provider === "gemini" &&
        entry.capability === "embedding" &&
        entry.disclosureRevision === GEMINI_EMBEDDING_DISCLOSURE_REVISION &&
        entry.active,
    );
    const activeCohereConsent = consents.some(
      (entry) =>
        entry.provider === "cohere" &&
        entry.capability === "rerank" &&
        entry.disclosureRevision === COHERE_RERANK_DISCLOSURE_REVISION &&
        entry.active,
    );
    return {
      disclosures: DISCLOSURES,
      keys,
      consents,
      embedding: {
        ...embeddingConfiguration,
        publicationFence,
        credentialReady:
          !embeddingCredentialRequired ||
          keys.some(
            (entry) => entry.provider === "gemini" && entry.status === "active",
          ),
        consentRequired: embeddingCredentialRequired,
        consentReady: !embeddingCredentialRequired || activeGeminiConsent,
        spaces: spaces.rows.map((row) => ({
          id: String(row.id),
          descriptor: jsonValue(row.descriptorJson),
          createdAt: iso(row.createdAt),
        })),
        generations: generations.rows.map((row) => {
          const state = String(row.state);
          const publicationEpoch = Number(row.publicationEpoch);
          const isCurrentPublicationEpoch =
            publicationEpoch === publicationFence.publicationEpoch;
          const publicationAuthorized =
            publicationFence.enabled && isCurrentPublicationEpoch;
          const effectiveState =
            state === "active" || state === "staging"
              ? !isCurrentPublicationEpoch
                ? "superseded"
                : publicationFence.enabled
                  ? state
                  : "disabled"
              : state;
          return {
            id: String(row.id),
            spaceId: String(row.spaceId),
            // Keep the persisted state for diagnostics, but never use it as
            // evidence that a generation survived an owner-fence rotation.
            state,
            effectiveState,
            publicationEpoch,
            isCurrentPublicationEpoch,
            publicationAuthorized,
            expectedVersionCount: Number(row.expectedVersionCount),
            indexedVersionCount: Number(row.indexedVersionCount),
            activatedAt: iso(row.activatedAt),
            errorCode: row.errorCode === null ? null : String(row.errorCode),
            updatedAt: iso(row.updatedAt),
          };
        }),
      },
      rerank: {
        ...publicRerankConfiguration,
        configuredSpaceId: configuredRerankSpaceId(),
        credentialReady:
          !rerankCredentialRequired ||
          keys.some(
            (entry) => entry.provider === "cohere" && entry.status === "active",
          ),
        consentRequired: rerankCredentialRequired,
        consentReady: !rerankCredentialRequired || activeCohereConsent,
        pairedNodeTransportRequired: rerankConfiguration.placement === "node",
      },
      jobs: jobs.rows.map((row) => ({
        id: String(row.id),
        kind: String(row.kind),
        status: String(row.status),
        error: row.error === null ? null : String(row.error),
        createdAt: iso(row.createdAt),
        updatedAt: iso(row.updatedAt),
      })),
      latestEvaluations: evaluations.rows.map((row) => ({
        id: String(row.id),
        fixtureRevision: String(row.fixtureRevision),
        status: String(row.status),
        metrics: row.metricsJson === null ? null : jsonValue(row.metricsJson),
        errorCode: row.errorCode === null ? null : String(row.errorCode),
        evaluatedAt: iso(row.evaluatedAt),
        createdAt: iso(row.createdAt),
      })),
      evaluationRunner: {
        available: true,
        evidenceClass: "deterministic-pre-ranked-regression-fixture" as const,
        provesLiveProviderQuality: false,
        fixtureRevisions: [FRENCH_SCHOOL_FIXTURE_REVISION],
        configurations: retrievalEvaluationConfigurationSchema.options,
        liveProviderGateRequiresCredentials: true,
      },
    };
  }),

  grantConsent: protectedProcedure
    .input(
      z.intersection(
        consentTarget,
        z.strictObject({
          disclosureRevision: z.string().min(1).max(256),
          policyRevision: z.string().min(1).max(256).default("user-direct/1"),
          confirmed: z.literal(true),
        }),
      ),
    )
    .handler(({ context, input }) =>
      grantRetrievalProviderConsent({
        userId: context.session.user.id,
        provider: input.provider,
        capability: input.capability,
        disclosureRevision: input.disclosureRevision,
        policyRevision: input.policyRevision,
      }),
    ),

  revokeConsent: protectedProcedure
    .input(consentTarget)
    .handler(({ context, input }) =>
      revokeRetrievalProviderConsent({
        userId: context.session.user.id,
        provider: input.provider,
        capability: input.capability,
      }),
    ),

  updateProject: protectedProcedure
    .input(setProjectRetrievalPolicyInputSchema)
    .handler(({ context, input }) =>
      setOwnedProjectRetrievalPolicy(context.session.user.id, input),
    ),

  reindex: protectedProcedure
    .input(z.strictObject({ projectId: z.string().min(1).optional() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (input.projectId) {
        const project = await ownedProject(userId, input.projectId);
        if (project.retrievalMode !== "advanced-auto") {
          badRequest("Advanced retrieval is not enabled for this project");
        }
      }
      if (!input.projectId) {
        const advanced = await db.$client.execute({
          sql: `SELECT 1 FROM study_projects WHERE userId = ?
            AND deletedAt IS NULL AND retrievalMode = 'advanced-auto' LIMIT 1`,
          args: [userId],
        });
        if (advanced.rows.length === 0) {
          badRequest(
            "Enable advanced retrieval on at least one project before rebuilding vectors",
          );
        }
      }
      const fence = await ensureEmbeddingPublicationFence(userId, true);
      const job = await enqueueJob({
        kind: CORPUS_REEMBED_SPACE_JOB_KIND,
        payload: input.projectId
          ? {
              ownerId: userId,
              scope: "advanced-projects",
              requestedProjectId: input.projectId,
              publicationEpoch: fence.publicationEpoch,
            }
          : {
              ownerId: userId,
              scope: "all",
              publicationEpoch: fence.publicationEpoch,
            },
        userId,
        idempotencyKey: `retrieval-reindex:${input.projectId ?? "all"}:epoch:${fence.publicationEpoch}`,
        newAttemptAfterTerminal: true,
        maxAttempts: 3,
      });
      const currentFence = await readEmbeddingPublicationFence(userId);
      if (
        !currentFence.enabled ||
        currentFence.publicationEpoch !== fence.publicationEpoch
      ) {
        await db.$client.batch(
          [
            {
              sql: `UPDATE jobs SET status = 'cancelled', lockedBy = NULL,
                  lockedUntil = NULL, updatedAt = ?
                WHERE id = ? AND userId = ? AND status = 'queued'`,
              args: [Math.floor(Date.now() / 1_000), job.id, userId],
            },
            {
              sql: `INSERT INTO job_runtime_metadata
                  (jobId, stage, cancellation, createdAt, updatedAt)
                SELECT id, 'running', 'requested', ?, ? FROM jobs
                WHERE id = ? AND userId = ? AND status = 'running'
                ON CONFLICT(jobId) DO UPDATE SET
                  cancellation = 'requested', updatedAt = excluded.updatedAt`,
              args: [
                Math.floor(Date.now() / 1_000),
                Math.floor(Date.now() / 1_000),
                job.id,
                userId,
              ],
            },
          ],
          "write",
        );
        return { jobId: job.id, status: "cancelled" as const };
      }
      return { jobId: job.id, status: job.status };
    }),

  clearIndex: protectedProcedure
    .input(
      z.strictObject({
        confirmation: z.literal("disable-all-vector-generations"),
      }),
    )
    .handler(async ({ context }) => {
      const userId = context.session.user.id;
      const transaction = await db.$client.transaction("write");
      let generationRows: Array<{
        generationId: string;
        spaceId: string;
        versionId: string | null;
        state: string;
      }> = [];
      let queuedJobsCancelled = 0;
      let runningJobsCancellationRequested = 0;
      let disabledPublicationEpoch = 0;
      try {
        const disabledFence = await rotateEmbeddingPublicationFence(
          userId,
          false,
          transaction,
        );
        disabledPublicationEpoch = disabledFence.publicationEpoch;
        const cancelled = await cancelOwnedEmbeddingJobs(userId, transaction);
        queuedJobsCancelled = cancelled.queuedJobsCancelled;
        runningJobsCancellationRequested =
          cancelled.runningJobsCancellationRequested;
        const ownedGenerations = await transaction.execute({
          sql: `SELECT generations.id AS generationId,
              generations.spaceId AS spaceId,
              generations.state AS state, members.versionId AS versionId
            FROM corpus_embedding_generations AS generations
            LEFT JOIN corpus_embedding_generation_versions AS members
              ON members.generationId = generations.id
            WHERE generations.userId = ?
            ORDER BY generations.spaceId, generations.id, members.versionId`,
          args: [userId],
        });
        generationRows = ownedGenerations.rows.map((row) => ({
          generationId: String(row.generationId),
          spaceId: String(row.spaceId),
          versionId: row.versionId === null ? null : String(row.versionId),
          state: String(row.state),
        }));
        await transaction.execute({
          sql: `UPDATE corpus_embedding_generations
            SET state = 'superseded', updatedAt = ?
            WHERE userId = ? AND state IN ('active', 'staging')`,
          args: [Math.floor(Date.now() / 1_000), userId],
        });
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }

      const generations = [
        ...new Map(
          generationRows.map((row) => [row.generationId, row.spaceId]),
        ).entries(),
      ].map(([generationId, spaceId]) => ({ generationId, spaceId }));
      const generationsDisabled = new Set(
        generationRows
          .filter((row) => row.state === "active" || row.state === "staging")
          .map((row) => row.generationId),
      ).size;
      const versionIds = [
        ...new Set(
          generationRows.flatMap((row) =>
            row.versionId === null ? [] : [row.versionId],
          ),
        ),
      ];
      let vectorGenerationsCleaned = 0;
      let vectorCleanup: "not-needed" | "completed" | "deferred" =
        generations.length === 0 ? "not-needed" : "deferred";
      try {
        const runtime = await createOwnedCorpusVectorRuntime(userId);
        if (runtime) {
          const spaceId = runtime.embedding.descriptor().id;
          const matching = generations.filter(
            (generation) => generation.spaceId === spaceId,
          );
          for (const generation of matching) {
            const generationVersionIds = generationRows.flatMap((row) =>
              row.generationId === generation.generationId &&
              row.versionId !== null
                ? [row.versionId]
                : [],
            );
            await runtime.vector
              .forGeneration(userId, generation.generationId)
              .remove(generationVersionIds);
            vectorGenerationsCleaned += 1;
          }
          if (
            vectorGenerationsCleaned === generations.length &&
            runningJobsCancellationRequested === 0
          ) {
            vectorCleanup = "completed";
          }
        }
      } catch {
        // Publication state is the authorization boundary. If the configured
        // vector service is unavailable, the now-superseded generations remain
        // unqueryable even though provider-side physical cleanup was deferred.
        vectorCleanup = "deferred";
      }
      const finalFence = await readEmbeddingPublicationFence(userId);
      const publicationState = finalFence.enabled
        ? ("superseded-by-reenable" as const)
        : finalFence.publicationEpoch === disabledPublicationEpoch
          ? ("disabled" as const)
          : ("superseded-by-newer-disable" as const);
      return {
        versions: versionIds.length,
        generationsDisabled,
        queuedJobsCancelled,
        runningJobsCancellationRequested,
        vectorGenerationsCleaned,
        vectorCleanup,
        disabledPublicationEpoch,
        publicationState,
        currentPublicationEnabled: finalFence.enabled,
        currentPublicationEpoch: finalFence.publicationEpoch,
        contentDerivativesDeleted: 0 as const,
        sourceFilesDeleted: 0 as const,
      };
    }),

  evaluate: protectedProcedure
    .input(
      z.strictObject({
        fixtureRevision: z
          .literal(FRENCH_SCHOOL_FIXTURE_REVISION)
          .default(FRENCH_SCHOOL_FIXTURE_REVISION),
        configurations: z
          .array(retrievalEvaluationConfigurationSchema)
          .min(1)
          .max(retrievalEvaluationConfigurationSchema.options.length)
          .default([...retrievalEvaluationConfigurationSchema.options]),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      const configurations = [...new Set(input.configurations)].sort();
      const job = await enqueueJob({
        kind: CORPUS_EVALUATE_JOB_KIND,
        payload: {
          ownerId: userId,
          fixtureRevision: input.fixtureRevision,
          configurations,
        },
        userId,
        idempotencyKey: `retrieval-eval:${input.fixtureRevision}:${configurations.join(",")}`,
        newAttemptAfterTerminal: true,
        maxAttempts: 1,
      });
      return { jobId: job.id, status: job.status };
    }),

  traces: protectedProcedure
    .input(
      z.strictObject({ limit: z.number().int().min(1).max(100).default(25) }),
    )
    .handler(async ({ context, input }) => {
      const rows = await db.$client.execute({
        sql: `SELECT id, operationId, queryDigest, corpusGenerationId,
            scopeDigest, stagesJson, fallbackPolicy, fallbackReason,
            packedEvidenceIdsJson, evaluationCorrelationId, createdAt
          FROM retrieval_traces WHERE userId = ?
          ORDER BY createdAt DESC LIMIT ?`,
        args: [context.session.user.id, input.limit],
      });
      return rows.rows.map((row) => ({
        id: String(row.id),
        operationId: String(row.operationId),
        queryDigest: String(row.queryDigest),
        corpusGenerationId:
          row.corpusGenerationId === null
            ? null
            : String(row.corpusGenerationId),
        scopeDigest: String(row.scopeDigest),
        stages: jsonValue(row.stagesJson),
        fallbackPolicy: String(row.fallbackPolicy),
        fallbackReason:
          row.fallbackReason === null ? null : String(row.fallbackReason),
        packedEvidenceIds: jsonValue(row.packedEvidenceIdsJson),
        evaluationCorrelationId:
          row.evaluationCorrelationId === null
            ? null
            : String(row.evaluationCorrelationId),
        createdAt: iso(row.createdAt),
      }));
    }),

  evaluations: protectedProcedure
    .input(
      z.strictObject({ limit: z.number().int().min(1).max(50).default(10) }),
    )
    .handler(async ({ context, input }) => {
      const rows = await db.$client.execute({
        sql: `SELECT id, fixtureRevision, corpusDigest, configurationDigest,
            status, metricsJson, ablationsJson, errorCode, evaluatedAt, createdAt
          FROM retrieval_evaluations WHERE userId = ?
          ORDER BY createdAt DESC LIMIT ?`,
        args: [context.session.user.id, input.limit],
      });
      return rows.rows.map((row) => ({
        id: String(row.id),
        fixtureRevision: String(row.fixtureRevision),
        corpusDigest: String(row.corpusDigest),
        configurationDigest: String(row.configurationDigest),
        status: String(row.status),
        metrics: row.metricsJson === null ? null : jsonValue(row.metricsJson),
        ablations:
          row.ablationsJson === null ? null : jsonValue(row.ablationsJson),
        errorCode: row.errorCode === null ? null : String(row.errorCode),
        evaluatedAt: iso(row.evaluatedAt),
        createdAt: iso(row.createdAt),
      }));
    }),
};
