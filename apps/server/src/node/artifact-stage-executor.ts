import {
  nodeArtifactRefSchema,
  type NodeArtifactRef,
  type NodeJobEvent,
} from "@avermate/agent-contracts";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../db";
import {
  ArtifactWorkflowStageInputError,
  type ArtifactWorkflowStageExecutionInput,
  type ArtifactWorkflowStageExecutor,
} from "../ingestion/artifact-stage-executor";
import {
  CoreArtifactGraphStore,
  coreArtifactGraphStore,
} from "../ingestion/artifact-graph";
import {
  adoptPairedNodeArtifact,
  deletePairedNodeArtifacts,
  dispatchPairedNodeJob,
  MAX_NODE_ARTIFACT_ADOPTION_BYTES,
  readPairedNodeArtifact,
} from "./services";

const digestSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const nodeExecutionSchema = z.strictObject({
  nodeId: z.string().min(1).max(256).optional(),
  jobKind: z.enum([
    "specialist.opencode",
    "specialist.openhands",
    "artifact.render-video",
    "artifact.compose-thumbnail",
  ]),
  inputRefs: z.array(nodeArtifactRefSchema).min(1).max(256),
  outputIndex: z.number().int().nonnegative().max(255).default(0),
  limits: z
    .strictObject({
      cpuMillis: z
        .number()
        .int()
        .positive()
        .max(60 * 60_000),
      memoryBytes: z
        .number()
        .int()
        .positive()
        .max(32 * 1024 ** 3),
      inputBytes: z
        .number()
        .int()
        .positive()
        .max(2 * 1024 ** 3),
      outputBytes: z
        .number()
        .int()
        .positive()
        .max(2 * 1024 ** 3),
    })
    .default({
      cpuMillis: 15 * 60_000,
      memoryBytes: 2 * 1024 ** 3,
      inputBytes: 64 * 1024 ** 2,
      outputBytes: 512 * 1024 ** 2,
    }),
});

const nodeAdoptionSchema = z.strictObject({
  maxBytes: z
    .number()
    .int()
    .positive()
    .max(MAX_NODE_ARTIFACT_ADOPTION_BYTES)
    .default(MAX_NODE_ARTIFACT_ADOPTION_BYTES),
  name: z.string().min(1).max(240).optional(),
});

const adoptionToolVersionsSchema = z.strictObject({
  nodeId: z.string().min(1).max(256),
  capabilityRevision: z.string().min(1).max(256),
  jobEnvelope: digestSchema,
  nodeObjectRef: z.string().min(2).max(2_048),
  nodeOutputDigest: digestSchema,
});

const extensionByMime: Readonly<Record<string, string>> = {
  "application/pdf": ".pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    ".pptx",
  "audio/mpeg": ".mp3",
  "audio/mp4": ".m4a",
  "audio/ogg": ".ogg",
  "image/png": ".png",
  "image/webp": ".webp",
  "text/tab-separated-values": ".tsv",
  "text/html": ".html",
};

type AdoptArtifact = typeof adoptPairedNodeArtifact;

type SqlClient = Pick<typeof db.$client, "execute">;

function stableJobId(input: ArtifactWorkflowStageExecutionInput) {
  return `nodejob_${createHash("sha256")
    .update(
      [
        input.ownerId,
        input.runId,
        input.stageId,
        String(input.stageAttempt),
        input.stageInputDigest,
      ].join("\0"),
    )
    .digest("hex")
    .slice(0, 40)}`;
}

function assertJobKind(
  stageKey: ArtifactWorkflowStageExecutionInput["stageKey"],
  jobKind: z.infer<typeof nodeExecutionSchema>["jobKind"],
) {
  const accepted =
    (stageKey === "generate" && jobKind.startsWith("specialist.")) ||
    (stageKey === "render-video" && jobKind === "artifact.render-video") ||
    (stageKey === "compose-thumbnail" &&
      jobKind === "artifact.compose-thumbnail");
  if (!accepted) {
    throw new ArtifactWorkflowStageInputError(
      `The reviewed Node job ${jobKind} cannot execute ${stageKey}`,
    );
  }
}

/**
 * Production bridge from durable artifact stages to exact, signed Node jobs.
 * Inputs are pre-adopted owner-bound object refs. Reviewed results are first
 * published as immutable Node provenance and may then be adopted through the
 * signed bounded storage lane into an owned Core file and a new revision.
 */
export class CoreNodeArtifactWorkflowStageExecutor implements ArtifactWorkflowStageExecutor {
  constructor(
    private readonly client: SqlClient = db.$client,
    private readonly graph: Pick<
      CoreArtifactGraphStore,
      "publishRevision"
    > = coreArtifactGraphStore,
    private readonly dispatch: typeof dispatchPairedNodeJob = dispatchPairedNodeJob,
    private readonly readArtifact: typeof readPairedNodeArtifact = readPairedNodeArtifact,
    private readonly adoptArtifact: AdoptArtifact = adoptPairedNodeArtifact,
    private readonly deleteArtifacts: typeof deletePairedNodeArtifacts = deletePairedNodeArtifacts,
  ) {}

  async execute(
    input: ArtifactWorkflowStageExecutionInput,
    signal?: AbortSignal,
  ) {
    signal?.throwIfAborted();
    if (input.stageKey === "adopt-output") {
      return this.#adoptPreviousRevision(input);
    }
    const parsed = nodeExecutionSchema.safeParse(input.settings.nodeExecution);
    if (!parsed.success) {
      throw new ArtifactWorkflowStageInputError(
        "A reviewed, owner-bound Node execution manifest is required",
        { cause: parsed.error },
      );
    }
    assertJobKind(input.stageKey, parsed.data.jobKind);
    if (
      parsed.data.inputRefs.some(
        (artifact) => artifact.object.ownerId !== input.ownerId,
      )
    ) {
      throw new ArtifactWorkflowStageInputError(
        "A Node artifact input belongs to a different account",
      );
    }
    const declaredInputBytes = parsed.data.inputRefs.reduce(
      (total, artifact) => total + artifact.byteSize,
      0,
    );
    if (declaredInputBytes > parsed.data.limits.inputBytes) {
      throw new ArtifactWorkflowStageInputError(
        "Node artifact inputs exceed the reviewed byte budget",
      );
    }
    const jobId = stableJobId(input);
    const execution = await this.dispatch({
      ownerId: input.ownerId,
      ...(parsed.data.nodeId ? { nodeId: parsed.data.nodeId } : {}),
      jobId,
      kind: parsed.data.jobKind,
      inputRefs: parsed.data.inputRefs,
      limits: {
        ...parsed.data.limits,
        deadline: input.executionDeadline,
      },
      idempotencyKey: `${input.runId}:${input.stageId}:${input.stageAttempt}`,
      signal,
      onEvent: (event) => this.#recordProgress(input, event),
    });
    const output = execution.resultManifest[parsed.data.outputIndex];
    if (!output) {
      throw new ArtifactWorkflowStageInputError(
        "The reviewed Node job did not return the selected artifact",
      );
    }
    this.#assertOutput(input.ownerId, output);
    const published = await this.graph.publishRevision({
      ownerId: input.ownerId,
      artifactId: input.artifactId,
      workflowRunId: input.runId,
      parentArtifactRevisionIds: input.parentArtifactRevisionIds,
      sourceVersionIds: input.sourceVersionIds,
      renderer: {
        profile: `node.${parsed.data.jobKind}`,
        imageDigest: null,
        toolVersions: {
          nodeId: execution.nodeId,
          capabilityRevision: execution.configRevision,
          jobEnvelope: execution.job.envelopeDigest,
          nodeObjectRef: JSON.stringify(output.object),
          nodeOutputDigest: output.digest,
        },
        // The signed job and bytes are deterministic inputs, but Core cannot
        // claim full replay until the worker image digest is in the manifest.
        reproducibility: "best-effort",
      },
      output: {
        digest: output.digest.slice("sha256:".length),
        bytes: output.byteSize,
        mime: output.mimeType,
      },
    });
    return published.artifactRevisionId;
  }

  async #adoptPreviousRevision(input: ArtifactWorkflowStageExecutionInput) {
    const replay = await this.client.execute({
      sql: `SELECT id, outputFileId, revision
        FROM generated_artifact_revisions
        WHERE artifactId = ? AND userId = ? AND workflowRunId = ?
          AND outputFileId IS NOT NULL
          AND json_extract(manifestJson, '$.renderer.profile') =
            'core.node-artifact-adoption'
          AND json_extract(
            manifestJson,
            '$.renderer.toolVersions.adoptionStageId'
          ) = ?
        ORDER BY revision DESC LIMIT 1`,
      args: [input.artifactId, input.ownerId, input.runId, input.stageId],
    });
    const replayedRevisionId = replay.rows[0]?.id;
    if (typeof replayedRevisionId === "string" && replayedRevisionId) {
      return replayedRevisionId;
    }
    const result = await this.client.execute({
      sql: `SELECT revision.id, revision.outputDigest, revision.outputMime,
          revision.byteSize, revision.manifestJson
        FROM artifact_workflow_stages stage
        JOIN generated_artifact_revisions revision
          ON revision.id = stage.outputArtifactRevisionId
         AND revision.userId = stage.userId
        WHERE stage.runId = ? AND stage.userId = ? AND stage.position < ?
          AND stage.status = 'completed'
          AND stage.outputArtifactRevisionId IS NOT NULL
        ORDER BY stage.position DESC LIMIT 1`,
      args: [input.runId, input.ownerId, input.stagePosition],
    });
    const previous = result.rows[0];
    const revisionId = previous?.id;
    if (typeof revisionId !== "string" || !revisionId) {
      throw new ArtifactWorkflowStageInputError(
        "No verified Node output is available to adopt",
      );
    }
    const manifest = z
      .record(z.string(), z.unknown())
      .parse(
        typeof previous.manifestJson === "string"
          ? JSON.parse(previous.manifestJson)
          : previous.manifestJson,
      );
    const renderer = z.record(z.string(), z.unknown()).parse(manifest.renderer);
    const tools = adoptionToolVersionsSchema.parse(renderer.toolVersions);
    const artifact = nodeArtifactRefSchema.parse({
      object: JSON.parse(tools.nodeObjectRef),
      digest: tools.nodeOutputDigest,
      byteSize: Number(previous.byteSize),
      mimeType: String(previous.outputMime),
    });
    if (
      artifact.digest.slice("sha256:".length) !==
        String(previous.outputDigest) ||
      artifact.object.ownerId !== input.ownerId
    ) {
      throw new ArtifactWorkflowStageInputError(
        "The Node output provenance does not match the immutable revision",
      );
    }
    const adoption = nodeAdoptionSchema.parse(
      input.settings.nodeAdoption ?? {},
    );
    if (artifact.byteSize > adoption.maxBytes) {
      throw new ArtifactWorkflowStageInputError(
        "The Node output exceeds the reviewed adoption byte budget",
      );
    }
    const extension = extensionByMime[artifact.mimeType];
    if (!extension) {
      throw new ArtifactWorkflowStageInputError(
        "The Node output MIME type is not approved for Core artifact storage",
      );
    }
    const adoptionId = `nadopt_${createHash("sha256")
      .update(
        [
          input.ownerId,
          input.runId,
          input.stageId,
          revisionId,
          artifact.digest,
        ].join("\0"),
      )
      .digest("hex")
      .slice(0, 40)}`;
    const stored = await this.adoptArtifact({
      ownerId: input.ownerId,
      adoptionId,
      idempotencyKey: `${input.runId}:${input.stageId}:${revisionId}`,
      artifact,
      loadBytes: async () =>
        (
          await this.readArtifact({
            ownerId: input.ownerId,
            nodeId: tools.nodeId,
            artifact,
            maxBytes: adoption.maxBytes,
          })
        ).bytes,
    });
    await this.deleteArtifacts({
      ownerId: input.ownerId,
      nodeId: tools.nodeId,
      artifacts: [artifact],
    });
    const published = await this.graph.publishRevision({
      ownerId: input.ownerId,
      artifactId: input.artifactId,
      workflowRunId: input.runId,
      parentArtifactRevisionIds: [
        ...new Set([...input.parentArtifactRevisionIds, revisionId]),
      ],
      sourceVersionIds: input.sourceVersionIds,
      renderer: {
        profile: "core.node-artifact-adoption",
        imageDigest: null,
        toolVersions: {
          adoptionStageId: input.stageId,
          sourceArtifactRevisionId: revisionId,
          nodeId: tools.nodeId,
          nodeObjectDigest: artifact.digest,
          objectAdoptionId: adoptionId,
        },
        reproducibility: "full",
      },
      output: {
        fileId: stored.fileId,
        digest: artifact.digest.slice("sha256:".length),
        bytes: artifact.byteSize,
        mime: artifact.mimeType,
      },
    });
    return published.artifactRevisionId;
  }

  async #recordProgress(
    input: ArtifactWorkflowStageExecutionInput,
    event: NodeJobEvent,
  ) {
    if (!event.progress) return;
    await this.client.execute({
      sql: `UPDATE artifact_workflow_stages
        SET processed = ?, total = ?, unit = ?, message = ?, updatedAt = ?
        WHERE id = ? AND runId = ? AND userId = ? AND status = 'running'`,
      args: [
        Math.floor(event.progress.numerator),
        Math.max(1, Math.ceil(event.progress.denominator)),
        event.progress.unit.slice(0, 64),
        event.progress.message.slice(0, 512),
        Math.floor(Date.now() / 1_000),
        input.stageId,
        input.runId,
        input.ownerId,
      ],
    });
  }

  #assertOutput(ownerId: string, artifact: NodeArtifactRef) {
    nodeArtifactRefSchema.parse(artifact);
    digestSchema.parse(artifact.digest);
    if (artifact.object.ownerId !== ownerId) {
      throw new ArtifactWorkflowStageInputError(
        "The Node output belongs to a different account",
      );
    }
  }
}
