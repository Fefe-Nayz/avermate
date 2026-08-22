import { z } from "zod";
import { db } from "../db";
import {
  CORPUS_EVALUATE_JOB_KIND,
  CORPUS_REEMBED_SPACE_JOB_KIND,
  CORPUS_REPAIR_JOB_KIND,
} from "../jobs/corpus";
import { enqueueJob } from "../lib/jobs";
import { conflict, notFound, protectedProcedure } from "../lib/orpc";
import { listProviderServiceKeyMetadata } from "../lib/service-keys";
import { GEMINI_EMBEDDING_DISCLOSURE_REVISION } from "../search/gemini-embedding";
import { COHERE_RERANK_DISCLOSURE_REVISION } from "../search/rerank-providers";
import {
  grantRetrievalProviderConsent,
  revokeRetrievalProviderConsent,
} from "../search/retrieval-consent";
import { corpusRerankConfiguration } from "../search/retrieval-runtime";
import { corpusEmbeddingConfiguration } from "../search/vector-runtime";
import { createOwnedCorpusVectorRuntime } from "../search/vector-runtime";
import { tombstoneOwnedContentDerivatives } from "../search/derivatives";
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
      "Le texte et les pages ou segments sélectionnés sont envoyés à Google Gemini pour créer des représentations de recherche. Aucun secret ni URL signée n’est transmis.",
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
    const [keyRows, consentRows, spaces, generations, jobs, evaluations] =
      await Promise.all([
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
          sql: `SELECT id, spaceId, state, expectedVersionCount,
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
        credentialReady: keys.some(
          (entry) => entry.provider === "gemini" && entry.status === "active",
        ),
        consentReady: activeGeminiConsent,
        spaces: spaces.rows.map((row) => ({
          id: String(row.id),
          descriptor: jsonValue(row.descriptorJson),
          createdAt: iso(row.createdAt),
        })),
        generations: generations.rows.map((row) => ({
          id: String(row.id),
          spaceId: String(row.spaceId),
          state: String(row.state),
          expectedVersionCount: Number(row.expectedVersionCount),
          indexedVersionCount: Number(row.indexedVersionCount),
          activatedAt: iso(row.activatedAt),
          errorCode: row.errorCode === null ? null : String(row.errorCode),
          updatedAt: iso(row.updatedAt),
        })),
      },
      rerank: {
        ...rerankConfiguration,
        configuredSpaceId: configuredRerankSpaceId(),
        credentialReady: keys.some(
          (entry) => entry.provider === "cohere" && entry.status === "active",
        ),
        consentRequired: rerankConfiguration.provider === "cohere",
        consentReady:
          rerankConfiguration.placement === "node" || activeCohereConsent,
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
    .input(
      z.strictObject({
        projectId: z.string().min(1),
        revision: z.number().int().positive(),
        retrievalMode: z.enum(["lexical-only", "advanced-auto"]),
        fallbackPolicy: z.enum([
          "fail",
          "lexical-only",
          "hybrid-without-rerank",
        ]),
        embeddingSpaceId: z.string().min(1).nullable(),
        rerankSpaceId: z.string().min(1).nullable(),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      await ownedProject(userId, input.projectId);
      if (input.retrievalMode === "advanced-auto") {
        if (!input.embeddingSpaceId || !input.rerankSpaceId) {
          throw new Error("ADVANCED_RETRIEVAL_REQUIRES_EXACT_SPACES");
        }
        const space = await db.$client.execute({
          sql: `SELECT 1 FROM corpus_embedding_spaces WHERE id = ? LIMIT 1`,
          args: [input.embeddingSpaceId],
        });
        if (space.rows.length !== 1) {
          throw new Error("EMBEDDING_SPACE_NOT_FOUND");
        }
        if (input.rerankSpaceId !== configuredRerankSpaceId()) {
          throw new Error("RERANK_SPACE_NOT_CONFIGURED");
        }
      }
      const updated = await db.$client.execute({
        sql: `UPDATE study_projects SET retrievalMode = ?,
            retrievalFallbackPolicy = ?, embeddingSpaceId = ?, rerankSpaceId = ?,
            revision = revision + 1, updatedAt = ?
          WHERE id = ? AND userId = ? AND revision = ? AND deletedAt IS NULL`,
        args: [
          input.retrievalMode,
          input.fallbackPolicy,
          input.retrievalMode === "advanced-auto"
            ? input.embeddingSpaceId
            : null,
          input.retrievalMode === "advanced-auto" ? input.rerankSpaceId : null,
          Math.floor(Date.now() / 1_000),
          input.projectId,
          userId,
          input.revision,
        ],
      });
      if (Number(updated.rowsAffected) !== 1) {
        conflict("This study project changed elsewhere — reload it");
      }
      return { ok: true as const, revision: input.revision + 1 };
    }),

  reindex: protectedProcedure
    .input(z.strictObject({ projectId: z.string().min(1).optional() }))
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (input.projectId) await ownedProject(userId, input.projectId);
      const job = await enqueueJob({
        kind: CORPUS_REEMBED_SPACE_JOB_KIND,
        payload: { ownerId: userId, projectId: input.projectId },
        userId,
        idempotencyKey: `retrieval-reindex:${input.projectId ?? "all"}`,
        newAttemptAfterTerminal: true,
        maxAttempts: 3,
      });
      return { jobId: job.id, status: job.status };
    }),

  clearIndex: protectedProcedure
    .input(
      z.strictObject({
        projectId: z.string().min(1).optional(),
        confirmation: z.literal("delete-rebuildable-index"),
      }),
    )
    .handler(async ({ context, input }) => {
      const userId = context.session.user.id;
      if (input.projectId) await ownedProject(userId, input.projectId);
      const versions = await db.$client.execute({
        sql: input.projectId
          ? `SELECT DISTINCT coalesce(items.sourceVersionId, sources.currentVersionId) AS id
              FROM study_project_items AS items
              JOIN study_projects AS projects ON projects.id = items.projectId
              JOIN content_sources AS sources
                ON sources.userId = projects.userId
                AND sources.originKind = items.kind
                AND sources.originId = items.referenceId
              WHERE projects.id = ? AND projects.userId = ?
                AND projects.deletedAt IS NULL`
          : `SELECT DISTINCT versions.id
              FROM content_versions AS versions
              JOIN content_sources AS sources ON sources.id = versions.sourceId
              WHERE sources.userId = ? AND (
                sources.currentVersionId = versions.id OR EXISTS (
                  SELECT 1 FROM study_project_items AS items
                  JOIN study_projects AS projects ON projects.id = items.projectId
                  WHERE projects.userId = sources.userId
                    AND projects.deletedAt IS NULL
                    AND items.sourceVersionId = versions.id
                )
              )`,
        args: input.projectId ? [input.projectId, userId] : [userId],
      });
      const versionIds = versions.rows.flatMap((row) =>
        row.id === null ? [] : [String(row.id)],
      );
      const runtime = await createOwnedCorpusVectorRuntime(userId);
      if (runtime) await runtime.vector.remove(versionIds);
      const derivatives = await tombstoneOwnedContentDerivatives({
        ownerId: userId,
        versionIds,
      });
      await db.$client.execute({
        sql: `UPDATE corpus_embedding_generations
          SET state = 'superseded', updatedAt = ?
          WHERE userId = ? AND state = 'active'`,
        args: [Math.floor(Date.now() / 1_000), userId],
      });
      return {
        versions: versionIds.length,
        derivatives: derivatives.tombstoned,
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
