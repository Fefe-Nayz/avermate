import { generatedArtifactKindSchema } from "@avermate/agent-contracts";
import { z } from "zod";
import { db } from "../db";
import { artifactWorkflowStore } from "../ingestion/artifact-workflow-store";
import { artifactWorkflowDispatcher } from "../ingestion/artifact-workflow-dispatcher";
import { coreArtifactGraphStore } from "../ingestion/artifact-graph";
import { AdvancedIngestionError } from "../ingestion/errors";
import { sourceIngestionRevisionStore } from "../ingestion/revision-store";
import { sha256 } from "../search/values";
import { badRequest, notFound, protectedProcedure } from "../lib/orpc";
import { coreNodeRegistry, coreNodeRelay } from "../node/services";
import { fileHandleService } from "../routes/file-handles";
import { enqueueLinkIngestion } from "../jobs/ingest-link";
import { parseYoutubeUrl } from "../lib/youtube";

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

const ATTESTED_NODE_ISOLATION = new Set(["gvisor", "kata", "microvm"]);

async function activeVideoExtractionConsent(ownerId: string) {
  const result = await db.$client.execute({
    sql: `SELECT acceptedAt FROM source_ingestion_consents
      WHERE userId = ? AND purpose = 'video-audio-extraction'
        AND revision = ? AND noticeDigest = ? AND revokedAt IS NULL
      LIMIT 1`,
    args: [
      ownerId,
      VIDEO_EXTRACTION_CONSENT_REVISION,
      VIDEO_EXTRACTION_NOTICE_DIGEST,
    ],
  });
  const acceptedAt = result.rows[0]?.acceptedAt;
  return acceptedAt === null || acceptedAt === undefined
    ? null
    : new Date(Number(acceptedAt) * 1_000).toISOString();
}

async function resolveArtifactNode(
  ownerId: string,
  acceptedJobKinds: readonly string[],
  requestedNodeId?: string,
) {
  const nodes = await coreNodeRegistry.listNodes(ownerId);
  for (const candidate of nodes) {
    if (requestedNodeId && candidate.nodeId !== requestedNodeId) continue;
    if (!candidate.online) continue;
    const relay = coreNodeRelay.inspect(candidate.nodeId);
    const matchingKind = acceptedJobKinds.find(
      (kind) =>
        relay?.features.jobs?.kinds.includes(kind) &&
        (!kind.startsWith("artifact.") ||
          relay.features.jobs.executionProfiles?.some(
            (profile) => profile.kind === kind,
          )),
    );
    if (
      relay?.userId !== ownerId ||
      !relay.features.storage ||
      !relay.features.jobs ||
      !relay.features.sandbox ||
      !ATTESTED_NODE_ISOLATION.has(relay.features.sandbox.isolation) ||
      !matchingKind
    ) {
      continue;
    }
    return relay;
  }
  return null;
}

function requestedNodeExecution(settings: Record<string, unknown>) {
  const value = settings.nodeExecution;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  return {
    jobKind: typeof record.jobKind === "string" ? record.jobKind : null,
    nodeId: typeof record.nodeId === "string" ? record.nodeId : undefined,
  };
}

function allowedArtifactJobKinds(kind: z.infer<typeof generatedArtifactKindSchema>) {
  if (kind === "video") return ["artifact.render-video@1"] as const;
  if (kind === "thumbnail") return ["artifact.compose-thumbnail@1"] as const;
  if (kind === "video-timeline") return [] as const;
  return ["specialist.opencode@1", "specialist.openhands@1"] as const;
}

export const mediaStudioRouter = {
  capabilities: protectedProcedure.handler(async ({ context }) => {
    const ownerId = context.session.user.id;
    const [browserRender, mediaRender, videoExtraction, specialist] = await Promise.all([
      resolveArtifactNode(ownerId, ["artifact.browser-render@1"]),
      resolveArtifactNode(ownerId, ["artifact.render-video@1"]),
      resolveArtifactNode(ownerId, ["artifact.video-audio-extract@1"]),
      resolveArtifactNode(ownerId, [
        "specialist.opencode@1",
        "specialist.openhands@1",
      ]),
    ]);
    const unavailable = (message: string) => ({
      available: false as const,
      reasonCode: "placement_unavailable" as const,
      message,
    });
    return {
      staticHtml: { available: true as const, placement: "core" as const },
      platformCaptions: { available: true as const, placement: "core" as const },
      dynamicWebRendering: browserRender
        ? {
            available: true as const,
            placement: "node" as const,
            nodeId: browserRender.nodeId,
          }
        : unavailable(
            "No attested browser sandbox placement is configured for this request",
          ),
      videoAudioExtraction: videoExtraction
        ? {
            available: true as const,
            placement: "node" as const,
            nodeId: videoExtraction.nodeId,
          }
        : unavailable(
            "No attested node media sandbox placement is configured for this request",
          ),
      mediaTimelineRendering: mediaRender
        ? {
            available: true as const,
            placement: "node" as const,
            nodeId: mediaRender.nodeId,
          }
        : unavailable(
            "No attested FFmpeg sandbox placement is configured for this request",
          ),
      specialistArtifactGeneration: specialist
        ? {
            available: true as const,
            placement: "node" as const,
            nodeId: specialist.nodeId,
            kinds: specialist.features.jobs?.kinds.filter((kind) =>
              kind.startsWith("specialist."),
            ) ?? [],
          }
        : unavailable(
            "No reviewed OpenCode or OpenHands worker is available on an attested Node",
          ),
      manimRendering: {
        available: false as const,
        reasonCode: "capability_disabled" as const,
        message:
          "Reviewed Manim DSL translation is not enabled on a conforming placement",
      },
    };
  }),

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
      if (typeof canonicalUrl !== "string")
        badRequest("The link material is unavailable");
      const node = await resolveArtifactNode(ownerId, [
        "artifact.browser-render@1",
      ]);
      if (!node) {
        throw new AdvancedIngestionError(
          "placement_unavailable",
          "Dynamic rendering requires a configured, attested browser sandbox",
          false,
        );
      }
      const job = await enqueueLinkIngestion({
        documentId: input.documentId,
        userId: ownerId,
        strategy: "browser-render",
        nodeId: node.nodeId,
        idempotencyKey: `dynamic:${input.documentId}:${crypto.randomUUID()}`,
      });
      return {
        revisionId: job.advancedRevisionId,
        jobId: job.id,
        status: job.status,
      };
    }),

  videoExtractionConsent: protectedProcedure.handler(async ({ context }) => {
    const acceptedAt = await activeVideoExtractionConsent(
      context.session.user.id,
    );
    return {
      active: Boolean(acceptedAt),
      acceptedAt,
      revision: VIDEO_EXTRACTION_CONSENT_REVISION,
      noticeDigest: VIDEO_EXTRACTION_NOTICE_DIGEST,
      notice: EXTRACTION_NOTICE,
    };
  }),

  retryVideoAudio: protectedProcedure
    .input(
      z
        .object({
          documentId: z.string().min(1),
          preferredLanguage: z.string().trim().min(2).max(35).default("fr"),
        })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const ownerId = context.session.user.id;
      const source = await db.$client.execute({
        sql: `SELECT sourceUrl FROM material_documents
          WHERE id = ? AND userId = ? AND sourceType = 'link' LIMIT 1`,
        args: [input.documentId, ownerId],
      });
      const canonicalUrl = source.rows[0]?.sourceUrl;
      if (
        typeof canonicalUrl !== "string" ||
        !parseYoutubeUrl(canonicalUrl)
      ) {
        badRequest("The public YouTube material is unavailable");
      }
      const acceptedAt = await activeVideoExtractionConsent(ownerId);
      if (!acceptedAt) {
        badRequest("Accept the authorized-use notice before audio extraction");
      }
      const node = await resolveArtifactNode(ownerId, [
        "artifact.video-audio-extract@1",
      ]);
      if (!node) {
        throw new AdvancedIngestionError(
          "placement_unavailable",
          "No attested node media sandbox is available",
          false,
        );
      }
      const job = await enqueueLinkIngestion({
        documentId: input.documentId,
        userId: ownerId,
        strategy: "youtube",
        requestAudioFallback: true,
        preferredLanguage: input.preferredLanguage,
        consentRevision: VIDEO_EXTRACTION_CONSENT_REVISION,
        nodeId: node.nodeId,
        idempotencyKey: `video-audio:${input.documentId}:${crypto.randomUUID()}`,
      });
      return {
        revisionId: job.advancedRevisionId,
        jobId: job.id,
        status: job.status,
        consentRevision: VIDEO_EXTRACTION_CONSENT_REVISION,
        acceptedAt,
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
      const ownerId = context.session.user.id;
      const execution = requestedNodeExecution(input.settings);
      const allowedKinds = allowedArtifactJobKinds(input.kind);
      const exactKind = execution?.jobKind ? `${execution.jobKind}@1` : null;
      const node =
        exactKind && allowedKinds.includes(exactKind as never)
          ? await resolveArtifactNode(
              ownerId,
              [exactKind],
              execution?.nodeId,
            )
          : null;
      const placement = input.kind === "video-timeline"
        ? "core"
        : node
          ? "node"
          : "unavailable";
      const planned = await coreArtifactGraphStore.plan({
        ownerId,
        ...input,
        placement,
        placementRef: node?.nodeId ?? null,
        policyRef: "advanced-media-workflow-policy.v1",
      });
      return artifactWorkflowDispatcher.dispatch({
        ownerId,
        runId: planned.id,
        artifactId: planned.artifactId,
        kind: input.kind,
        inputDigest: planned.inputDigest,
        sourceVersionIds: input.sourceVersionIds,
        parentArtifactRevisionIds: input.parentArtifactRevisionIds,
        settings: input.settings,
      });
    }),

  listArtifacts: protectedProcedure
    .input(
      z
        .object({ projectId: z.string().min(1).nullable().default(null) })
        .strict(),
    )
    .handler(({ context, input }) =>
      coreArtifactGraphStore.list(context.session.user.id, input.projectId),
    ),

  listWorkflows: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string().min(1).nullable().default(null),
          artifactId: z.string().min(1).nullable().default(null),
          limit: z.number().int().min(1).max(100).default(50),
        })
        .strict(),
    )
    .handler(({ context, input }) =>
      coreArtifactGraphStore.listRuns(context.session.user.id, input),
    ),

  listRevisions: protectedProcedure
    .input(z.object({ artifactId: z.string().min(1) }).strict())
    .handler(({ context, input }) =>
      coreArtifactGraphStore.listRevisions(
        context.session.user.id,
        input.artifactId,
      ),
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

  getOutputHandles: protectedProcedure
    .input(z.object({ artifactRevisionId: z.string().min(1) }).strict())
    .handler(async ({ context, input }) => {
      const result = await db.$client.execute({
        sql: `
          SELECT revision.outputFileId, revision.outputMime, revision.byteSize,
            file.byteSize AS fileByteSize
          FROM generated_artifact_revisions revision
          JOIN files file ON file.id = revision.outputFileId
          WHERE revision.id = ? AND revision.userId = ?
            AND file.userId = ? AND file.status = 'stored'
          LIMIT 1
        `,
        args: [
          input.artifactRevisionId,
          context.session.user.id,
          context.session.user.id,
        ],
      });
      const row = result.rows[0];
      if (!row || typeof row.outputFileId !== "string") {
        notFound("Artifact output");
      }
      const byteSize = Number(row.fileByteSize ?? row.byteSize ?? 0);
      const common = {
        fileId: row.outputFileId,
        userId: context.session.user.id,
        mimeType: String(row.outputMime),
        byteSize,
      };
      const [preview, download] = await Promise.all([
        fileHandleService.mint({ ...common, audience: "preview" }),
        fileHandleService.mint({ ...common, audience: "download" }),
      ]);
      return { preview, download };
    }),

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
      z
        .object({ runId: z.string().min(1), stageId: z.string().min(1) })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const ownerId = context.session.user.id;
      const approved = await artifactWorkflowStore.approve({
        ownerId,
        ...input,
      });
      await artifactWorkflowDispatcher.resume(ownerId, input.runId);
      return approved;
    }),

  retryStage: protectedProcedure
    .input(
      z
        .object({ runId: z.string().min(1), stageId: z.string().min(1) })
        .strict(),
    )
    .handler(async ({ context, input }) => {
      const ownerId = context.session.user.id;
      const disposition = await artifactWorkflowStore.retry({
        ownerId,
        ...input,
      });
      if (disposition.retry) {
        await artifactWorkflowDispatcher.resume(ownerId, input.runId);
      }
      return disposition;
    }),

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
