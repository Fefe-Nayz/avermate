import { z } from "zod";

import { agentActionDtoSchema, agentActionPreviewSchema } from "./action";
import { conversationPlacementSchema } from "./conversation-store";
import { contentVersionReferenceSchema, sourceLocatorV1Schema } from "./corpus";
import {
  conversationCheckpointRefSchema,
  domainCursorRefSchema,
  sandboxRuntimeCheckpointRefSchema,
  workspaceSnapshotRefSchema,
} from "./references";
import { modelPlacementSchema } from "./runtime";
import { sandboxProfileIdSchema, sandboxProviderIdSchema } from "./sandbox";

export const ASSISTANT_EXPORT_VERSION = 1 as const;
export const ASSISTANT_PARTS_VERSION = 1 as const;
export const CONTEXT_MANIFEST_VERSION = 1 as const;

const opaqueId = z.string().min(1).max(256);
const boundedLabel = z.string().trim().min(1).max(256);
const timestamp = z.iso.datetime({ offset: true });

export const assistantRoleSchema = z.enum([
  "user",
  "assistant",
  "system",
  "tool",
]);
export type AssistantRole = z.infer<typeof assistantRoleSchema>;

export const assistantAuthorshipSchema = z.enum([
  "user",
  "model",
  "user-edited-model",
  "application",
]);
export type AssistantAuthorship = z.infer<typeof assistantAuthorshipSchema>;

export const assistantMessageStatusSchema = z.enum([
  "pending",
  "streaming",
  "complete",
  "failed",
  "cancelled",
]);
export type AssistantMessageStatus = z.infer<
  typeof assistantMessageStatusSchema
>;

const textPartSchema = z.strictObject({
  type: z.literal("text"),
  id: opaqueId,
  markdown: z.string().max(2_000_000),
});

const statusPartSchema = z.strictObject({
  type: z.literal("status"),
  id: opaqueId,
  state: z.enum(["pending", "active", "complete", "failed", "cancelled"]),
  label: boundedLabel,
  detail: z.string().max(2_000).optional(),
});

const planPartSchema = z.strictObject({
  type: z.literal("plan"),
  id: opaqueId,
  title: boundedLabel.optional(),
  items: z
    .array(
      z.strictObject({
        id: opaqueId,
        label: boundedLabel,
        status: z.enum(["pending", "active", "complete", "cancelled"]),
      }),
    )
    .max(100),
});

const toolPartSchema = z.strictObject({
  type: z.literal("tool"),
  id: opaqueId,
  toolCallId: opaqueId,
  toolId: opaqueId,
  state: z.enum([
    "proposed",
    "running",
    "complete",
    "failed",
    "cancelled",
    "unavailable",
  ]),
  safeInput: z.unknown().optional(),
  safeResult: z.unknown().optional(),
  safeError: z.string().max(2_000).optional(),
  /** Authoritative plan-030 ledger references; never client-generated. */
  actionId: opaqueId.optional(),
  approvalId: opaqueId.optional(),
  compensationState: z
    .enum(["available", "compensating", "compensated", "blocked", "failed"])
    .optional(),
});

const citationPartSchema = z.strictObject({
  type: z.literal("citation"),
  id: opaqueId,
  citationId: opaqueId,
  ordinal: z.number().int().nonnegative(),
  claimPartId: opaqueId.optional(),
});

const questionPartSchema = z.strictObject({
  type: z.literal("question"),
  id: opaqueId,
  questionId: opaqueId,
  prompt: z.string().min(1).max(4_000),
  options: z
    .array(
      z.strictObject({
        id: opaqueId,
        label: boundedLabel,
        detail: z.string().max(1_000).optional(),
      }),
    )
    .min(1)
    .max(20)
    .optional(),
  allowFreeText: z.boolean().default(true),
  state: z.enum(["pending", "answered", "expired"]),
});

const usagePartSchema = z.strictObject({
  type: z.literal("usage"),
  id: opaqueId,
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  cachedReadTokens: z.number().int().nonnegative().nullable(),
  cachedWriteTokens: z.number().int().nonnegative().nullable(),
  estimatedCost: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .nullable(),
  currency: z.string().length(3).nullable(),
});

const artifactPartSchema = z.strictObject({
  type: z.literal("artifact"),
  id: opaqueId,
  artifactId: opaqueId,
  artifactRevisionId: opaqueId.optional(),
  label: boundedLabel,
  state: z.enum(["proposed", "ready", "failed"]),
});

const safeErrorPartSchema = z.strictObject({
  type: z.literal("safe-error"),
  id: opaqueId,
  code: z.string().min(1).max(128),
  message: z.string().min(1).max(2_000),
  retryable: z.boolean(),
});

const runConfigPartSchema = z.strictObject({
  type: z.literal("run-config"),
  id: opaqueId,
  skillId: opaqueId.nullable(),
  planMode: z.boolean(),
});

/**
 * Core-side opaque envelope for a Node-owned message body. It is never a
 * renderable part and must be resolved through the selected Node placement.
 */
const nodeSealedPartSchema = z.strictObject({
  type: z.literal("node-sealed"),
  id: opaqueId,
  algorithm: z.literal("aes-256-gcm-v1"),
  ciphertext: z.string().min(32).max(16_000_000),
});

/** Closed registry: model output cannot name an arbitrary component or HTML. */
export const assistantPartV1Schema = z.discriminatedUnion("type", [
  textPartSchema,
  statusPartSchema,
  planPartSchema,
  toolPartSchema,
  citationPartSchema,
  questionPartSchema,
  usagePartSchema,
  artifactPartSchema,
  safeErrorPartSchema,
  runConfigPartSchema,
  nodeSealedPartSchema,
]);
export type AssistantPartV1 = z.infer<typeof assistantPartV1Schema>;

export const assistantMessageSchema = z.strictObject({
  id: opaqueId,
  threadId: opaqueId,
  parentMessageId: opaqueId.nullable(),
  role: assistantRoleSchema,
  authorship: assistantAuthorshipSchema,
  status: assistantMessageStatusSchema,
  partsVersion: z.literal(ASSISTANT_PARTS_VERSION),
  parts: z.array(assistantPartV1Schema).max(1_000),
  createdByRunId: opaqueId.nullable(),
  replacesMessageId: opaqueId.nullable(),
  createdAt: timestamp,
});
export type AssistantMessage = z.infer<typeof assistantMessageSchema>;

export const assistantBranchSchema = z.strictObject({
  id: opaqueId,
  threadId: opaqueId,
  name: boundedLabel.nullable(),
  forkedFromMessageId: opaqueId.nullable(),
  headMessageId: opaqueId.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type AssistantBranch = z.infer<typeof assistantBranchSchema>;

export const assistantThreadSchema = z.strictObject({
  id: opaqueId,
  userId: opaqueId,
  title: boundedLabel,
  activeBranchId: opaqueId.nullable(),
  projectId: opaqueId.nullable(),
  placement: conversationPlacementSchema,
  revision: z.number().int().positive(),
  starredAt: timestamp.nullable(),
  archivedAt: timestamp.nullable(),
  deletedAt: timestamp.nullable(),
  purgeAfter: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type AssistantThread = z.infer<typeof assistantThreadSchema>;

export const assistantRunStatusSchema = z.enum([
  "reserved",
  "running",
  "waiting-for-user",
  "waiting-approval",
  "cancelling",
  "complete",
  "failed",
  "cancelled",
]);
export type AssistantRunStatus = z.infer<typeof assistantRunStatusSchema>;

export const assistantRunSchema = z.strictObject({
  id: opaqueId,
  threadId: opaqueId,
  branchId: opaqueId,
  inputMessageId: opaqueId,
  outputMessageId: opaqueId.nullable(),
  reservedOutputMessageId: opaqueId,
  parentRunId: opaqueId.nullable(),
  runtimeId: boundedLabel,
  runtimeVersion: boundedLabel,
  runtimeProtocolVersion: z.literal(1).default(1),
  graphSchemaVersion: z.number().int().positive(),
  modelKey: boundedLabel,
  modelRevision: boundedLabel.default("legacy/1"),
  providerKey: boundedLabel,
  providerRevision: boundedLabel.default("legacy/1"),
  modelPlacement: modelPlacementSchema.default({
    kind: "core",
    instanceId: "legacy",
  }),
  policyRevision: boundedLabel.default("assistant-policy/1"),
  toolCatalogRevision: boundedLabel.default("legacy/1"),
  contextManifestDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  branchIdentityDigest: z.string().regex(/^[a-f0-9]{64}$/).nullable().default(null),
  modelResolvedId: boundedLabel.nullable(),
  status: assistantRunStatusSchema,
  approvalMode: z.enum(["read-only", "confirm-writes", "auto-reversible"]),
  providerRequestKey: opaqueId.nullable(),
  providerDispatchState: z.enum([
    "pending",
    "dispatching",
    "acknowledged",
    "completed",
    "failed",
    "cancelled",
    "inspect-required",
  ]),
  contextManifestId: opaqueId.nullable(),
  conversationCheckpointRef: conversationCheckpointRefSchema.nullable(),
  workspaceSnapshotRef: workspaceSnapshotRefSchema.nullable(),
  sandboxRuntimeCheckpointRef: sandboxRuntimeCheckpointRefSchema.nullable(),
  domainCursorRef: domainCursorRefSchema.nullable(),
  safeError: z.string().max(2_000).nullable(),
  errorCode: z.string().max(128).nullable(),
  cancellationRequestedAt: timestamp.nullable().default(null),
  cancellationReason: z.string().max(1_000).nullable().default(null),
  terminalReason: z
    .enum([
      "completed",
      "user-cancelled",
      "deadline-exceeded",
      "approval-rejected",
      "approval-expired",
      "provider-error",
      "provider-dispatch-unknown",
      "placement-unavailable",
      "model-unavailable",
      "policy-revision-mismatch",
      "tool-catalog-revision-mismatch",
      "checkpoint-corrupt",
      "quota-denied",
      "runtime-error",
    ])
    .nullable()
    .default(null),
  startedAt: timestamp.nullable(),
  completedAt: timestamp.nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
});
export type AssistantRun = z.infer<typeof assistantRunSchema>;

export const assistantAttachmentKindSchema = z.enum([
  "file",
  "year",
  "subject",
  "grade",
  "task",
  "material",
  "transcript",
  "project",
  "document",
  "artifact",
]);
export type AssistantAttachmentKind = z.infer<
  typeof assistantAttachmentKindSchema
>;

export const assistantAttachmentSchema = z.strictObject({
  id: opaqueId,
  messageId: opaqueId,
  kind: assistantAttachmentKindSchema,
  referenceId: opaqueId,
  snapshotVersion: z.string().min(1).max(256).nullable(),
  label: boundedLabel,
  fileId: opaqueId.nullable(),
  createdAt: timestamp,
});
export type AssistantAttachment = z.infer<typeof assistantAttachmentSchema>;

export const contextProofHandleSchema = z.strictObject({
  id: opaqueId,
  contextManifestId: opaqueId,
  runId: opaqueId,
  ordinal: z.number().int().nonnegative(),
  contentVersionReference: contentVersionReferenceSchema,
  locator: sourceLocatorV1Schema,
  evidenceDigest: z.string().regex(/^[a-f0-9]{64}$/),
  quotedContentHash: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  createdAt: timestamp,
});
export type ContextProofHandle = z.infer<typeof contextProofHandleSchema>;

export const contextManifestItemSchema = z.strictObject({
  id: opaqueId,
  trust: z.enum([
    "system-policy",
    "user-instruction",
    "application-data",
    "retrieved-untrusted",
    "tool-result",
  ]),
  kind: z.string().min(1).max(128),
  referenceId: opaqueId.nullable(),
  byteLength: z.number().int().nonnegative(),
  tokenEstimate: z.number().int().nonnegative(),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
});

export const assistantContextManifestSchema = z.strictObject({
  id: opaqueId,
  runId: opaqueId,
  version: z.literal(CONTEXT_MANIFEST_VERSION),
  revision: z.number().int().positive(),
  budget: z.strictObject({
    maxTokens: z.number().int().positive(),
    usedTokens: z.number().int().nonnegative(),
    reservedOutputTokens: z.number().int().nonnegative(),
    /** Text projection estimated with the stable UTF-8/4 policy. */
    textTokens: z.number().int().nonnegative().optional(),
    /** Conservative visual-input allowance, never provider billing data. */
    mediaTokens: z.number().int().nonnegative().optional(),
    estimationPolicy: z
      .enum(["legacy-text-only-v1", "utf8-text-plus-conservative-media-v1"])
      .optional(),
  }),
  items: z.array(contextManifestItemSchema).max(2_000),
  proofHandles: z.array(contextProofHandleSchema).max(2_000),
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  committedAt: timestamp,
});
export type AssistantContextManifest = z.infer<
  typeof assistantContextManifestSchema
>;

export const assistantCitationSchema = z.strictObject({
  id: opaqueId,
  messageId: opaqueId,
  runId: opaqueId,
  ordinal: z.number().int().nonnegative(),
  proofHandleId: opaqueId,
  claimPartId: opaqueId.nullable(),
});
export type AssistantCitation = z.infer<typeof assistantCitationSchema>;

export const assistantUsageSchema = z.strictObject({
  runId: opaqueId,
  providerKey: boundedLabel,
  providerRevision: boundedLabel.default("legacy/1"),
  modelKey: boundedLabel,
  modelRevision: boundedLabel.default("legacy/1"),
  usageVersion: z.literal(1).default(1),
  source: z.enum(["provider", "estimated", "unknown"]).default("unknown"),
  pricingSnapshotId: opaqueId.nullable(),
  inputTokens: z.number().int().nonnegative().nullable(),
  outputTokens: z.number().int().nonnegative().nullable(),
  reasoningTokens: z.number().int().nonnegative().nullable(),
  cachedReadTokens: z.number().int().nonnegative().nullable(),
  cachedWriteTokens: z.number().int().nonnegative().nullable(),
  estimatedCost: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .nullable(),
  currency: z.string().length(3).nullable(),
  final: z.boolean(),
  createdAt: timestamp,
});
export type AssistantUsage = z.infer<typeof assistantUsageSchema>;

export const modelCapabilitySchema = z.strictObject({
  modelKey: boundedLabel,
  providerKey: boundedLabel,
  label: boundedLabel,
  placement: z.enum(["direct-byok", "core", "node", "managed"]),
  modalities: z.array(z.enum(["text", "image", "audio", "file"])).min(1),
  supportsTools: z.boolean(),
  supportsReasoningSummary: z.boolean(),
  contextTokens: z.number().int().positive().nullable(),
  maxOutputTokens: z.number().int().positive().nullable(),
  estimatedInputPrice: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .nullable(),
  estimatedOutputPrice: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/)
    .nullable(),
  currency: z.string().length(3).nullable(),
  contentLeavesPlacement: z.boolean(),
  privacyUrl: z.url().nullable(),
});
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

export const modelUnavailableReasonSchema = z.enum([
  "missing-key",
  "invalid-key",
  "node-offline",
  "node-capability-stale",
  "model-removed",
  "managed-disabled",
  "quota-denied",
  "sandbox-unavailable",
  "policy-disabled",
  "provider-unavailable",
]);
export type ModelUnavailableReason = z.infer<
  typeof modelUnavailableReasonSchema
>;

export const modelReadinessSchema = z.strictObject({
  capability: modelCapabilitySchema,
  available: z.boolean(),
  unavailableReason: modelUnavailableReasonSchema.nullable(),
  modelRevision: boundedLabel,
  providerRevision: boundedLabel,
  placement: modelPlacementSchema,
  routeKey: boundedLabel,
  /** True only when this exact route may be considered by an explicit policy. */
  fallbackEligible: z.boolean(),
});
export type ModelReadiness = z.infer<typeof modelReadinessSchema>;

export const assistantModelRouteSchema = z.enum([
  "selected-only",
  "prefer-node",
  "prefer-core",
  "managed-only",
]);
export const assistantModelFallbackSchema = z.enum([
  "none",
  "same-provider",
  "configured-routes",
]);
export const assistantModelPreferenceSchema = z.strictObject({
  defaultModelKey: boundedLabel.nullable(),
  route: assistantModelRouteSchema,
  fallback: assistantModelFallbackSchema,
  maximumInputTokens: z.number().int().positive().nullable(),
  maximumOutputTokens: z.number().int().positive().nullable(),
  maximumEstimatedCostMinor: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  revision: z.number().int().positive(),
  updatedAt: timestamp,
});
export type AssistantModelPreference = z.infer<
  typeof assistantModelPreferenceSchema
>;

/** Immutable route and budget decision frozen before a run is launched. */
export const assistantRunModelPolicySchema = z.strictObject({
  preferenceRevision: z.number().int().positive(),
  requestedModelKey: boundedLabel.nullable(),
  selectedModelKey: boundedLabel,
  route: assistantModelRouteSchema,
  fallback: assistantModelFallbackSchema,
  orderedFallbackModelKeys: z.array(boundedLabel).max(256),
  maximumInputTokens: z.number().int().positive().nullable(),
  maximumOutputTokens: z.number().int().positive().nullable(),
  maximumEstimatedCostMinor: z.number().int().nonnegative().nullable(),
  currency: z.string().length(3).nullable(),
  frozenAt: timestamp,
});
export type AssistantRunModelPolicy = z.infer<
  typeof assistantRunModelPolicySchema
>;

export const reserveAssistantTurnSchema = z.strictObject({
  threadId: opaqueId,
  branchId: opaqueId,
  expectedHeadMessageId: opaqueId.nullable(),
  clientRequestId: opaqueId,
  markdown: z.string().trim().min(1).max(200_000),
  modelKey: boundedLabel,
  attachmentIds: z.array(opaqueId).max(50).default([]),
  forkOnConflict: z.boolean().default(false),
});
export type ReserveAssistantTurn = z.infer<typeof reserveAssistantTurnSchema>;

export const historicalBranchOperationSchema = z.enum(["edit", "retry"]);
export type HistoricalBranchOperation = z.infer<
  typeof historicalBranchOperationSchema
>;

const snapshotDigest = z.string().regex(/^sha256:[a-f0-9]{64}$/u);

export const historicalBranchChoiceSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("conversation-only"),
    sourceBranchId: opaqueId,
  }),
  z.strictObject({
    mode: z.literal("workspace-copy"),
    sourceBranchId: opaqueId,
    snapshotId: opaqueId,
    expectedPortableManifestDigest: snapshotDigest,
  }),
]);
export type HistoricalBranchChoice = z.infer<
  typeof historicalBranchChoiceSchema
>;

export const historicalBranchDecisionSchema = z.discriminatedUnion("mode", [
  ...historicalBranchChoiceSchema.options,
  z.strictObject({
    mode: z.literal("review-data-changes"),
    sourceBranchId: opaqueId,
  }),
]);
export type HistoricalBranchDecision = z.infer<
  typeof historicalBranchDecisionSchema
>;

export const historicalBranchSnapshotPreviewSchema = z.strictObject({
  id: opaqueId,
  conversationCheckpointRef: conversationCheckpointRefSchema,
  sequence: z.number().int().positive(),
  executionProfileId: sandboxProfileIdSchema,
  executionProfileVersion: z.string().min(1).max(128),
  imageDigest: snapshotDigest,
  provider: sandboxProviderIdSchema,
  portableManifestDigest: snapshotDigest,
  byteSize: z.number().int().nonnegative(),
  fileCount: z.number().int().nonnegative(),
  committedAt: timestamp,
});
export type HistoricalBranchSnapshotPreview = z.infer<
  typeof historicalBranchSnapshotPreviewSchema
>;

export const historicalWorkspaceCopyUnavailableReasonSchema = z.enum([
  "no-committed-snapshot",
  "snapshot-incompatible",
  "provider-unavailable",
  "unsupported-target",
]);
export type HistoricalWorkspaceCopyUnavailableReason = z.infer<
  typeof historicalWorkspaceCopyUnavailableReasonSchema
>;

export const historicalWorkspaceCopyPreviewSchema = z.discriminatedUnion(
  "available",
  [
    z.strictObject({
      available: z.literal(true),
      snapshot: historicalBranchSnapshotPreviewSchema,
    }),
    z.strictObject({
      available: z.literal(false),
      reason: historicalWorkspaceCopyUnavailableReasonSchema,
      message: z.string().min(1).max(2_000),
      snapshot: historicalBranchSnapshotPreviewSchema.nullable(),
    }),
  ],
);
export type HistoricalWorkspaceCopyPreview = z.infer<
  typeof historicalWorkspaceCopyPreviewSchema
>;

export const historicalDataChangesAvailabilitySchema =
  z.discriminatedUnion("available", [
    z.strictObject({
      available: z.literal(true),
      domainCursorRef: domainCursorRefSchema,
    }),
    z.strictObject({
      available: z.literal(false),
      reason: z.literal("no-domain-cursor"),
      message: z.string().min(1).max(2_000),
    }),
  ]);

export const historicalDataChangesReviewSchema = z.strictObject({
  operation: historicalBranchOperationSchema,
  threadId: opaqueId,
  sourceBranchId: opaqueId,
  messageId: opaqueId,
  domainCursorRef: domainCursorRefSchema,
  safeToCompensate: z.array(agentActionDtoSchema).max(500),
  conflicted: z.array(agentActionDtoSchema).max(500),
  alreadyCompensated: z.array(agentActionDtoSchema).max(500),
  nonUndoable: z.array(agentActionDtoSchema).max(500),
  unrelatedActionCount: z.number().int().nonnegative(),
  undoPreview: agentActionPreviewSchema.nullable(),
  truncated: z.boolean(),
});
export type HistoricalDataChangesReview = z.infer<
  typeof historicalDataChangesReviewSchema
>;

export const historicalBranchPreviewSchema = z.strictObject({
  operation: historicalBranchOperationSchema,
  threadId: opaqueId,
  sourceBranchId: opaqueId,
  messageId: opaqueId,
  conversationOnly: z.strictObject({ available: z.literal(true) }),
  workspaceCopy: historicalWorkspaceCopyPreviewSchema,
  dataChanges: historicalDataChangesAvailabilitySchema,
});
export type HistoricalBranchPreview = z.infer<
  typeof historicalBranchPreviewSchema
>;

export const conversationCheckpointRecordSchema = z.strictObject({
  id: opaqueId,
  threadId: opaqueId,
  branchId: opaqueId,
  runId: opaqueId,
  inputMessageId: opaqueId,
  outputMessageId: opaqueId.nullable(),
  parentCheckpointId: opaqueId.nullable(),
  afterEventSequence: z.number().int().nonnegative(),
  runtimeId: boundedLabel,
  runtimeVersion: boundedLabel,
  graphSchemaVersion: z.number().int().positive(),
  stateDigest: z.string().regex(/^[a-f0-9]{64}$/),
  stateByteLength: z.number().int().nonnegative(),
  stateBlobRef: z.string().min(1).max(1_024).nullable(),
  status: z.enum(["staging", "committed", "failed"]),
  failureCode: z.string().min(1).max(128).nullable(),
  committedAt: timestamp.nullable(),
  createdAt: timestamp,
});
export type ConversationCheckpointRecord = z.infer<
  typeof conversationCheckpointRecordSchema
>;

export const assistantDagExportSchema = z.strictObject({
  exportVersion: z.literal(ASSISTANT_EXPORT_VERSION),
  exportedAt: timestamp,
  mode: z.enum(["active-branch", "whole-dag"]),
  thread: assistantThreadSchema,
  branches: z.array(assistantBranchSchema),
  messages: z.array(assistantMessageSchema),
  runs: z.array(assistantRunSchema),
  attachments: z.array(assistantAttachmentSchema),
  citations: z.array(assistantCitationSchema),
  manifests: z.array(assistantContextManifestSchema),
  usage: z.array(assistantUsageSchema),
});
export type AssistantDagExport = z.infer<typeof assistantDagExportSchema>;

export const assistantThreadDetailSchema = z.strictObject({
  thread: assistantThreadSchema,
  branches: z.array(assistantBranchSchema),
  activeBranchId: opaqueId.nullable(),
  activePathMessageIds: z.array(opaqueId),
  messages: z.array(assistantMessageSchema),
  runs: z.array(assistantRunSchema),
  citations: z.array(assistantCitationSchema),
  attachments: z.array(assistantAttachmentSchema),
  usage: z.array(assistantUsageSchema),
  manifests: z.array(assistantContextManifestSchema),
  activeRunProjections: z.array(
    z.strictObject({
      runId: opaqueId,
      outputMessageId: opaqueId,
      parts: z.array(assistantPartV1Schema).max(1_000),
      lastSequence: z.number().int().nonnegative(),
      status: assistantRunStatusSchema,
    }),
  ),
});
export type AssistantThreadDetail = z.infer<typeof assistantThreadDetailSchema>;

export const assistantThreadListItemSchema = z.strictObject({
  thread: assistantThreadSchema,
  messageCount: z.number().int().nonnegative(),
  lastMessageAt: timestamp.nullable(),
  activeRunId: opaqueId.nullable(),
  matchedMessagePreview: z.string().max(500).nullable(),
});
export type AssistantThreadListItem = z.infer<
  typeof assistantThreadListItemSchema
>;

export const assistantSkillDescriptorSchema = z.strictObject({
  id: opaqueId,
  version: z.number().int().positive(),
  label: boundedLabel,
  description: z.string().min(1).max(2_000),
  compatibleToolIds: z.array(opaqueId).max(100),
  contextPolicy: z.enum(["explicit-only", "project-and-explicit"]),
});
export type AssistantSkillDescriptor = z.infer<
  typeof assistantSkillDescriptorSchema
>;

export const assistantEventProjectionSchema = z.strictObject({
  protocolVersion: z.literal(1),
  eventId: opaqueId,
  sequence: z.number().int().positive(),
  threadId: opaqueId,
  branchId: opaqueId,
  runId: opaqueId,
  emittedAt: timestamp,
  persistedAt: timestamp,
  type: z.string().min(1).max(256),
  payload: z.unknown(),
  terminal: z.boolean(),
});
export type AssistantEventProjection = z.infer<
  typeof assistantEventProjectionSchema
>;

export function assertAssistantDag(
  thread: AssistantThread,
  branches: readonly AssistantBranch[],
  messages: readonly AssistantMessage[],
): void {
  const messageById = new Map(messages.map((message) => [message.id, message]));
  const branchIds = new Set<string>();

  for (const message of messages) {
    if (message.threadId !== thread.id) {
      throw new Error("Every message must belong to the exported thread");
    }
    if (
      message.parentMessageId &&
      messageById.get(message.parentMessageId)?.threadId !== thread.id
    ) {
      throw new Error("A message parent must belong to the same thread");
    }

    const seen = new Set<string>([message.id]);
    let cursor = message.parentMessageId;
    while (cursor) {
      if (seen.has(cursor))
        throw new Error("Conversation message DAG is cyclic");
      seen.add(cursor);
      cursor = messageById.get(cursor)?.parentMessageId ?? null;
    }
  }

  for (const branch of branches) {
    if (branch.threadId !== thread.id || branchIds.has(branch.id)) {
      throw new Error("Branches must be unique and belong to the thread");
    }
    branchIds.add(branch.id);
    if (branch.headMessageId && !messageById.has(branch.headMessageId)) {
      throw new Error("Branch heads must reference a thread message");
    }
  }

  if (thread.activeBranchId && !branchIds.has(thread.activeBranchId)) {
    throw new Error("The active branch must exist in the thread");
  }
}
