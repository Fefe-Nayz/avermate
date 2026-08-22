import { z } from "zod";

export const AGENT_ACTION_CONTRACT_VERSION = 1 as const;

export const agentActionActorKindSchema = z.enum([
  "embedded-agent",
  "mcp",
  "user-undo",
  "system",
]);
export type AgentActionActorKind = z.infer<typeof agentActionActorKindSchema>;

export const agentActionStatusSchema = z.enum([
  "reserved",
  "awaiting-approval",
  "executing",
  "rejected",
  "expired",
  "completed",
  "failed",
  "inspect-required",
]);
export type AgentActionStatus = z.infer<typeof agentActionStatusSchema>;

export const agentActionEffectSchema = z.enum([
  "read",
  "create",
  "update",
  "delete",
  "external",
]);
export const agentActionRiskSchema = z.enum([
  "low",
  "medium",
  "high",
  "irreversible",
]);

export const agentActionResourceOperationSchema = z.enum([
  "create",
  "update",
  "trash",
  "restore",
  "delete",
  "attach",
  "detach",
  "external",
]);
export type AgentActionResourceOperation = z.infer<
  typeof agentActionResourceOperationSchema
>;

export const agentActionUndoStateSchema = z.enum([
  "not-applicable",
  "ineligible",
  "eligible",
  "approval-pending",
  "in-progress",
  "compensated",
  "partially-compensated",
  "conflicted",
  "failed",
  "blocked",
]);
export type AgentActionUndoState = z.infer<typeof agentActionUndoStateSchema>;

export const agentApprovalStateSchema = z.enum([
  "pending",
  "approved",
  "rejected",
  "expired",
]);
export type AgentApprovalState = z.infer<typeof agentApprovalStateSchema>;

export const agentActionDependencyScopeSchema = z.enum(["branch", "domain"]);
export const agentActionDependencyRelationSchema = z.enum([
  "resource",
  "explicit",
  "saga",
]);

const opaqueId = z.string().min(1).max(256);
const hash = z.string().regex(/^[a-f0-9]{64}$/);
const instant = z.iso.datetime({ offset: true });

export const agentActionResourceSchema = z.strictObject({
  actionId: opaqueId,
  resourceKind: z.string().min(1).max(128),
  resourceId: opaqueId,
  operation: agentActionResourceOperationSchema,
  beforeRevision: z.string().min(1).max(256).nullable(),
  afterRevision: z.string().min(1).max(256).nullable(),
  beforeSnapshot: z.unknown().nullable(),
  afterSnapshot: z.unknown().nullable(),
  contentRefBefore: z.string().min(1).max(512).nullable(),
  contentRefAfter: z.string().min(1).max(512).nullable(),
});
export type AgentActionResource = z.infer<typeof agentActionResourceSchema>;

export const agentApprovalSchema = z.strictObject({
  id: opaqueId,
  actionId: opaqueId,
  state: agentApprovalStateSchema,
  argumentsHash: hash,
  previewHash: hash,
  expiresAt: instant,
  resolvedAt: instant.nullable(),
});
export type AgentApproval = z.infer<typeof agentApprovalSchema>;

export const agentActionRecordSchema = z.strictObject({
  contractVersion: z.literal(AGENT_ACTION_CONTRACT_VERSION),
  id: opaqueId,
  batchId: opaqueId.nullable(),
  userId: opaqueId,
  actorKind: agentActionActorKindSchema,
  actorClientId: opaqueId.nullable(),
  threadId: opaqueId.nullable(),
  branchId: opaqueId.nullable(),
  runId: opaqueId.nullable(),
  toolCallId: opaqueId.nullable(),
  domainScopeKind: z.string().min(1).max(128).nullable(),
  domainScopeId: opaqueId.nullable(),
  toolId: z.string().min(1).max(256),
  toolVersion: z.number().int().positive(),
  effect: agentActionEffectSchema,
  risk: agentActionRiskSchema,
  argumentsHash: hash,
  idempotencyKey: z.string().min(1).max(256),
  actionSequence: z.number().int().positive(),
  redactedInput: z.unknown(),
  preview: z.unknown().nullable(),
  previewHash: hash,
  status: agentActionStatusSchema,
  resultSummary: z.unknown().nullable(),
  safeError: z.string().max(1_000).nullable(),
  compensatorId: z.string().min(1).max(256).nullable(),
  compensationOfActionId: opaqueId.nullable(),
  startedAt: instant.nullable(),
  completedAt: instant.nullable(),
  createdAt: instant,
});
export type AgentActionRecord = z.infer<typeof agentActionRecordSchema>;

export const agentActionDtoSchema = agentActionRecordSchema.extend({
  resources: z.array(agentActionResourceSchema).max(500),
  approval: agentApprovalSchema.nullable(),
  undoState: agentActionUndoStateSchema,
  activeCompensationActionId: opaqueId.nullable(),
  compensationActionIds: z.array(opaqueId).max(100),
  undoReasonCode: z.string().min(1).max(128).nullable(),
});
export type AgentActionDto = z.infer<typeof agentActionDtoSchema>;

export const agentActionDependencySchema = z.strictObject({
  actionId: opaqueId,
  dependsOnActionId: opaqueId,
  scopeKind: agentActionDependencyScopeSchema,
  scopeId: opaqueId,
  relation: agentActionDependencyRelationSchema,
  fenceVersion: z.number().int().nonnegative(),
  createdAt: instant,
});
export type AgentActionDependency = z.infer<typeof agentActionDependencySchema>;

export const agentActionBatchStatusSchema = z.enum([
  "open",
  "completed",
  "failed",
]);
export const agentActionBatchSchema = z.strictObject({
  id: opaqueId,
  userId: opaqueId,
  threadId: opaqueId.nullable(),
  branchId: opaqueId.nullable(),
  runId: opaqueId.nullable(),
  label: z.string().max(256).nullable(),
  status: agentActionBatchStatusSchema,
  domainCursorBeforeRef: z.string().min(1).max(512),
  domainCursorAfterRef: z.string().min(1).max(512).nullable(),
  createdAt: instant,
  completedAt: instant.nullable(),
});
export type AgentActionBatch = z.infer<typeof agentActionBatchSchema>;

export const agentActionReservationSchema = z.discriminatedUnion("state", [
  z.strictObject({
    state: z.literal("ready"),
    actionId: opaqueId,
    replayed: z.boolean(),
  }),
  z.strictObject({
    state: z.literal("awaiting-approval"),
    actionId: opaqueId,
    approvalId: opaqueId,
    previewHash: hash,
    expiresAt: instant,
  }),
  z.strictObject({
    state: z.literal("completed"),
    actionId: opaqueId,
    modelProjection: z.unknown(),
    uiProjection: z.unknown(),
    auditProjection: z.unknown(),
  }),
  z.strictObject({
    state: z.literal("terminal"),
    actionId: opaqueId,
    status: z.enum(["rejected", "expired", "failed", "inspect-required"]),
    safeError: z.string().max(1_000).nullable(),
  }),
]);
export type AgentActionReservation = z.infer<
  typeof agentActionReservationSchema
>;

export const agentActionPreviewSchema = z.strictObject({
  actionIds: z.array(opaqueId).min(1).max(500),
  reverseTopologicalOrder: z.array(opaqueId).min(1).max(500),
  dependencyFenceVersion: z.number().int().nonnegative(),
  previewHash: hash,
  eligible: z.array(opaqueId).max(500),
  conflicted: z.array(opaqueId).max(500),
  nonUndoable: z.array(opaqueId).max(500),
  blocked: z.array(opaqueId).max(500),
});
export type AgentActionPreview = z.infer<typeof agentActionPreviewSchema>;

export const agentActionCompensationOutcomeSchema = z.strictObject({
  sourceActionId: opaqueId,
  compensationActionId: opaqueId.nullable(),
  state: z.enum([
    "compensated",
    "conflicted",
    "failed",
    "blocked",
    "not-attempted",
  ]),
  reasonCode: z.string().min(1).max(128).nullable(),
});
export type AgentActionCompensationOutcome = z.infer<
  typeof agentActionCompensationOutcomeSchema
>;

export const agentActionBatchCompensationResultSchema = z.strictObject({
  complete: z.boolean(),
  partial: z.boolean(),
  outcomes: z.array(agentActionCompensationOutcomeSchema).max(500),
});
export type AgentActionBatchCompensationResult = z.infer<
  typeof agentActionBatchCompensationResultSchema
>;

export const agentActionActivityFilterSchema = z.strictObject({
  cursor: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(100).default(50),
  from: instant.optional(),
  to: instant.optional(),
  toolId: z.string().min(1).max(256).optional(),
  threadId: opaqueId.optional(),
  resourceKind: z.string().min(1).max(128).optional(),
  resourceId: opaqueId.optional(),
  actorKind: agentActionActorKindSchema.optional(),
  status: agentActionStatusSchema.optional(),
  undoState: agentActionUndoStateSchema.optional(),
});
export type AgentActionActivityFilter = z.infer<
  typeof agentActionActivityFilterSchema
>;

export const agentActionTaskCreateInputSchema = z.strictObject({
  yearId: opaqueId,
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(10_000).nullable().default(null),
  localNote: z.string().trim().max(4_000).nullable().default(null),
  startsAt: instant.nullable().default(null),
  scheduledAt: instant.nullable().default(null),
  dueAt: instant.nullable().default(null),
  subjectId: opaqueId.nullable().default(null),
});
export type AgentActionTaskCreateInput = z.infer<
  typeof agentActionTaskCreateInputSchema
>;

export const agentActionTaskCreateRequestSchema =
  agentActionTaskCreateInputSchema.extend({
    idempotencyKey: z.string().trim().min(1).max(256),
  });

export const agentActionApprovalResolutionInputSchema = z.strictObject({
  actionId: opaqueId,
  approvalId: opaqueId,
  previewHash: hash,
  decision: z.enum(["approve", "reject"]),
});

export const agentActionDependencyInputSchema = z.strictObject({
  actionId: opaqueId,
  dependsOnActionId: opaqueId,
  scopeKind: agentActionDependencyScopeSchema,
  scopeId: opaqueId,
  relation: agentActionDependencyRelationSchema,
  expectedFenceVersion: z.number().int().nonnegative(),
});

export const agentActionEventSchema = z.strictObject({
  id: opaqueId,
  actionId: opaqueId,
  sequence: z.number().int().positive(),
  type: z.string().min(1).max(128),
  payload: z.unknown(),
  createdAt: instant,
});
export type AgentActionEvent = z.infer<typeof agentActionEventSchema>;
