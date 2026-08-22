import { z } from "zod";
import { and, eq, inArray, isNull } from "drizzle-orm";
import type {
  AnyAvermateToolDescriptor,
  AvermateToolDescriptor,
  ToolBudget,
  ToolExecutionContext,
} from "@avermate/agent-contracts";
import type { Api } from "../mcp/shared";
import { db } from "../db";
import {
  createPersonalTaskCommand,
  personalTaskRevision,
} from "../actions/personal-task-command";
import { actionHash } from "../actions/action-ledger";
import type { FileHandleService } from "./file-handles";
import { ToolBroker } from "./broker";
import { ToolRegistry } from "./registry";
import { coreArtifactGraphStore } from "../ingestion/artifact-graph";
import { artifactWorkflowStore } from "../ingestion/artifact-workflow-store";
import { artifactWorkflowDispatcher } from "../ingestion/artifact-workflow-dispatcher";
import type { ToolActionContinuationStore } from "./action-continuation";
import { actionLedgerService } from "../actions/services";
import { cardSurfaceSchema } from "../lib/card-storage";
import { learningObjectives } from "../db/schema";

const inputBudget = {
  maxBytes: 16 * 1024,
  maxDepth: 8,
  maxItems: 200,
} as const;
const readBudget = {
  maxBytes: 512 * 1024,
  maxDepth: 32,
  maxItems: 20_000,
} as const;
const modelBudget = {
  maxBytes: 256 * 1024,
  maxDepth: 24,
  maxItems: 10_000,
} as const;
const auditBudget = {
  maxBytes: 16 * 1024,
  maxDepth: 8,
  maxItems: 500,
} as const;
const jsonSchema = z.json();
const auditSchema = z.strictObject({
  outcome: z.literal("read"),
  count: z.number().int().nonnegative(),
  resourceIds: z.array(z.string()).max(200),
});
const id = z.string().trim().min(1).max(256);
const isoDate = z.iso.datetime({ offset: true });
const taskCreateInputSchema = z.strictObject({
  yearId: id,
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(10_000).nullable().default(null),
  localNote: z.string().trim().max(4_000).nullable().default(null),
  startsAt: isoDate.nullable().default(null),
  scheduledAt: isoDate.nullable().default(null),
  dueAt: isoDate.nullable().default(null),
  subjectId: id.nullable().default(null),
});
const taskCreateOutputSchema = z.strictObject({
  id: z.string(),
  title: z.string(),
  yearId: z.string(),
  subjectId: z.string().nullable(),
  status: z.enum(["todo", "doing", "done"]),
  revision: z.number().int().positive(),
  scheduledAt: isoDate.nullable(),
  dueAt: isoDate.nullable(),
  trashedAt: isoDate.nullable(),
});
const taskCreateAuditSchema = z.strictObject({
  outcome: z.literal("created"),
  resourceKind: z.literal("planning-task"),
  resourceId: z.string(),
  afterRevision: z.string(),
});

function json(value: unknown): z.infer<typeof jsonSchema> {
  return JSON.parse(JSON.stringify(value)) as z.infer<typeof jsonSchema>;
}

function audit(value: z.infer<typeof jsonSchema>) {
  const rows = Array.isArray(value) ? value : [value];
  return {
    outcome: "read" as const,
    count: Array.isArray(value) ? value.length : value === null ? 0 : 1,
    resourceIds: rows
      .flatMap((row) =>
        row &&
        typeof row === "object" &&
        !Array.isArray(row) &&
        typeof row.id === "string"
          ? [row.id]
          : [],
      )
      .slice(0, 200),
  };
}

type ReadDescriptor<I> = AvermateToolDescriptor<
  I,
  z.infer<typeof jsonSchema>,
  z.infer<typeof jsonSchema>,
  z.infer<typeof jsonSchema>,
  z.infer<typeof auditSchema>
>;

function readDescriptor<I>(input: {
  id: string;
  title: string;
  description: string;
  scope: string;
  inputSchema: z.ZodType<I>;
  execute: (
    api: Api,
    input: I,
    context: ToolExecutionContext,
  ) => Promise<unknown>;
  api: Api;
  resultBudget?: ToolBudget;
}): ReadDescriptor<I> {
  const resultBudget = input.resultBudget ?? readBudget;
  return {
    id: input.id,
    version: 1,
    title: input.title,
    description: input.description,
    inputSchema: input.inputSchema,
    outputSchema: jsonSchema,
    requiredScopes: [input.scope],
    effect: "read",
    risk: "low",
    approval: "never",
    idempotency: "none",
    preview: "none",
    compensation: "none",
    inputBudget,
    resultBudget,
    redact: (value) => json(value),
    execute: async (context, value) =>
      json(await input.execute(input.api, value, context)),
    resultProjections: {
      model: {
        schema: jsonSchema,
        budget: modelBudget,
        project: (value) => value,
      },
      ui: {
        schema: jsonSchema,
        budget: resultBudget,
        project: (value) => value,
      },
      audit: { schema: auditSchema, budget: auditBudget, project: audit },
    },
  };
}

type MediaMutationResource = {
  resourceKind: string;
  resourceId: string;
  operation: "create" | "update" | "delete";
  beforeRevision: string | null;
  afterRevision: string | null;
  beforeSnapshot?: unknown;
  afterSnapshot?: unknown;
};

function mediaMutationDescriptor<I>(input: {
  id: string;
  title: string;
  description: string;
  scope: string;
  effect: "create" | "update" | "external";
  risk: "medium" | "high";
  approval: "policy" | "always";
  compensation?: "none" | "supported" | "guaranteed";
  compensatorId?: string;
  crashRecovery?: "idempotent-retry" | "inspect-required";
  inputSchema: z.ZodType<I>;
  preview: (value: I) => unknown;
  actionScope: (value: I) => { kind: string; id: string } | null;
  execute: (context: ToolExecutionContext, value: I) => Promise<unknown>;
  resources: (
    value: I,
    output: z.infer<typeof jsonSchema>,
  ) => MediaMutationResource[];
}) {
  return {
    id: input.id,
    version: 1,
    title: input.title,
    description: input.description,
    inputSchema: input.inputSchema,
    outputSchema: jsonSchema,
    requiredScopes: [input.scope],
    effect: input.effect,
    risk: input.risk,
    approval: input.approval,
    idempotency: "required",
    preview: "required",
    compensation: input.compensation ?? "none",
    ...(input.compensatorId ? { compensatorId: input.compensatorId } : {}),
    crashRecovery: input.crashRecovery ?? "inspect-required",
    inputBudget,
    resultBudget: readBudget,
    redact: (value: I) => json(input.preview(value)),
    buildActionPreview: async (_context: ToolExecutionContext, value: I) =>
      json(input.preview(value)),
    actionScope: input.actionScope,
    execute: async (context: ToolExecutionContext, value: I) => {
      if (!context.actionReference) {
        throw new Error("A durable action reservation is required");
      }
      return json(await input.execute(context, value));
    },
    actionResources: input.resources,
    resultProjections: {
      model: { schema: jsonSchema, budget: modelBudget, project: json },
      ui: { schema: jsonSchema, budget: readBudget, project: json },
      audit: { schema: jsonSchema, budget: auditBudget, project: json },
    },
  } satisfies AvermateToolDescriptor<
    I,
    z.infer<typeof jsonSchema>,
    z.infer<typeof jsonSchema>,
    z.infer<typeof jsonSchema>,
    z.infer<typeof jsonSchema>
  >;
}

const artifactIdInput = z.string().trim().min(1).max(256);
const artifactPlanInputSchema = z.strictObject({
  projectId: artifactIdInput.nullable().default(null),
  kind: z.enum([
    "markdown",
    "latex-source",
    "pdf",
    "slides-source",
    "pptx",
    "quiz",
    "audio",
    "image",
    "anki",
    "html",
    "video-timeline",
    "video",
    "thumbnail",
  ]),
  title: z.string().trim().min(1).max(160),
  sourceVersionIds: z.array(artifactIdInput).max(5_000).default([]),
  parentArtifactRevisionIds: z.array(artifactIdInput).max(100).default([]),
  settings: z.record(z.string(), z.unknown()).default({}),
});

function advancedMediaMutationDescriptors() {
  const plan = mediaMutationDescriptor({
    id: "artifact.plan",
    title: "Plan an artifact workflow",
    description:
      "Create an owned artifact identity and launch its inspectable stages through the durable job runtime.",
    scope: "avermate:materials.write",
    effect: "create",
    risk: "medium",
    approval: "policy",
    compensation: "supported",
    compensatorId: "learning.evidence.restore-decision@1",
    crashRecovery: "idempotent-retry",
    inputSchema: artifactPlanInputSchema,
    preview: (value) => ({
      consequence: "Create a recoverable artifact workflow plan",
      kind: value.kind,
      title: value.title,
      sourceVersionCount: value.sourceVersionIds.length,
      parentRevisionCount: value.parentArtifactRevisionIds.length,
      rendererExecution: "durable-dispatch",
    }),
    actionScope: (value) => ({
      kind: value.projectId ? "study-project" : "artifact-studio",
      id: value.projectId ?? "personal",
    }),
    execute: async (context, value) => {
      const capability =
        value.kind === "video" || value.kind === "thumbnail"
          ? "mediaTimelineRendering"
          : "artifactGeneration";
      const requested =
        value.kind === "video-timeline"
          ? "core"
          : context.capabilities.placement(capability);
      const ownerId = context.principal.userId;
      const planned = await coreArtifactGraphStore.plan({
        ownerId,
        ...value,
        placement: requested,
        policyRef: "advanced-media-workflow-policy.v1",
        idempotencyKey: context.actionReference!,
        actionId: context.actionReference,
      });
      return artifactWorkflowDispatcher.dispatch({
        ownerId,
        runId: planned.id,
        artifactId: planned.artifactId,
        kind: value.kind,
        inputDigest: planned.inputDigest,
        sourceVersionIds: value.sourceVersionIds,
        parentArtifactRevisionIds: value.parentArtifactRevisionIds,
        settings: value.settings,
      });
    },
    resources: (_value, output) => {
      const record = output as Record<string, unknown>;
      return [
        {
          resourceKind: "generated-artifact",
          resourceId: String(record.artifactId),
          operation: "create",
          beforeRevision: null,
          afterRevision: "1",
        },
        {
          resourceKind: "artifact-workflow",
          resourceId: String(record.id),
          operation: "create",
          beforeRevision: null,
          afterRevision: String(record.inputDigest),
        },
      ];
    },
  });
  const cancelInput = z.strictObject({ runId: artifactIdInput });
  const cancel = mediaMutationDescriptor({
    id: "artifact.cancel",
    title: "Cancel an artifact workflow",
    description:
      "Request cooperative cancellation of an owned workflow and its active durable jobs.",
    scope: "avermate:materials.write",
    effect: "external",
    risk: "high",
    approval: "always",
    inputSchema: cancelInput,
    preview: (value) => ({
      consequence: "Request cooperative workflow cancellation",
      runId: value.runId,
      completedRevisionsRemainImmutable: true,
    }),
    actionScope: (value) => ({ kind: "artifact-workflow", id: value.runId }),
    execute: (context, value) =>
      artifactWorkflowStore.cancel({
        ownerId: context.principal.userId,
        runId: value.runId,
        reason: "Agent-requested cancellation approved by the user",
      }),
    resources: (value, output) => [
      {
        resourceKind: "artifact-workflow",
        resourceId: value.runId,
        operation: "update",
        beforeRevision: null,
        afterRevision: String((output as Record<string, unknown>).status),
      },
    ],
  });
  const stageInput = z.strictObject({
    runId: artifactIdInput,
    stageId: artifactIdInput,
  });
  const retry = mediaMutationDescriptor({
    id: "artifact.retry_stage",
    title: "Retry an artifact workflow stage",
    description:
      "Reset one owned failed/cancelled stage behind its digest and attempt fences; unavailable placements still fail closed.",
    scope: "avermate:materials.write",
    effect: "external",
    risk: "high",
    approval: "always",
    inputSchema: stageInput,
    preview: (value) => ({
      consequence: "Prepare one failed artifact stage for a bounded retry",
      ...value,
    }),
    actionScope: (value) => ({ kind: "artifact-workflow", id: value.runId }),
    execute: async (context, value) => {
      const ownerId = context.principal.userId;
      const disposition = await artifactWorkflowStore.retry({
        ownerId,
        ...value,
      });
      if (disposition.retry) {
        await artifactWorkflowDispatcher.resume(ownerId, value.runId);
      }
      return disposition;
    },
    resources: (value, output) => [
      {
        resourceKind: "artifact-workflow-stage",
        resourceId: value.stageId,
        operation: "update",
        beforeRevision: null,
        afterRevision: String(
          (output as Record<string, unknown>).nextAttempt ?? "unchanged",
        ),
      },
    ],
  });
  const promoteInput = z.strictObject({
    artifactId: artifactIdInput,
    artifactRevisionId: artifactIdInput,
    expectedIdentityRevision: z.number().int().positive(),
  });
  const promote = mediaMutationDescriptor({
    id: "artifact.promote",
    title: "Promote an artifact revision",
    description:
      "Move the mutable current pointer to an exact owned ready revision using an optimistic revision fence.",
    scope: "avermate:materials.write",
    effect: "update",
    risk: "medium",
    approval: "policy",
    inputSchema: promoteInput,
    preview: (value) => ({
      consequence: "Change only the artifact current pointer",
      ...value,
      immutableHistoryPreserved: true,
    }),
    actionScope: (value) => ({
      kind: "generated-artifact",
      id: value.artifactId,
    }),
    execute: (context, value) =>
      coreArtifactGraphStore.promote({
        ownerId: context.principal.userId,
        ...value,
      }),
    resources: (value) => [
      {
        resourceKind: "generated-artifact",
        resourceId: value.artifactId,
        operation: "update",
        beforeRevision: String(value.expectedIdentityRevision),
        afterRevision: String(value.expectedIdentityRevision + 1),
        afterSnapshot: { currentRevisionId: value.artifactRevisionId },
      },
    ],
  });
  const stateInput = z.strictObject({
    artifactId: artifactIdInput,
    expectedIdentityRevision: z.number().int().positive(),
    state: z.enum(["active", "archived", "trashed"]),
  });
  const setState = mediaMutationDescriptor({
    id: "artifact.set_state",
    title: "Change artifact lifecycle state",
    description:
      "Archive, restore, or move an owned artifact identity to trash without deleting its immutable revisions.",
    scope: "avermate:materials.write",
    effect: "update",
    risk: "medium",
    approval: "policy",
    inputSchema: stateInput,
    preview: (value) => ({
      consequence: `Set artifact lifecycle state to ${value.state}`,
      ...value,
      immutableHistoryPreserved: true,
    }),
    actionScope: (value) => ({
      kind: "generated-artifact",
      id: value.artifactId,
    }),
    execute: (context, value) =>
      coreArtifactGraphStore.setState({
        ownerId: context.principal.userId,
        ...value,
      }),
    resources: (value) => [
      {
        resourceKind: "generated-artifact",
        resourceId: value.artifactId,
        operation: "update",
        beforeRevision: String(value.expectedIdentityRevision),
        afterRevision: String(value.expectedIdentityRevision + 1),
        afterSnapshot: { state: value.state },
      },
    ],
  });
  return [plan, cancel, retry, promote, setState] as const;
}

function learningMutationDescriptors(api: Api) {
  const requestCopy = mediaMutationDescriptor({
    id: "learning.copy.request_analysis",
    title: "Request grade-copy analysis",
    description:
      "Queue OCR for one owned copy. The result remains a proposal and never changes the school grade.",
    scope: "avermate:learning.write",
    effect: "external",
    risk: "high",
    approval: "always",
    inputSchema: z.strictObject({ attachmentId: id }),
    preview: (value) => ({
      consequence:
        "Send only the selected owned copy to the configured OCR placement",
      attachmentId: value.attachmentId,
      createsEvidence: false,
      changesGrade: false,
    }),
    actionScope: (value) => ({
      kind: "grade-attachment",
      id: value.attachmentId,
    }),
    execute: (context, value) =>
      api.learning.copies.request({
        ...value,
        idempotencyKey: context.actionReference!,
      }),
    resources: (_value, output) => [
      {
        resourceKind: "learning-copy-analysis",
        resourceId: String((output as Record<string, unknown>).id),
        operation: "create",
        beforeRevision: null,
        afterRevision: String(
          (output as Record<string, unknown>).revision ?? 1,
        ),
      },
    ],
  });
  const reviewedRegion = z.strictObject({
    regionId: id,
    objectiveIds: z.array(id).min(1).max(12),
    observedOutcome: z.number().nonnegative().nullable().default(null),
    denominator: z.number().positive().nullable().default(null),
    difficulty: z.number().min(0).max(1).nullable().default(null),
    error: z
      .strictObject({
        taxonomy: z.enum([
          "missing-knowledge",
          "misunderstood-concept",
          "method-strategy",
          "calculation",
          "notation",
          "reading-instruction",
          "justification",
          "transfer",
          "time-management",
          "unclassified",
        ]),
        explanation: z.string().trim().min(1).max(2_000),
        severity: z.number().min(0).max(1),
        confidence: z.number().min(0).max(1),
      })
      .nullable()
      .default(null),
  });
  const reviewCopyInput = z.strictObject({
    analysisId: id,
    kind: z.enum(["confirm", "correct", "dismiss", "unconfirm"]),
    expectedRevision: z.number().int().positive(),
    regions: z.array(reviewedRegion).max(250).default([]),
  });
  const reviewCopy = mediaMutationDescriptor({
    id: "learning.copy.review_analysis",
    title: "Review grade-copy analysis",
    description:
      "Confirm, correct, dismiss, or undo a copy proposal behind a revision fence. Confirmation appends user-reviewed evidence.",
    scope: "avermate:learning.write",
    effect: "update",
    risk: "high",
    approval: "always",
    inputSchema: reviewCopyInput,
    preview: (value) => ({
      consequence: `${value.kind} the exact copy-analysis revision`,
      analysisId: value.analysisId,
      expectedRevision: value.expectedRevision,
      regionCount: value.regions.length,
      changesGrade: false,
    }),
    actionScope: (value) => ({
      kind: "learning-copy-analysis",
      id: value.analysisId,
    }),
    execute: (context, value) =>
      api.learning.copies.review({
        ...value,
        idempotencyKey: context.actionReference!,
      }),
    resources: (value, output) => [
      {
        resourceKind: "learning-copy-analysis",
        resourceId: value.analysisId,
        operation: "update",
        beforeRevision: String(value.expectedRevision),
        afterRevision: String((output as Record<string, unknown>).revision),
      },
    ],
  });
  const evidenceInput = z.strictObject({
    evidenceId: id,
    state: z.enum(["included", "excluded"]),
    reason: z.string().trim().max(1_000).nullable().default(null),
  });
  const decideEvidence = mediaMutationDescriptor({
    id: "learning.evidence.decide",
    title: "Include or exclude learning evidence",
    description:
      "Append an inclusion decision for one owned immutable evidence row and recompute its explainable projection.",
    scope: "avermate:learning.write",
    effect: "update",
    risk: "medium",
    approval: "policy",
    inputSchema: evidenceInput,
    preview: (value) => ({
      consequence: `${value.state} evidence in future mastery projections`,
      ...value,
      immutableObservationPreserved: true,
    }),
    actionScope: (value) => ({
      kind: "learning-evidence",
      id: value.evidenceId,
    }),
    execute: (context, value) =>
      api.learning.evidence.decide({
        ...value,
        idempotencyKey: context.actionReference!,
      }),
    resources: (value, output) => {
      const result = output as Record<string, unknown>;
      const decision = result.decision as Record<string, unknown> | undefined;
      const previous = result.previousDecision as
        Record<string, unknown> | undefined;
      if (!decision || typeof decision.id !== "string") {
        throw new Error("The evidence decision revision is missing");
      }
      return [
        {
          resourceKind: "learning-evidence",
          resourceId: value.evidenceId,
          operation: "update",
          beforeRevision:
            typeof previous?.id === "string"
              ? previous.id
              : "implicit-included",
          afterRevision: decision.id,
          beforeSnapshot: {
            state: previous?.state === "excluded" ? "excluded" : "included",
            reason:
              typeof previous?.reason === "string" ? previous.reason : null,
          },
          afterSnapshot: {
            state: decision.state,
            reason:
              typeof decision.reason === "string" ? decision.reason : null,
          },
        },
      ];
    },
  });
  const proposeInput = z.strictObject({
    yearId: id,
    subjectId: id.nullable().optional(),
    limit: z.number().int().min(1).max(20).default(5),
    availableMinutes: z.number().int().min(5).max(240).default(30),
  });
  const proposePlan = mediaMutationDescriptor({
    id: "learning.plan.propose",
    title: "Propose a learning plan",
    description:
      "Create bounded recommendations from current low or uncertain mastery; this does not schedule a second agenda.",
    scope: "avermate:learning.write",
    effect: "create",
    risk: "medium",
    approval: "policy",
    inputSchema: proposeInput,
    preview: (value) => ({
      consequence: "Create reviewable learning-plan proposals",
      ...value,
      createsPlanningTasks: false,
    }),
    actionScope: (value) => ({ kind: "academic-year", id: value.yearId }),
    execute: (_context, value) => api.learning.plan.propose(value),
    resources: (_value, output) =>
      (Array.isArray(output) ? output : []).map((row) => ({
        resourceKind: "learning-plan-item",
        resourceId: String((row as Record<string, unknown>).id),
        operation: "create" as const,
        beforeRevision: null,
        afterRevision: String((row as Record<string, unknown>).revision ?? 1),
      })),
  });
  const applyInput = z.strictObject({
    itemId: id,
    expectedRevision: z.number().int().positive(),
    scheduledAt: isoDate.nullable().default(null),
    dueAt: isoDate.nullable().default(null),
  });
  const applyPlan = mediaMutationDescriptor({
    id: "learning.plan.apply",
    title: "Apply a learning-plan item",
    description:
      "Create the authoritative personal planning task for one reviewed recommendation.",
    scope: "avermate:learning.write",
    effect: "create",
    risk: "medium",
    approval: "always",
    inputSchema: applyInput,
    preview: (value) => ({
      consequence: "Create one recoverable personal planning task",
      ...value,
    }),
    actionScope: (value) => ({ kind: "learning-plan-item", id: value.itemId }),
    execute: (_context, value) =>
      api.learning.plan.apply({
        itemId: value.itemId,
        expectedRevision: value.expectedRevision,
        scheduledAt: value.scheduledAt ? new Date(value.scheduledAt) : null,
        dueAt: value.dueAt ? new Date(value.dueAt) : null,
      }),
    resources: (value, output) => [
      {
        resourceKind: "learning-plan-item",
        resourceId: value.itemId,
        operation: "update",
        beforeRevision: null,
        afterRevision: String((output as Record<string, unknown>).revision),
      },
      {
        resourceKind: "planning-task",
        resourceId: String((output as Record<string, unknown>).planningTaskId),
        operation: "create",
        beforeRevision: null,
        afterRevision: "1",
      },
    ],
  });
  const startQuizInput = z.strictObject({
    documentId: id,
    mode: z.enum(["practice", "progress"]).default("practice"),
  });
  const startQuiz = mediaMutationDescriptor({
    id: "learning.quiz.start",
    title: "Start a learning quiz",
    description:
      "Start an owned quiz in practice or progress mode. Starting never creates mastery evidence.",
    scope: "avermate:learning.write",
    effect: "create",
    risk: "medium",
    approval: "policy",
    inputSchema: startQuizInput,
    preview: (value) => ({
      consequence: `Start a ${value.mode} quiz attempt`,
      ...value,
      createsEvidenceOnStart: false,
    }),
    actionScope: (value) => ({ kind: "study-document", id: value.documentId }),
    execute: (_context, value) =>
      api.documents.quiz.start({ ...value, latencyConsent: false }),
    resources: (_value, output) => [
      {
        resourceKind: "quiz-attempt",
        resourceId: String((output as Record<string, unknown>).id),
        operation: "create",
        beforeRevision: null,
        afterRevision: "1",
      },
    ],
  });
  const generateQuizInput = z.strictObject({
    projectId: id.nullable().default(null),
    title: z.string().trim().min(1).max(160),
    objectiveIds: z.array(id).min(1).max(20),
    sourceVersionIds: z.array(id).min(1).max(500),
    questionCount: z.number().int().min(1).max(100).default(10),
    difficulty: z.number().min(0).max(1).nullable().default(null),
  });
  const generateQuiz = mediaMutationDescriptor({
    id: "learning.quiz.generate",
    title: "Generate a sourced learning quiz",
    description:
      "Plan a bounded quiz artifact from owned source versions and learning objectives. Draft questions must retain proof handles and be reviewed before they can affect mastery.",
    scope: "avermate:learning.write",
    effect: "create",
    risk: "medium",
    approval: "policy",
    inputSchema: generateQuizInput,
    preview: (value) => ({
      consequence: "Create a reviewable quiz artifact workflow",
      title: value.title,
      objectiveIds: value.objectiveIds,
      sourceVersionCount: value.sourceVersionIds.length,
      questionCount: value.questionCount,
      difficulty: value.difficulty,
      createsMasteryEvidence: false,
      requiresQuestionReview: true,
    }),
    actionScope: (value) => ({
      kind: value.projectId ? "study-project" : "learning-quiz",
      id: value.projectId ?? value.objectiveIds[0]!,
    }),
    execute: async (context, value) => {
      const ownerId = context.principal.userId;
      const objectives = await db
        .select({
          id: learningObjectives.id,
          yearId: learningObjectives.yearId,
          subjectId: learningObjectives.subjectId,
        })
        .from(learningObjectives)
        .where(
          and(
            eq(learningObjectives.userId, ownerId),
            inArray(learningObjectives.id, value.objectiveIds),
            isNull(learningObjectives.archivedAt),
          ),
        );
      if (objectives.length !== new Set(value.objectiveIds).size) {
        throw new Error("Every quiz objective must be active and owned");
      }
      const scopes = new Set(
        objectives.map(
          (objective) => `${objective.yearId}:${objective.subjectId ?? "none"}`,
        ),
      );
      if (scopes.size !== 1 || objectives.some((row) => !row.subjectId)) {
        throw new Error("A learning quiz must target one year and subject");
      }
      const placement = context.capabilities.placement("artifactGeneration");
      const planned = await coreArtifactGraphStore.plan({
        ownerId,
        projectId: value.projectId,
        kind: "quiz",
        title: value.title,
        sourceVersionIds: value.sourceVersionIds,
        parentArtifactRevisionIds: [],
        settings: {
          learningObjectiveIds: value.objectiveIds,
          questionCount: value.questionCount,
          difficulty: value.difficulty,
          questionValidationState: "draft",
          requireSourceProofs: true,
          requireHumanReviewForMastery: true,
        },
        placement,
        policyRef: "learning-quiz-generation-policy.v1",
        idempotencyKey: context.actionReference!,
        actionId: context.actionReference,
      });
      return artifactWorkflowDispatcher.dispatch({
        ownerId,
        runId: planned.id,
        artifactId: planned.artifactId,
        kind: "quiz",
        inputDigest: planned.inputDigest,
        sourceVersionIds: value.sourceVersionIds,
        parentArtifactRevisionIds: [],
        settings: {
          learningObjectiveIds: value.objectiveIds,
          questionCount: value.questionCount,
          difficulty: value.difficulty,
          questionValidationState: "draft",
          requireSourceProofs: true,
          requireHumanReviewForMastery: true,
        },
      });
    },
    resources: (_value, output) => {
      const result = output as Record<string, unknown>;
      return [
        {
          resourceKind: "generated-artifact",
          resourceId: String(result.artifactId),
          operation: "create",
          beforeRevision: null,
          afterRevision: "1",
        },
        {
          resourceKind: "artifact-workflow",
          resourceId: String(result.id),
          operation: "create",
          beforeRevision: null,
          afterRevision: String(result.inputDigest),
        },
      ];
    },
  });
  return [
    requestCopy,
    reviewCopy,
    decideEvidence,
    proposePlan,
    applyPlan,
    generateQuiz,
    startQuiz,
  ] as const;
}

const projectSourceKind = z.enum([
  "material",
  "study-document",
  "recording",
  "grade",
  "subject",
  "artifact",
]);
export type FirstPartyToolOptions = {
  fileHandles?: FileHandleService;
  ownerId?: string;
  includeMutations?: boolean;
  continuations?: ToolActionContinuationStore | null;
};

export function firstPartyToolDescriptors(
  api: Api,
  options: FirstPartyToolOptions = {},
) {
  return [
    readDescriptor({
      api,
      id: "account.get",
      title: "Read account profile",
      description:
        "Read the authenticated user's public profile fields without credentials or authentication secrets.",
      scope: "avermate:read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.profile.viewer(),
    }),
    readDescriptor({
      api,
      id: "years.list",
      title: "List academic years",
      description: "List all academic years owned by the user.",
      scope: "avermate:read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.years.list(),
    }),
    readDescriptor({
      api,
      id: "years.get",
      title: "Read an academic year",
      description: "Read one academic year.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ yearId: id }),
      execute: (client, input) => client.years.get(input),
    }),
    readDescriptor({
      api,
      id: "years.contents",
      title: "Inspect academic year contents",
      description:
        "Read bounded counts of subjects, grades and periods affected by deleting an owned academic year.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ yearId: id }),
      execute: (client, input) => client.years.contents(input),
    }),
    readDescriptor({
      api,
      id: "periods.list",
      title: "List periods",
      description: "List a year's periods.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ yearId: id }),
      execute: (client, input) => client.periods.list(input),
    }),
    readDescriptor({
      api,
      id: "subjects.list",
      title: "List subjects",
      description: "List a year's subject/category hierarchy.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ yearId: id }),
      execute: (client, input) => client.subjects.list(input),
    }),
    readDescriptor({
      api,
      id: "subjects.get",
      title: "Read subject",
      description: "Read one owned subject or category.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ subjectId: id }),
      execute: (client, input) => client.subjects.get(input),
    }),
    readDescriptor({
      api,
      id: "subjects.delete_impact",
      title: "Inspect subject deletion impact",
      description:
        "Read counts of descendants, grades and widgets affected by deleting an owned subject.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ subjectId: id }),
      execute: (client, input) => client.subjects.impact(input),
    }),
    readDescriptor({
      api,
      id: "grades.get",
      title: "Read grade",
      description: "Read one owned grade and its bounded component metadata.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ gradeId: id }),
      execute: (client, input) => client.grades.get(input),
    }),
    readDescriptor({
      api,
      id: "grades.attachments",
      title: "List grade copy attachments",
      description:
        "List owned copy metadata. Provider URLs are removed and file bytes require an opaque owner-bound handle exchange.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ gradeId: id }),
      execute: async (client, input) => {
        const rows = await client.grades.attachments(input);
        return Promise.all(
          rows.map(async (row) => {
            const { url: _url, ...file } = row.file;
            if (!options.fileHandles || !options.ownerId) {
              return { ...row, file };
            }
            const [preview, download] = await Promise.all([
              options.fileHandles.mint({
                fileId: file.id,
                userId: options.ownerId,
                audience: "preview",
                mimeType: file.mimeType,
                byteSize: file.byteSize,
              }),
              options.fileHandles.mint({
                fileId: file.id,
                userId: options.ownerId,
                audience: "download",
                mimeType: file.mimeType,
                byteSize: file.byteSize,
              }),
            ]);
            return {
              ...row,
              file: { ...file, handles: { preview, download } },
            };
          }),
        );
      },
    }),
    readDescriptor({
      api,
      id: "grades.recent",
      title: "Read recent grades",
      description: "Read recent grades in a year.",
      scope: "avermate:read",
      inputSchema: z.strictObject({
        yearId: id,
        limit: z.number().int().min(1).max(50).default(10),
      }),
      execute: (client, input) => client.grades.recent(input),
    }),
    readDescriptor({
      api,
      id: "averages.list",
      title: "List custom averages",
      description:
        "List custom averages and their owned subject entries for one academic year.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ yearId: id }),
      execute: (client, input) => client.averages.list(input),
    }),
    readDescriptor({
      api,
      id: "averages.get",
      title: "Read custom average",
      description: "Read one owned custom average and its subject entries.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ averageId: id }),
      execute: (client, input) => client.averages.get(input),
    }),
    readDescriptor({
      api,
      id: "goals.list",
      title: "List academic goals",
      description: "List owned academic goals for one year.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ yearId: id }),
      execute: (client, input) => client.goals.list(input),
    }),
    readDescriptor({
      api,
      id: "cards.list",
      title: "List dashboard cards",
      description:
        "List owned dashboard cards for one year and a bounded application surface.",
      scope: "avermate:read",
      inputSchema: z.strictObject({
        yearId: id,
        surface: cardSurfaceSchema.default("overview"),
      }),
      execute: (client, input) => client.cards.list(input),
    }),
    readDescriptor({
      api,
      id: "preferences.get",
      title: "Read preferences",
      description:
        "Read application, theme and chart preferences without account export data.",
      scope: "avermate:read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.preferences.get(),
    }),
    readDescriptor({
      api,
      id: "announcements.active",
      title: "List active announcements",
      description:
        "Read active authorized announcements, optionally scoped to an owned academic year.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ yearId: id.optional() }),
      execute: (client, input) => client.announcements.active(input),
    }),
    readDescriptor({
      api,
      id: "announcements.history",
      title: "List announcement history",
      description:
        "Read authorized announcement history, optionally scoped to an owned academic year.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ yearId: id.optional() }),
      execute: (client, input) => client.announcements.history(input),
    }),
    readDescriptor({
      api,
      id: "analytics.snapshot",
      title: "Read bounded academic snapshot",
      description:
        "Read a bounded academic overview. Grade notes, components and unbounded full-year payloads are excluded.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ yearId: id }),
      resultBudget: { maxBytes: 256 * 1024, maxDepth: 24, maxItems: 10_000 },
      execute: async (client, input) => {
        const snapshot = await client.snapshot.get(input);
        const grades = snapshot.subjects
          .flatMap((subject) =>
            subject.grades.map((grade) => ({
              id: grade.id,
              name: grade.name,
              value: grade.value,
              outOf: grade.outOf,
              coefficient: grade.coefficient,
              excludedFromAverage: grade.excludedFromAverage,
              syncExcludedFromAverage: grade.syncExcludedFromAverage,
              bonus: grade.bonus,
              isComposite: grade.isComposite,
              passedAt: grade.passedAt,
              createdAt: grade.createdAt,
              subjectId: grade.subjectId,
              periodId: grade.periodId,
              typeId: grade.typeId,
            })),
          )
          .sort(
            (left, right) =>
              new Date(String(right.passedAt)).getTime() -
              new Date(String(left.passedAt)).getTime(),
          );
        const maxGrades = 500;
        return {
          year: snapshot.year,
          subjects: snapshot.subjects.map(
            ({ grades: subjectGrades, ...subject }) => ({
              ...subject,
              gradeCount: subjectGrades.length,
            }),
          ),
          grades: grades.slice(0, maxGrades),
          gradesTruncated: grades.length > maxGrades,
          totalGradeCount: grades.length,
          periods: snapshot.periods,
          gradeTypes: snapshot.gradeTypes,
          customAverages: snapshot.customAverages,
          goals: snapshot.goals,
          cards: snapshot.cards,
        };
      },
    }),
    readDescriptor({
      api,
      id: "recap.status",
      title: "Read year recap status",
      description:
        "Read recap availability, activity percentile and seen state for one owned year.",
      scope: "avermate:read",
      inputSchema: z.strictObject({
        yearId: id,
        reviewKey: z.string().trim().min(1).max(128).default("annual"),
      }),
      execute: (client, input) => client.review.status(input),
    }),
    readDescriptor({
      api,
      id: "recap.eligible_years",
      title: "List recap-eligible years",
      description: "List owned academic years eligible for a recap.",
      scope: "avermate:read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.review.eligibleYears(),
    }),
    readDescriptor({
      api,
      id: "feedback.mine",
      title: "List submitted feedback",
      description: "Read feedback submitted by the authenticated user.",
      scope: "avermate:read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.feedback.mine(),
    }),
    readDescriptor({
      api,
      id: "actions.get",
      title: "Read agent action",
      description:
        "Inspect one owned durable agent action and its current undo state.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ actionId: id }),
      execute: (_client, input, context) =>
        actionLedgerService().get(context.principal.userId, input.actionId),
    }),
    readDescriptor({
      api,
      id: "actions.list",
      title: "List agent actions",
      description:
        "List owned durable agent actions through bounded activity filters.",
      scope: "avermate:read",
      inputSchema: z.strictObject({
        cursor: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(100).default(50),
        toolId: z.string().trim().min(1).max(256).optional(),
        threadId: id.optional(),
        resourceKind: z.string().trim().min(1).max(128).optional(),
        resourceId: id.optional(),
        status: z
          .enum([
            "reserved",
            "awaiting-approval",
            "executing",
            "rejected",
            "expired",
            "completed",
            "failed",
            "inspect-required",
          ])
          .optional(),
      }),
      execute: (_client, input, context) =>
        actionLedgerService().list(context.principal.userId, input),
    }),
    readDescriptor({
      api,
      id: "actions.undo_preview",
      title: "Preview action undo",
      description:
        "Compute the exact owned causal closure and reverse order without mutating any resource.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ actionIds: z.array(id).min(1).max(500) }),
      execute: (_client, input, context) =>
        actionLedgerService().previewUndo(
          context.principal.userId,
          input.actionIds,
        ),
    }),
    readDescriptor({
      api,
      id: "projects.list",
      title: "List study projects",
      description: "List owned study projects without moving their sources.",
      scope: "avermate:read",
      inputSchema: z.strictObject({
        include: z.enum(["live", "trashed", "all"]).default("live"),
        yearId: id.optional(),
      }),
      execute: (client, input) => client.projects.list(input),
    }),
    readDescriptor({
      api,
      id: "projects.get",
      title: "Read a study project",
      description:
        "Read one owned project, its instructions and its source references.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ projectId: id }),
      execute: (client, input) => client.projects.get(input),
    }),
    readDescriptor({
      api,
      id: "search.query",
      title: "Search the owned study corpus",
      description:
        "Run bounded lexical or configured hybrid retrieval and return exact citation IDs.",
      scope: "avermate:read",
      inputSchema: z.strictObject({
        query: z.string().trim().min(1).max(2_000),
        mode: z.enum(["terms", "phrase", "prefix", "exact"]).default("terms"),
        projectIds: z.array(id).max(100).default([]),
        yearIds: z.array(id).max(100).default([]),
        subjectIds: z.array(id).max(100).default([]),
        originKinds: z.array(projectSourceKind).max(16).default([]),
        limit: z.number().int().min(1).max(20).default(10),
        cursor: z.string().max(512).nullable().default(null),
      }),
      execute: (client, input) => client.projects.search(input),
    }),
    readDescriptor({
      api,
      id: "search.read_citation",
      title: "Read an exact corpus citation",
      description:
        "Resolve an owned immutable citation and return a bounded exact passage.",
      scope: "avermate:read",
      inputSchema: z.strictObject({
        citationId: id,
        maxChars: z.number().int().min(1).max(32_000).default(12_000),
      }),
      resultBudget: { maxBytes: 64 * 1_024, maxDepth: 24, maxItems: 2_000 },
      execute: async (client, input) => {
        const result = await client.projects.readCitation({
          citationId: input.citationId,
        });
        const text = result.text?.slice(0, input.maxChars) ?? null;
        return {
          ...result,
          text,
          truncated: Boolean(
            result.text && result.text.length > input.maxChars,
          ),
        };
      },
    }),
    readDescriptor({
      api,
      id: "search.index_status",
      title: "Read corpus index status",
      description:
        "Read truthful lexical coverage and indexing state for one owned source.",
      scope: "avermate:read",
      inputSchema: z.strictObject({
        kind: projectSourceKind,
        referenceId: id,
      }),
      execute: (client, input) => client.projects.indexStatus(input),
    }),
    readDescriptor({
      api,
      id: "conversation.search",
      title: "Search owned conversations",
      description:
        "Search the authenticated user's conversation corpus and return bounded, cursor-paginated matches.",
      scope: "avermate:read",
      inputSchema: z.strictObject({
        query: z.string().trim().min(1).max(2_000),
        mode: z.enum(["terms", "phrase", "prefix", "exact"]).default("terms"),
        limit: z.number().int().min(1).max(20).default(10),
        cursor: z.string().max(512).nullable().default(null),
      }),
      execute: (client, input) => client.assistant.conversations.search(input),
    }),
    readDescriptor({
      api,
      id: "jobs.get",
      title: "Read job status",
      description:
        "Read the safe status and result of one durable job owned by the connected user. Poll this after an asynchronous tool returns a jobId.",
      scope: "avermate:read",
      inputSchema: z.strictObject({ jobId: id }),
      execute: async (client, input) => {
        const job = await client.jobs.get(input);
        return {
          id: job.id,
          kind: job.kind,
          status: job.status,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          runAt: job.runAt,
          result: job.result,
          error: job.error,
          createdAt: job.createdAt,
          updatedAt: job.updatedAt,
        };
      },
    }),
    readDescriptor({
      api,
      id: "learning.concepts.get",
      title: "Read one learning concept",
      description:
        "Read one owned concept with its objectives, prerequisite edges and reviewed mapping history.",
      scope: "avermate:learning.read",
      inputSchema: z.strictObject({ conceptId: id }),
      execute: (client, input) => client.learning.concepts.get(input),
    }),
    readDescriptor({
      api,
      id: "learning.concepts.list",
      title: "List learning concepts",
      description: "List owned concepts and objectives for one academic scope.",
      scope: "avermate:learning.read",
      inputSchema: z.strictObject({
        yearId: id,
        subjectId: id.nullable().optional(),
      }),
      execute: (client, input) => client.learning.concepts.list(input),
    }),
    readDescriptor({
      api,
      id: "learning.evidence.get",
      title: "Read one learning evidence item",
      description:
        "Read one immutable owned observation with its exact source locator, latest decision and reviewed errors.",
      scope: "avermate:learning.read",
      inputSchema: z.strictObject({ evidenceId: id }),
      execute: (client, input) => client.learning.evidence.get(input),
    }),
    readDescriptor({
      api,
      id: "learning.evidence.list",
      title: "List objective evidence",
      description:
        "List immutable owned observations with their latest inclusion decision; never exposes copy bytes.",
      scope: "avermate:learning.read",
      inputSchema: z.strictObject({ objectiveId: id }),
      execute: (client, input) => client.learning.evidence.list(input),
    }),
    readDescriptor({
      api,
      id: "learning.mastery.get",
      title: "Read one mastery projection",
      description:
        "Read one current owned estimate with its objective, concept, interval and algorithm revision.",
      scope: "avermate:learning.read",
      inputSchema: z.strictObject({ objectiveId: id }),
      execute: (client, input) => client.learning.mastery.get(input),
    }),
    readDescriptor({
      api,
      id: "learning.mastery.list",
      title: "List mastery projections",
      description:
        "List current estimates, intervals, evidence counts and algorithm revisions for an owned academic scope.",
      scope: "avermate:learning.read",
      inputSchema: z.strictObject({
        yearId: id,
        subjectId: id.nullable().optional(),
      }),
      execute: (client, input) => client.learning.mastery.list(input),
    }),
    readDescriptor({
      api,
      id: "learning.mastery.explain",
      title: "Explain one mastery projection",
      description:
        "Read the versioned posterior and every included or omitted evidence contribution.",
      scope: "avermate:learning.read",
      inputSchema: z.strictObject({ objectiveId: id }),
      execute: (client, input) => client.learning.mastery.explain(input),
    }),
    readDescriptor({
      api,
      id: "learning.plan.list",
      title: "List learning-plan items",
      description:
        "List pedagogical recommendations and their authoritative planning-task links.",
      scope: "avermate:learning.read",
      inputSchema: z.strictObject({ yearId: id }),
      execute: (client, input) => client.learning.plan.list(input),
    }),
    readDescriptor({
      api,
      id: "documents.list",
      title: "List study documents",
      description:
        "List reader-safe owned study-document metadata for one year and optional folder.",
      scope: "avermate:documents.read",
      inputSchema: z.strictObject({
        yearId: id,
        folderId: id.nullable().optional(),
      }),
      execute: async (client, input) => {
        const rows = await client.documents.list(input);
        return rows.map(
          ({ bodyMarkdown: _body, metaJson: _meta, ...document }) => document,
        );
      },
    }),
    readDescriptor({
      api,
      id: "documents.get",
      title: "Read study document",
      description:
        "Read one owned reader-safe study document with bounded Markdown. Quiz corrections are never returned.",
      scope: "avermate:documents.read",
      inputSchema: z.strictObject({ documentId: id }),
      resultBudget: { maxBytes: 192 * 1024, maxDepth: 24, maxItems: 5_000 },
      execute: async (client, input) => {
        const result = await client.documents.get(input);
        const maxChars = 64_000;
        const body = result.document.bodyMarkdown;
        const rendered = result.renderedMarkdown;
        const encodedMeta = JSON.stringify(result.document.metaJson);
        const metaTruncated =
          typeof encodedMeta === "string" &&
          new TextEncoder().encode(encodedMeta).byteLength > 64 * 1024;
        return {
          ...result,
          document: {
            ...result.document,
            bodyMarkdown: body.slice(0, maxChars),
            bodyTruncated: body.length > maxChars,
            metaJson: metaTruncated ? null : result.document.metaJson,
            metaTruncated,
          },
          renderedMarkdown: rendered.slice(0, maxChars),
          renderedTruncated: rendered.length > maxChars,
        };
      },
    }),
    readDescriptor({
      api,
      id: "planner.list",
      title: "List planner items",
      description:
        "List planner tasks and events for a year, optionally within a date window.",
      scope: "avermate:planner.read",
      inputSchema: z.strictObject({
        yearId: id,
        from: isoDate.optional(),
        to: isoDate.optional(),
        includeCompleted: z.boolean().default(false),
      }),
      execute: (client, input) =>
        client.planner.list({
          ...input,
          from: input.from ? new Date(input.from) : undefined,
          to: input.to ? new Date(input.to) : undefined,
        }),
    }),
    readDescriptor({
      api,
      id: "planner.agenda",
      title: "Read agenda",
      description:
        "Read a bounded agenda combining planner items, goals, grades and academic periods.",
      scope: "avermate:planner.read",
      inputSchema: z.strictObject({ yearId: id, from: isoDate, to: isoDate }),
      execute: (client, input) =>
        client.planner.agenda({
          yearId: input.yearId,
          from: new Date(input.from),
          to: new Date(input.to),
        }),
    }),
    readDescriptor({
      api,
      id: "materials.folders.list",
      title: "List material folders",
      description: "List owned course-material folders for one academic year.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({ yearId: id }),
      execute: (client, input) => client.materials.folders.list(input),
    }),
    readDescriptor({
      api,
      id: "materials.documents.list",
      title: "List material documents",
      description:
        "List owned course-material metadata without file bytes or provider credentials.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({
        yearId: id,
        folderId: id.nullable().optional(),
      }),
      execute: (client, input) => client.materials.documents.list(input),
    }),
    readDescriptor({
      api,
      id: "materials.documents.get",
      title: "Read material metadata",
      description:
        "Read one owned course-material source and safe file metadata. File bytes require an opaque handle exchange.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({ documentId: id }),
      execute: async (client, input) => {
        const result = await client.materials.documents.get(input);
        const file = result?.file;
        if (
          !file ||
          !options.fileHandles ||
          !options.ownerId ||
          file.status !== "stored"
        ) {
          return result;
        }
        const [preview, download] = await Promise.all([
          options.fileHandles.mint({
            fileId: file.id,
            userId: options.ownerId,
            audience: "preview",
            mimeType: file.mimeType,
            byteSize: file.byteSize,
          }),
          options.fileHandles.mint({
            fileId: file.id,
            userId: options.ownerId,
            audience: "download",
            mimeType: file.mimeType,
            byteSize: file.byteSize,
          }),
        ]);
        return { ...result, file: { ...file, handles: { preview, download } } };
      },
    }),
    readDescriptor({
      api,
      id: "materials.documents.transcript",
      title: "Read a bounded material transcript",
      description:
        "Read bounded machine-readable transcript text and its processing status.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({
        documentId: id,
        maxChars: z.number().int().min(1).max(32_000).default(12_000),
      }),
      resultBudget: {
        maxBytes: 64 * 1024,
        maxDepth: 16,
        maxItems: 2_000,
      },
      execute: async (client, input) => {
        const transcript = await client.materials.documents.transcript({
          documentId: input.documentId,
        });
        const content = transcript.content ?? null;
        return {
          ...transcript,
          content: content?.slice(0, input.maxChars) ?? null,
          truncated: Boolean(content && content.length > input.maxChars),
        };
      },
    }),
    readDescriptor({
      api,
      id: "recordings.list",
      title: "List lecture recordings",
      description:
        "List owned lecture recordings, capture state and transcription status without credentials.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({ yearId: id }),
      execute: (client, input) => client.recordings.list(input),
    }),
    readDescriptor({
      api,
      id: "recordings.transcript",
      title: "Read lecture transcript",
      description:
        "Read one owned final lecture transcript without audio URLs, file internals or provider credentials.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({ recordingId: id }),
      resultBudget: { maxBytes: 128 * 1024, maxDepth: 20, maxItems: 4_000 },
      execute: async (client, input) => {
        const result = await client.recordings.get(input);
        const maxChars = 64_000;
        const text = result.transcript?.text ?? null;
        return {
          recording: result.recording,
          transcript: result.transcript
            ? {
                ...result.transcript,
                text: text?.slice(0, maxChars) ?? null,
                textTruncated: Boolean(text && text.length > maxChars),
              }
            : null,
        };
      },
    }),
    readDescriptor({
      api,
      id: "source.ingestion_status",
      title: "Read source ingestion revisions",
      description:
        "Read bounded immutable ingestion attempts, selected strategy, stable reason codes and durable job references for one owned material.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({ documentId: id }),
      execute: (client, input) => client.mediaStudio.ingestionRevisions(input),
    }),
    readDescriptor({
      api,
      id: "artifact.list",
      title: "List generated artifacts",
      description:
        "List owned artifact identities and exact promoted revision pointers without dereferencing mutable source pointers.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({
        projectId: id.nullable().default(null),
      }),
      execute: (client, input) => client.mediaStudio.listArtifacts(input),
    }),
    readDescriptor({
      api,
      id: "artifact.get_manifest",
      title: "Read an artifact revision manifest",
      description:
        "Read one immutable owned artifact revision manifest and its canonical digest.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({ artifactRevisionId: id }),
      execute: (client, input) => client.mediaStudio.getManifest(input),
    }),
    readDescriptor({
      api,
      id: "artifact.workflow",
      title: "Read artifact workflow progress",
      description:
        "Read durable stage state, progress, attempts, placement and stable failure reasons for one owned workflow.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({ runId: id }),
      execute: (client, input) => client.mediaStudio.getWorkflow(input),
    }),
    readDescriptor({
      api,
      id: "sync.status",
      title: "Read school synchronization status",
      description:
        "Read an owned school-provider connection and its latest safe synchronization status.",
      scope: "avermate:materials.read",
      inputSchema: z.strictObject({ connectionId: id }),
      execute: (client, input) => client.sync.status(input),
    }),
    readDescriptor({
      api,
      id: "social.sharing",
      title: "Read sharing settings",
      description:
        "Read the authenticated user's sharing locks and the exact friend-facing projection.",
      scope: "avermate:social.read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.social.sharing.get(),
    }),
    readDescriptor({
      api,
      id: "social.friends",
      title: "List friends",
      description: "List owned friendships and their bounded sharing summary.",
      scope: "avermate:social.read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.social.friends.list(),
    }),
    readDescriptor({
      api,
      id: "social.friend",
      title: "Read friend",
      description:
        "Read one owned friendship and the averages currently shared through it.",
      scope: "avermate:social.read",
      inputSchema: z.strictObject({ friendshipId: id }),
      execute: (client, input) => client.social.friends.detail(input),
    }),
    readDescriptor({
      api,
      id: "social.friend_requests",
      title: "List friend requests",
      description:
        "List the authenticated user's incoming and outgoing requests.",
      scope: "avermate:social.read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.social.friends.requests(),
    }),
    readDescriptor({
      api,
      id: "social.blocks",
      title: "List blocked accounts",
      description: "List accounts blocked by the authenticated user.",
      scope: "avermate:social.read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.social.blocks.list(),
    }),
    readDescriptor({
      api,
      id: "social.groups",
      title: "List social groups",
      description: "List the authenticated user's classes and groups.",
      scope: "avermate:social.read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.social.groups.list(),
    }),
    readDescriptor({
      api,
      id: "social.group",
      title: "Read social group",
      description:
        "Read one owned group membership with bounded member sharing data.",
      scope: "avermate:social.read",
      inputSchema: z.strictObject({ groupId: id }),
      execute: (client, input) => client.social.groups.get(input),
    }),
    readDescriptor({
      api,
      id: "social.notifications",
      title: "List social notifications",
      description: "Read privacy-safe social notifications.",
      scope: "avermate:social.read",
      inputSchema: z.strictObject({
        unreadOnly: z.boolean().default(false),
      }),
      execute: (client, input) => client.social.notifications.list(input),
    }),
    readDescriptor({
      api,
      id: "social.reports",
      title: "List submitted social reports",
      description:
        "Read moderation reports submitted by the authenticated user.",
      scope: "avermate:social.read",
      inputSchema: z.strictObject({}),
      execute: (client) => client.social.reports.mine(),
    }),
    ...learningMutationDescriptors(api),
    ...advancedMediaMutationDescriptors(),
    {
      id: "planning.tasks.create",
      version: 1,
      title: "Create a personal task",
      description:
        "Create one user-owned planning task. Provider-managed work is never changed.",
      inputSchema: taskCreateInputSchema,
      outputSchema: taskCreateOutputSchema,
      requiredScopes: ["avermate:planner.write"],
      effect: "create",
      risk: "medium",
      approval: "policy",
      idempotency: "required",
      preview: "required",
      compensation: "guaranteed",
      compensatorId: "planning.tasks.trash-created@1",
      crashRecovery: "idempotent-retry",
      inputBudget,
      resultBudget: readBudget,
      redact: (input: z.infer<typeof taskCreateInputSchema>) => ({
        yearId: input.yearId,
        title: input.title,
        notes: input.notes ? `[${input.notes.length} characters]` : null,
        localNote: input.localNote
          ? `[${input.localNote.length} characters]`
          : null,
        startsAt: input.startsAt,
        scheduledAt: input.scheduledAt,
        dueAt: input.dueAt,
        subjectId: input.subjectId,
      }),
      buildActionPreview: async (
        _context: Parameters<
          NonNullable<
            AvermateToolDescriptor<
              z.infer<typeof taskCreateInputSchema>,
              z.infer<typeof taskCreateOutputSchema>,
              unknown,
              unknown,
              unknown
            >["buildActionPreview"]
          >
        >[0],
        input: z.infer<typeof taskCreateInputSchema>,
      ) => {
        const year = await api.years.get({ yearId: input.yearId });
        if (input.subjectId) {
          const subject = await api.subjects.get({
            subjectId: input.subjectId,
          });
          if (subject.yearId !== input.yearId) {
            throw new Error("The task subject belongs to another year");
          }
        }
        return {
          title: "Create a personal planning task",
          consequence: "One recoverable task will be added",
          year: { id: year.id, name: year.name },
          task: {
            title: input.title,
            subjectId: input.subjectId,
            scheduledAt: input.scheduledAt,
            dueAt: input.dueAt,
          },
          undo: "guaranteed-while-unchanged",
        };
      },
      actionScope: (input: z.infer<typeof taskCreateInputSchema>) => ({
        kind: "academic-year",
        id: input.yearId,
      }),
      execute: async (
        context: Parameters<
          AvermateToolDescriptor<
            z.infer<typeof taskCreateInputSchema>,
            z.infer<typeof taskCreateOutputSchema>,
            unknown,
            unknown,
            unknown
          >["execute"]
        >[0],
        input: z.infer<typeof taskCreateInputSchema>,
      ) => {
        if (!context.actionReference) {
          throw new Error("A durable action reservation is required");
        }
        const digest = await actionHash({ actionId: context.actionReference });
        const task = await createPersonalTaskCommand(db.$client, {
          resourceId: `ptask_${digest.slice(0, 32)}`,
          userId: context.principal.userId,
          yearId: input.yearId,
          title: input.title,
          notes: input.notes,
          localNote: input.localNote,
          startsAt: input.startsAt ? new Date(input.startsAt) : null,
          scheduledAt: input.scheduledAt ? new Date(input.scheduledAt) : null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          subjectId: input.subjectId,
        });
        return {
          id: task.id,
          title: task.title,
          yearId: task.yearId,
          subjectId: task.subjectId,
          status: task.status,
          revision: task.revision,
          scheduledAt: task.scheduledAt?.toISOString() ?? null,
          dueAt: task.dueAt?.toISOString() ?? null,
          trashedAt: task.trashedAt?.toISOString() ?? null,
        };
      },
      actionResources: (
        input: z.infer<typeof taskCreateInputSchema>,
        output: z.infer<typeof taskCreateOutputSchema>,
      ) => [
        {
          resourceKind: "planning-task",
          resourceId: output.id,
          operation: "create" as const,
          beforeRevision: null,
          afterRevision: String(output.revision),
          afterSnapshot: {
            title: output.title,
            yearId: input.yearId,
            subjectId: output.subjectId,
            scheduledAt: output.scheduledAt,
            dueAt: output.dueAt,
          },
        },
      ],
      resultProjections: {
        model: {
          schema: taskCreateOutputSchema,
          budget: modelBudget,
          project: (output: z.infer<typeof taskCreateOutputSchema>) => output,
        },
        ui: {
          schema: taskCreateOutputSchema,
          budget: readBudget,
          project: (output: z.infer<typeof taskCreateOutputSchema>) => output,
        },
        audit: {
          schema: taskCreateAuditSchema,
          budget: auditBudget,
          project: (output: z.infer<typeof taskCreateOutputSchema>) => ({
            outcome: "created" as const,
            resourceKind: "planning-task" as const,
            resourceId: output.id,
            afterRevision: personalTaskRevision(output),
          }),
        },
      },
    } satisfies AvermateToolDescriptor<
      z.infer<typeof taskCreateInputSchema>,
      z.infer<typeof taskCreateOutputSchema>,
      z.infer<typeof taskCreateOutputSchema>,
      z.infer<typeof taskCreateOutputSchema>,
      z.infer<typeof taskCreateAuditSchema>
    >,
  ] as const;
}

export function createFirstPartyToolBroker(
  api: Api,
  options: FirstPartyToolOptions = {},
): ToolBroker {
  if (
    options.includeMutations === true &&
    options.continuations === undefined
  ) {
    throw new Error(
      "Mutation brokers require an explicit private action continuation store",
    );
  }
  const registry = new ToolRegistry();
  for (const descriptor of firstPartyToolDescriptors(api, options)) {
    if (options.includeMutations !== true && descriptor.effect !== "read") {
      continue;
    }
    registry.register(descriptor as unknown as AnyAvermateToolDescriptor);
  }
  return new ToolBroker(
    registry,
    undefined,
    undefined,
    options.includeMutations === true ? (options.continuations ?? null) : null,
  );
}
