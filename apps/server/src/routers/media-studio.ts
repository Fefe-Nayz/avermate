import {
  generatedArtifactKindSchema,
  ingestionStrategySchema,
} from "@avermate/agent-contracts";
import { z } from "zod";
import { db } from "../db";
import { artifactWorkflowStore } from "../ingestion/artifact-workflow-store";
import { coreArtifactGraphStore } from "../ingestion/artifact-graph";
import { AdvancedIngestionError } from "../ingestion/errors";
import { sourceIngestionRevisionStore } from "../ingestion/revision-store";
import { sha256 } from "../search/values";
import { badRequest, protectedProcedure } from "../lib/orpc";

const artifactIdentityInput = z
  .object({
    artifactId: z.string().min(1),
    expectedIdentityRevision: z.number().int().positive(),
  })
  .strict();

const EXTRACTION_NOTICE =
  "Audio extraction is an explicit, user-initiated fallback. Do not use it for DRM, authenticated, private, age-gated, or publisher-denied media.";
export const VIDEO_EXTRACTION_CONSENT_REVISION = "video-audio-extraction.v1";
export const VIDEO_EXTRACTION_NOTICE_DIGEST = sha256(EXTRACTION_NOTICE);

export const mediaStudioRouter = {
  capabilities: protectedProcedure.handler(async () => ({
    staticHtml: { available: true as const, placement: "core" as const },
    platformCaptions: { available: true as const, placement: "core" as const },
    dynamicWebRendering: {
      available: false as const,
      reasonCode: "placement_unavailable" as const,
      message: "No attested browser sandbox placement is configured for this request",
    },
    videoAudioExtraction: {
      available: false as const,
      reasonCode: "placement_unavailable" as const,
      message: "No attested node media sandbox placement is configured for this request",
    },
    mediaTimelineRendering: {
      available: false as const,
      reasonCode: "placement_unavailable" as const,
      message: "No attested FFmpeg sandbox placement is configured for this request",
    },
    manimRendering: {
      available: false as const,
      reasonCode: "capability_disabled" as const,
      message: "Reviewed Manim DSL translation is not enabled on a conforming placement",
    },
  })),

  ingestionRevisions: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }).strict())
    .handler(({ context, input }) =>
      sourceIngestionRevisionStore.list(
        context.session.user.id,
        input.documentId,
      ),
    ),

  retryDynamic: protectedProcedure
    .input(z.object({ documentId: z.string().min(1) }).strict())
    .handler(async ({ context, input }) => {
      const ownerId = context.session.user.id;
      const source = await db.$client.execute({
        sql: `SELECT sourceUrl FROM material_documents WHERE id = ? AND userId = ? AND sourceType = 'link' LIMIT 1`,
        args: [input.documentId, ownerId],
      });
      const canonicalUrl = source.rows[0]?.sourceUrl;
      if (typeof canonicalUrl !== "string") badRequest("The link material is unavailable");
      const revision = await sourceIngestionRevisionStore.create({
        ownerId,
        documentId: input.documentId,
        strategy: "browser-render",
        canonicalUrl,
        policyRef: "ingestion-public-url-policy.v1",
        settings: { explicitDynamicRetry: true },
      });
      const failure = await sourceIngestionRevisionStore.failed(
        ownerId,
        revision.id,
        new AdvancedIngestionError(
          "placement_unavailable",
          "Dynamic rendering requires a configured, attested browser sandbox",
          false,
        ),
      );
      return {
        revisionId: revision.id,
        status: "failed" as const,
        reasonCode: failure.reasonCode,
        message: failure.message,
      };
    }),

  acceptVideoExtractionNotice: protectedProcedure
    .input(z.object({ accepted: z.literal(true) }).strict())
    .handler(async ({ context }) => {
      const ownerId = context.session.user.id;
      const id = `iconsent_${sha256(`${ownerId}:${VIDEO_EXTRACTION_CONSENT_REVISION}`).slice(0, 24)}`;
      const timestamp = Math.floor(Date.now() / 1_000);
      await db.$client.execute({
        sql: `
          INSERT INTO source_ingestion_consents (
            id, userId, purpose, revision, noticeDigest, acceptedAt, revokedAt
          ) VALUES (?, ?, 'video-audio-extraction', ?, ?, ?, NULL)
          ON CONFLICT(userId, purpose, revision) DO UPDATE SET
            noticeDigest = excluded.noticeDigest,
            acceptedAt = excluded.acceptedAt,
            revokedAt = NULL
        `,
        args: [
          id,
          ownerId,
          VIDEO_EXTRACTION_CONSENT_REVISION,
          VIDEO_EXTRACTION_NOTICE_DIGEST,
          timestamp,
        ],
      });
      return {
        revision: VIDEO_EXTRACTION_CONSENT_REVISION,
        noticeDigest: VIDEO_EXTRACTION_NOTICE_DIGEST,
      };
    }),

  revokeVideoExtractionNotice: protectedProcedure.handler(
    async ({ context }) => {
      await db.$client.execute({
        sql: `UPDATE source_ingestion_consents SET revokedAt = ? WHERE userId = ? AND purpose = 'video-audio-extraction' AND revision = ? AND revokedAt IS NULL`,
        args: [
          Math.floor(Date.now() / 1_000),
          context.session.user.id,
          VIDEO_EXTRACTION_CONSENT_REVISION,
        ],
      });
      return { revoked: true as const };
    },
  ),

  planArtifact: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1).nullable().default(null),
          kind: generatedArtifactKindSchema,
          title: z.string().trim().min(1).max(160),
          sourceVersionIds: z.array(z.string().min(1)).max(5_000).default([]),
          parentArtifactRevisionIds: z
            .array(z.string().min(1))
            .max(100)
            .default([]),
          settings: z.record(z.string(), z.unknown()).default({}),
          idempotencyKey: z.string().min(8).max(256),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const placement = input.kind === "video-timeline" ? "core" : "unavailable";
      return coreArtifactGraphStore.plan({
        ownerId: context.session.user.id,
        ...input,
        placement,
        policyRef: "advanced-media-workflow-policy.v1",
      });
    }),

  listArtifacts: protectedProcedure
    .input(z.object({ projectId: z.string().min(1).nullable().default(null) }).strict())
    .handler(({ context, input }) =>
      coreArtifactGraphStore.list(context.session.user.id, input.projectId),
    ),

  getWorkflow: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }).strict())
    .handler(({ context, input }) =>
      coreArtifactGraphStore.getRun(context.session.user.id, input.runId),
    ),

  getManifest: protectedProcedure
    .input(z.object({ artifactRevisionId: z.string().min(1) }).strict())
    .handler(({ context, input }) =>
      coreArtifactGraphStore.getManifest(
        context.session.user.id,
        input.artifactRevisionId,
      ),
    ),

  cancelWorkflow: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }).strict())
    .handler(({ context, input }) =>
      artifactWorkflowStore.cancel({
        ownerId: context.session.user.id,
        runId: input.runId,
      }),
    ),

  approveStage: protectedProcedure
    .input(
      z.object({ runId: z.string().min(1), stageId: z.string().min(1) }).strict(),
    )
    .handler(({ context, input }) =>
      artifactWorkflowStore.approve({
        ownerId: context.session.user.id,
        ...input,
      }),
    ),

  retryStage: protectedProcedure
    .input(
      z.object({ runId: z.string().min(1), stageId: z.string().min(1) }).strict(),
    )
    .handler(({ context, input }) =>
      artifactWorkflowStore.retry({
        ownerId: context.session.user.id,
        ...input,
      }),
    ),

  promoteRevision: protectedProcedure
    .input(
      artifactIdentityInput.extend({ artifactRevisionId: z.string().min(1) }),
    )
    .handler(({ context, input }) =>
      coreArtifactGraphStore.promote({
        ownerId: context.session.user.id,
        ...input,
      }),
    ),

  setArtifactState: protectedProcedure
    .input(
      artifactIdentityInput.extend({
        state: z.enum(["active", "archived", "trashed"]),
      }),
    )
    .handler(({ context, input }) =>
      coreArtifactGraphStore.setState({
        ownerId: context.session.user.id,
        ...input,
      }),
    ),
};

