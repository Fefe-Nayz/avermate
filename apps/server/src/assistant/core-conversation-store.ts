import type { Client, InStatement, InValue, Transaction } from "@libsql/client";
import {
  ASSISTANT_PARTS_VERSION,
  assistantBranchSchema,
  assistantCitationSchema,
  assistantContextManifestSchema,
  assistantDagExportSchema,
  assistantMessageSchema,
  assistantPartV1Schema,
  assistantRunSchema,
  assistantThreadDetailSchema,
  assistantThreadListItemSchema,
  assistantThreadSchema,
  assistantUsageSchema,
  avermateAgentEventV1Schema,
  sourceLocatorV1Schema,
  storedConversationEventSchema,
  type AssistantAttachment,
  type AssistantAttachmentKind,
  type AssistantBranch,
  type AssistantCitation,
  type AssistantContextManifest,
  type AssistantDagExport,
  type AssistantEventProjection,
  type AssistantMessage,
  type AssistantPartV1,
  type AssistantRun,
  type AssistantRunModelPolicy,
  type AssistantRunStatus,
  type AssistantThread,
  type AssistantThreadDetail,
  type AssistantThreadListItem,
  type AssistantUsage,
  type SourceLocatorV1,
} from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import { retrySqliteBusy } from "../lib/sqlite-busy";
import {
  canonicalJson,
  isoFromSqlite,
  jsonValue,
  referenceKey,
  sha256,
} from "../search/values";

export type AssistantSqlClient = Pick<
  Client,
  "execute" | "batch" | "transaction"
>;

type Row = Record<string, InValue>;

export type ConversationStoreErrorCode =
  | "not_found"
  | "forbidden"
  | "head_conflict"
  | "active_run"
  | "divergent_replay"
  | "placement_unavailable"
  | "invalid_state";

export class ConversationStoreError extends Error {
  constructor(
    readonly code: ConversationStoreErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConversationStoreError";
  }
}

export type TurnReservation = {
  threadId: string;
  branchId: string;
  userMessageId: string;
  runId: string;
  reservedOutputMessageId: string;
  idempotent: boolean;
};

export type AssistantAttachmentInput = {
  kind: AssistantAttachmentKind;
  referenceId: string;
  snapshotVersion?: string | null;
  label: string;
};

export type EditedMessageProjection =
  | { kind: "run-reserved"; reservation: TurnReservation }
  | {
      kind: "user-curated-model";
      threadId: string;
      branchId: string;
      messageId: string;
    };

export type FinalUsageSnapshot = {
  providerKey: string;
  providerRevision?: string;
  modelKey: string;
  modelRevision?: string;
  source?: "provider" | "estimated" | "unknown";
  pricingSnapshotId?: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cachedReadTokens: number | null;
  cachedWriteTokens: number | null;
  estimatedCost: string | null;
  currency: string | null;
};

export type FinalizedRunProjection = {
  run: AssistantRun;
  output: AssistantMessage;
  citations: AssistantCitation[];
  usage: AssistantUsage;
  terminalEvent: AssistantEventProjection;
  branchId: string;
  siblingCreated: boolean;
};

export type NodeConversationPayloadCodec = {
  sealParts(input: {
    ownerId: string;
    nodeId: string;
    threadId: string;
    messageId: string;
    role: "user" | "assistant" | "system" | "tool";
    parentMessageId: string | null;
    parts: AssistantPartV1[];
  }): AssistantPartV1[];
  openParts(input: {
    ownerId: string;
    nodeId: string;
    threadId: string;
    messageId: string;
    role: "user" | "assistant" | "system" | "tool";
    parentMessageId: string | null;
    parts: AssistantPartV1[];
  }): AssistantPartV1[];
  sealEvent(input: {
    ownerId: string;
    nodeId: string;
    threadId: string;
    runId: string;
    eventId: string;
    payload: unknown;
  }): unknown;
  openEvent(input: {
    ownerId: string;
    nodeId: string;
    threadId: string;
    runId: string;
    eventId: string;
    payload: unknown;
  }): unknown;
};

function sqlTimestamp(): number {
  return Math.floor(Date.now() / 1_000);
}

function nullString(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function threadFromRow(row: Row): AssistantThread {
  return assistantThreadSchema.parse({
    id: String(row.id),
    userId: String(row.userId),
    title: String(row.title),
    activeBranchId: nullString(row.activeBranchId),
    projectId: nullString(row.projectId),
    placement:
      row.placement === "node"
        ? { kind: "node", nodeId: String(row.placementRef) }
        : { kind: "core" },
    revision: Number(row.revision),
    starredAt: row.starredAt === null ? null : isoFromSqlite(row.starredAt),
    archivedAt: row.archivedAt === null ? null : isoFromSqlite(row.archivedAt),
    deletedAt: row.deletedAt === null ? null : isoFromSqlite(row.deletedAt),
    purgeAfter: row.purgeAfter === null ? null : isoFromSqlite(row.purgeAfter),
    createdAt: isoFromSqlite(row.createdAt),
    updatedAt: isoFromSqlite(row.updatedAt),
  });
}

function branchFromRow(row: Row): AssistantBranch {
  return assistantBranchSchema.parse({
    id: String(row.id),
    threadId: String(row.threadId),
    name: nullString(row.name),
    forkedFromMessageId: nullString(row.forkedFromMessageId),
    headMessageId: nullString(row.headMessageId),
    createdAt: isoFromSqlite(row.createdAt),
    updatedAt: isoFromSqlite(row.updatedAt),
  });
}

function messageFromRow(row: Row): AssistantMessage {
  return assistantMessageSchema.parse({
    id: String(row.id),
    threadId: String(row.threadId),
    parentMessageId: nullString(row.parentMessageId),
    role: row.role,
    authorship: row.authorship,
    status: row.status,
    partsVersion: Number(row.partsVersion),
    parts: jsonValue(row.partsJson),
    createdByRunId: nullString(row.createdByRunId),
    replacesMessageId: nullString(row.replacesMessageId),
    createdAt: isoFromSqlite(row.createdAt),
  });
}

function runFromRow(row: Row): AssistantRun {
  return assistantRunSchema.parse({
    id: String(row.id),
    threadId: String(row.threadId),
    branchId: String(row.branchId),
    inputMessageId: String(row.inputMessageId),
    outputMessageId: nullString(row.outputMessageId),
    reservedOutputMessageId: String(row.reservedOutputMessageId),
    parentRunId: nullString(row.parentRunId),
    runtimeId: String(row.runtimeId),
    runtimeVersion: String(row.runtimeVersion),
    runtimeProtocolVersion: Number(row.runtimeProtocolVersion ?? 1),
    graphSchemaVersion: Number(row.graphSchemaVersion),
    modelKey: String(row.modelKey),
    modelRevision: String(row.modelRevision ?? "legacy/1"),
    providerKey: String(row.providerKey),
    providerRevision: String(row.providerRevision ?? "legacy/1"),
    modelPlacement:
      row.modelPlacementJson === undefined || row.modelPlacementJson === null
        ? { kind: "core", instanceId: "legacy" }
        : jsonValue(row.modelPlacementJson),
    policyRevision: String(row.policyRevision ?? "assistant-policy/1"),
    toolCatalogRevision: String(row.toolCatalogRevision ?? "legacy/1"),
    contextManifestDigest: nullString(row.contextManifestDigest),
    branchIdentityDigest: nullString(row.branchIdentityDigest),
    modelResolvedId: nullString(row.modelResolvedId),
    status: row.status,
    approvalMode: row.approvalMode,
    providerRequestKey: nullString(row.providerRequestKey),
    providerDispatchState: row.providerDispatchState,
    contextManifestId: nullString(row.contextManifestId),
    conversationCheckpointRef: nullString(row.conversationCheckpointRef),
    workspaceSnapshotRef: nullString(row.workspaceSnapshotRef),
    sandboxRuntimeCheckpointRef: nullString(row.sandboxRuntimeCheckpointRef),
    domainCursorRef: nullString(row.domainCursorRef),
    safeError: nullString(row.safeError),
    errorCode: nullString(row.errorCode),
    cancellationRequestedAt:
      row.cancellationRequestedAt === undefined ||
      row.cancellationRequestedAt === null
        ? null
        : isoFromSqlite(row.cancellationRequestedAt),
    cancellationReason: nullString(row.cancellationReason),
    terminalReason: row.terminalReason ?? null,
    startedAt: row.startedAt === null ? null : isoFromSqlite(row.startedAt),
    completedAt:
      row.completedAt === null ? null : isoFromSqlite(row.completedAt),
    createdAt: isoFromSqlite(row.createdAt),
    updatedAt: isoFromSqlite(row.updatedAt),
  });
}

function citationFromRow(row: Row): AssistantCitation {
  return assistantCitationSchema.parse({
    id: String(row.id),
    messageId: String(row.messageId),
    runId: String(row.runId),
    ordinal: Number(row.ordinal),
    proofHandleId: String(row.proofHandleId),
    claimPartId: nullString(row.claimPartId),
  });
}

function usageFromRow(row: Row): AssistantUsage {
  const numeric = (name: string) =>
    row[name] === null ? null : Number(row[name]);
  return assistantUsageSchema.parse({
    runId: String(row.runId),
    providerKey: String(row.providerKey),
    providerRevision: String(row.providerRevision ?? "legacy/1"),
    modelKey: String(row.modelKey),
    modelRevision: String(row.modelRevision ?? "legacy/1"),
    usageVersion: Number(row.usageVersion ?? 1),
    source: row.source ?? "unknown",
    pricingSnapshotId: nullString(row.pricingSnapshotId),
    inputTokens: numeric("inputTokens"),
    outputTokens: numeric("outputTokens"),
    reasoningTokens: numeric("reasoningTokens"),
    cachedReadTokens: numeric("cachedReadTokens"),
    cachedWriteTokens: numeric("cachedWriteTokens"),
    estimatedCost: nullString(row.estimatedCost),
    currency: nullString(row.currency),
    final: Boolean(row.final),
    createdAt: isoFromSqlite(row.createdAt),
  });
}

function attachmentFromRow(row: Row): AssistantAttachment {
  return {
    id: String(row.id),
    messageId: String(row.messageId),
    kind: row.kind as AssistantAttachmentKind,
    referenceId: String(row.referenceId),
    snapshotVersion: nullString(row.snapshotVersion),
    label: String(row.label),
    fileId: nullString(row.fileId),
    createdAt: isoFromSqlite(row.createdAt),
  };
}

function eventFromRow(row: Row): AssistantEventProjection {
  return storedConversationEventSchema.parse({
    protocolVersion: 1,
    eventId: String(row.eventId),
    sequence: Number(row.sequence),
    threadId: String(row.threadId),
    branchId: String(row.branchId),
    runId: String(row.runId),
    emittedAt: isoFromSqlite(row.emittedAt),
    persistedAt: isoFromSqlite(row.persistedAt),
    type: String(row.type),
    payload: jsonValue(row.payloadJson),
    terminal: Boolean(row.terminal),
  });
}

async function execute(
  target: AssistantSqlClient | Transaction,
  input: InStatement,
) {
  return target.execute(input);
}

async function one(
  target: AssistantSqlClient | Transaction,
  sql: string,
  args: InValue[] = [],
): Promise<Row | null> {
  return (
    ((await execute(target, { sql, args })).rows[0] as Row | undefined) ?? null
  );
}

async function currentDomainCursorRef(
  target: AssistantSqlClient | Transaction,
  ownerId: string,
): Promise<string> {
  const row = await one(
    target,
    "SELECT nextSequence FROM agent_action_sequences WHERE userId = ? LIMIT 1",
    [ownerId],
  );
  return `domain:${ownerId}:${Number(row?.nextSequence ?? 0)}`;
}

const corpusOriginKindByAttachmentKind = {
  material: "material",
  document: "study-document",
  transcript: "recording",
  grade: "grade",
  subject: "subject",
  artifact: "artifact",
} as const;

function attachmentSupportsCorpusSnapshot(kind: AssistantAttachmentKind) {
  return kind === "file" || kind in corpusOriginKindByAttachmentKind;
}

function attachmentIdentityKey(input: {
  kind: AssistantAttachmentKind;
  referenceId: string;
}) {
  return `${input.kind}\0${input.referenceId}`;
}

function assertAttachmentSnapshotInput(
  kind: AssistantAttachmentKind,
  snapshotVersion: string | null | undefined,
) {
  if (snapshotVersion != null && !attachmentSupportsCorpusSnapshot(kind)) {
    throw new ConversationStoreError(
      "invalid_state",
      "This attachment kind does not support corpus snapshot versions",
    );
  }
}

type CorpusAttachmentIdentity = {
  originKind: (typeof corpusOriginKindByAttachmentKind)[keyof typeof corpusOriginKindByAttachmentKind];
  originId: string;
};

async function corpusAttachmentIdentity(
  target: AssistantSqlClient | Transaction,
  input: {
    ownerId: string;
    kind: AssistantAttachmentKind;
    referenceId: string;
  },
): Promise<CorpusAttachmentIdentity | null> {
  if (input.kind === "file") {
    const material = await one(
      target,
      `SELECT id FROM material_documents
        WHERE fileId = ? AND userId = ? AND deletedAt IS NULL LIMIT 1`,
      [input.referenceId, input.ownerId],
    );
    return material
      ? { originKind: "material", originId: String(material.id) }
      : null;
  }
  if (!(input.kind in corpusOriginKindByAttachmentKind)) return null;
  return {
    originKind:
      corpusOriginKindByAttachmentKind[
        input.kind as keyof typeof corpusOriginKindByAttachmentKind
      ],
    originId: input.referenceId,
  };
}

type AttachmentSnapshotCandidate = {
  sourceId: string;
  versionId: string;
  locator: SourceLocatorV1;
};

const TASK_ATTACHMENT_SNAPSHOT_PAYLOAD_VERSION = 1 as const;
const TASK_ATTACHMENT_TEXT_FIELD_BYTES = 8 * 1024;
const TASK_ATTACHMENT_TITLE_BYTES = 2 * 1024;
const TASK_ATTACHMENT_PAYLOAD_BYTES = 32 * 1024;
const MAX_ASSISTANT_MESSAGE_ATTACHMENTS = 50;

export type FrozenTaskAttachmentSnapshot = {
  payloadVersion: typeof TASK_ATTACHMENT_SNAPSHOT_PAYLOAD_VERSION;
  payloadJson: string;
  payloadDigest: string;
  sourceRevision: number | null;
};

function boundedTaskSnapshotText(value: string, maximumBytes: number) {
  const encoder = new TextEncoder();
  if (encoder.encode(value).byteLength <= maximumBytes) return value;
  let low = 0;
  let high = value.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (encoder.encode(value.slice(0, middle)).byteLength <= maximumBytes) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return value.slice(0, low);
}

function frozenTaskSnapshotFromRow(
  row: Row,
): FrozenTaskAttachmentSnapshot | null {
  if (
    row.frozenPayloadVersion === null ||
    row.frozenPayloadVersion === undefined ||
    row.frozenPayloadJson === null ||
    row.frozenPayloadJson === undefined ||
    row.frozenPayloadDigest === null ||
    row.frozenPayloadDigest === undefined
  ) {
    return null;
  }
  const payloadVersion = Number(row.frozenPayloadVersion);
  const payloadJson =
    typeof row.frozenPayloadJson === "string"
      ? row.frozenPayloadJson
      : canonicalJson(row.frozenPayloadJson);
  const payloadDigest = String(row.frozenPayloadDigest);
  if (
    payloadVersion !== TASK_ATTACHMENT_SNAPSHOT_PAYLOAD_VERSION ||
    new TextEncoder().encode(payloadJson).byteLength >
      TASK_ATTACHMENT_PAYLOAD_BYTES ||
    !/^[a-f0-9]{64}$/u.test(payloadDigest) ||
    sha256(payloadJson) !== payloadDigest
  ) {
    throw new ConversationStoreError(
      "invalid_state",
      "The frozen task attachment snapshot is invalid",
    );
  }
  return {
    payloadVersion: TASK_ATTACHMENT_SNAPSHOT_PAYLOAD_VERSION,
    payloadJson,
    payloadDigest,
    sourceRevision:
      row.frozenSourceRevision === null ||
      row.frozenSourceRevision === undefined
        ? null
        : Number(row.frozenSourceRevision),
  };
}

async function ownedTaskSnapshotCandidate(
  target: AssistantSqlClient | Transaction,
  ownerId: string,
  taskId: string,
): Promise<FrozenTaskAttachmentSnapshot | null> {
  const canonicalTask = await one(
    target,
    `SELECT id, title, notes, localNote, startsAt, scheduledAt,
        dueAt, status, completedAt, subjectId, yearId, revision,
        sourceConnectionId, syncState
      FROM planning_tasks
      WHERE id = ? AND userId = ? AND trashedAt IS NULL LIMIT 1`,
    [taskId, ownerId],
  );
  const legacyTask = canonicalTask
    ? null
    : await one(
        target,
        `SELECT id, kind, title, notes, startsAt, endsAt, allDay,
            status, completedAt, subjectId, yearId
          FROM planner_items
          WHERE id = ? AND userId = ? AND kind = 'task' LIMIT 1`,
        [taskId, ownerId],
      );
  const task = canonicalTask ?? legacyTask;
  if (!task) return null;
  const payloadJson = canonicalJson({
    kind: "planning-task",
    taskId: String(task.id),
    title: boundedTaskSnapshotText(
      String(task.title),
      TASK_ATTACHMENT_TITLE_BYTES,
    ),
    notes:
      task.notes === null
        ? null
        : boundedTaskSnapshotText(
            String(task.notes),
            TASK_ATTACHMENT_TEXT_FIELD_BYTES,
          ),
    localNote:
      task.localNote === undefined || task.localNote === null
        ? null
        : boundedTaskSnapshotText(
            String(task.localNote),
            TASK_ATTACHMENT_TEXT_FIELD_BYTES,
          ),
    startsAt: task.startsAt ?? null,
    scheduledAt: task.scheduledAt ?? null,
    dueAt: task.dueAt ?? task.endsAt ?? null,
    allDay: task.allDay ?? null,
    status: String(task.status),
    completedAt: task.completedAt ?? null,
    subjectId: task.subjectId === null ? null : String(task.subjectId),
    yearId: String(task.yearId),
    revision: task.revision === undefined ? null : Number(task.revision),
    managed:
      task.sourceConnectionId === undefined
        ? false
        : task.sourceConnectionId !== null,
    syncState: task.syncState === undefined ? null : String(task.syncState),
  });
  if (
    new TextEncoder().encode(payloadJson).byteLength >
    TASK_ATTACHMENT_PAYLOAD_BYTES
  ) {
    throw new ConversationStoreError(
      "invalid_state",
      "The attached task snapshot exceeds the supported size",
    );
  }
  return {
    payloadVersion: TASK_ATTACHMENT_SNAPSHOT_PAYLOAD_VERSION,
    payloadJson,
    payloadDigest: sha256(payloadJson),
    sourceRevision: task.revision === undefined ? null : Number(task.revision),
  };
}

async function freezeTaskAttachmentSnapshotInTransaction(
  target: AssistantSqlClient | Transaction,
  input: { ownerId: string; attachmentId: string; rejectUnavailable?: boolean },
): Promise<FrozenTaskAttachmentSnapshot | null> {
  const attachment = await one(
    target,
    `SELECT attachments.*,
        EXISTS (
          SELECT 1 FROM assistant_attachments AS replaced
          WHERE replaced.messageId = messages.replacesMessageId
            AND replaced.kind = attachments.kind
            AND replaced.referenceId = attachments.referenceId
        ) AS preservedFromReplacement
      FROM assistant_attachments AS attachments
      JOIN assistant_messages AS messages ON messages.id = attachments.messageId
      JOIN assistant_threads AS threads ON threads.id = messages.threadId
      WHERE attachments.id = ? AND threads.userId = ? LIMIT 1`,
    [input.attachmentId, input.ownerId],
  );
  if (!attachment) {
    throw new ConversationStoreError("not_found", "Attachment not found");
  }
  if (String(attachment.kind) !== "task") {
    throw new ConversationStoreError(
      "invalid_state",
      "Only task attachments have structured task snapshots",
    );
  }
  if (nullString(attachment.snapshotVersion) !== null) {
    throw new ConversationStoreError(
      "invalid_state",
      "Task attachments do not support corpus snapshot versions",
    );
  }
  const existing = frozenTaskSnapshotFromRow(attachment);
  if (existing) return existing;
  // An edited message preserves the exact historical attachment. A legacy
  // source row without a frozen task payload is therefore unavailable rather
  // than permission to snapshot the task's current mutable state.
  if (Boolean(attachment.preservedFromReplacement)) return null;
  const candidate = await ownedTaskSnapshotCandidate(
    target,
    input.ownerId,
    String(attachment.referenceId),
  );
  if (!candidate) {
    if (input.rejectUnavailable) {
      throw new ConversationStoreError(
        "not_found",
        "The attached task was not found",
      );
    }
    return null;
  }
  await execute(target, {
    sql: `UPDATE assistant_attachments
      SET frozenPayloadVersion = ?, frozenPayloadJson = ?,
        frozenPayloadDigest = ?, frozenSourceRevision = ?
      WHERE id = ? AND frozenPayloadJson IS NULL`,
    args: [
      candidate.payloadVersion,
      candidate.payloadJson,
      candidate.payloadDigest,
      candidate.sourceRevision,
      input.attachmentId,
    ],
  });
  const winner = await one(
    target,
    `SELECT frozenPayloadVersion, frozenPayloadJson, frozenPayloadDigest,
        frozenSourceRevision
      FROM assistant_attachments WHERE id = ? LIMIT 1`,
    [input.attachmentId],
  );
  const frozen = winner ? frozenTaskSnapshotFromRow(winner) : null;
  if (!frozen) {
    throw new ConversationStoreError(
      "invalid_state",
      "The task attachment snapshot could not be frozen",
    );
  }
  return frozen;
}

async function attachmentSnapshotCandidate(
  target: AssistantSqlClient | Transaction,
  input: {
    ownerId: string;
    identity: CorpusAttachmentIdentity;
    requestedVersionId?: string | null;
  },
): Promise<AttachmentSnapshotCandidate | null> {
  const requested = input.requestedVersionId ?? null;
  const row = await one(
    target,
    `SELECT sources.id AS sourceId, versions.id AS versionId,
        chunks.locatorJson
      FROM content_sources AS sources
      JOIN content_versions AS versions
        ON versions.sourceId = sources.id
        AND versions.id = ${requested === null ? "sources.currentVersionId" : "?"}
      JOIN content_chunks AS chunks
        ON chunks.id = (
          SELECT firstChunk.id FROM content_chunks AS firstChunk
          WHERE firstChunk.versionId = versions.id
          ORDER BY firstChunk.ordinal, firstChunk.id LIMIT 1
        )
      WHERE sources.userId = ? AND sources.originKind = ?
        AND sources.originId = ? LIMIT 1`,
    [
      ...(requested === null ? [] : [requested]),
      input.ownerId,
      input.identity.originKind,
      input.identity.originId,
    ],
  );
  if (!row) return null;
  return {
    sourceId: String(row.sourceId),
    versionId: String(row.versionId),
    locator: sourceLocatorV1Schema.parse(jsonValue(row.locatorJson)),
  };
}

async function createAttachmentVersionReference(
  target: AssistantSqlClient | Transaction,
  input: {
    ownerId: string;
    attachmentId: string;
    candidate: AttachmentSnapshotCandidate;
    now: number;
  },
): Promise<void> {
  const key = referenceKey({
    sourceVersionId: input.candidate.versionId,
    chunkId: null,
    locatorSchemaVersion: 1,
    locator: input.candidate.locator,
  });
  await execute(target, {
    sql: `INSERT INTO content_version_references (
        id, userId, ownerKind, ownerId, sourceVersionId, chunkId,
        locatorSchemaVersion, locatorJson, quotedContentHash, referenceKey,
        createdAt
      ) VALUES (?, ?, 'assistant-citation', ?, ?, NULL, 1, ?, NULL, ?, ?)
      ON CONFLICT(ownerKind, ownerId, referenceKey) DO NOTHING`,
    args: [
      newId("cref"),
      input.ownerId,
      input.attachmentId,
      input.candidate.versionId,
      canonicalJson(input.candidate.locator),
      key,
      input.now,
    ],
  });
}

/**
 * Freezes one corpus attachment exactly once and creates its GC reachability
 * edge in the same write transaction. A caller may pass the version returned
 * by indexing so a concurrent head publication cannot silently move N to N+1.
 */
async function freezeAttachmentSnapshotInTransaction(
  target: AssistantSqlClient | Transaction,
  input: {
    ownerId: string;
    attachmentId: string;
    expectedVersionId?: string | null;
    rejectUnavailableExpectedVersion?: boolean;
  },
): Promise<string | null> {
  const attachment = await one(
    target,
    `SELECT attachments.kind, attachments.referenceId,
        attachments.snapshotVersion,
        EXISTS (
          SELECT 1 FROM assistant_attachments AS replaced
          WHERE replaced.messageId = messages.replacesMessageId
            AND replaced.kind = attachments.kind
            AND replaced.referenceId = attachments.referenceId
        ) AS preservedFromReplacement
      FROM assistant_attachments AS attachments
      JOIN assistant_messages AS messages ON messages.id = attachments.messageId
      JOIN assistant_threads AS threads ON threads.id = messages.threadId
      WHERE attachments.id = ? AND threads.userId = ? LIMIT 1`,
    [input.attachmentId, input.ownerId],
  );
  if (!attachment) {
    throw new ConversationStoreError("not_found", "Attachment not found");
  }
  const attachmentKind = attachment.kind as AssistantAttachmentKind;
  const existingVersionId = nullString(attachment.snapshotVersion);
  const expectedVersionId = input.expectedVersionId ?? null;
  const hasCorpusSnapshotSemantics =
    attachmentSupportsCorpusSnapshot(attachmentKind);
  if (!hasCorpusSnapshotSemantics) {
    if (existingVersionId !== null || expectedVersionId !== null) {
      throw new ConversationStoreError(
        "invalid_state",
        "This attachment kind does not support corpus snapshot versions",
      );
    }
    return null;
  }
  // Null on a preserved historical attachment means that no exact corpus
  // version was available to the source message. Never reinterpret it as
  // "follow the current head" when the edited branch is executed later.
  if (
    existingVersionId === null &&
    Boolean(attachment.preservedFromReplacement)
  ) {
    return null;
  }
  const identity = await corpusAttachmentIdentity(target, {
    ownerId: input.ownerId,
    kind: attachmentKind,
    referenceId: String(attachment.referenceId),
  });
  if (!identity) {
    if (
      existingVersionId !== null ||
      (expectedVersionId !== null && input.rejectUnavailableExpectedVersion)
    ) {
      throw new ConversationStoreError(
        "invalid_state",
        "Attachment snapshot is not owned or its source mapping is unavailable",
      );
    }
    return null;
  }

  const requestedVersionId = existingVersionId ?? expectedVersionId;
  const candidate = await attachmentSnapshotCandidate(target, {
    ownerId: input.ownerId,
    identity,
    requestedVersionId,
  });
  if (!candidate) {
    if (
      requestedVersionId !== null &&
      (existingVersionId !== null || input.rejectUnavailableExpectedVersion)
    ) {
      throw new ConversationStoreError(
        "invalid_state",
        "Attachment snapshot is not owned, has no evidence, or does not belong to this source",
      );
    }
    return null;
  }

  if (existingVersionId === null) {
    await execute(target, {
      sql: `UPDATE assistant_attachments SET snapshotVersion = ?
        WHERE id = ? AND snapshotVersion IS NULL`,
      args: [candidate.versionId, input.attachmentId],
    });
  }
  const winner = await one(
    target,
    `SELECT snapshotVersion FROM assistant_attachments
      WHERE id = ? LIMIT 1`,
    [input.attachmentId],
  );
  const winnerVersionId = nullString(winner?.snapshotVersion);
  if (!winnerVersionId) return null;
  const winnerCandidate =
    winnerVersionId === candidate.versionId
      ? candidate
      : await attachmentSnapshotCandidate(target, {
          ownerId: input.ownerId,
          identity,
          requestedVersionId: winnerVersionId,
        });
  if (!winnerCandidate) {
    throw new ConversationStoreError(
      "invalid_state",
      "The frozen attachment snapshot is no longer reachable",
    );
  }
  await createAttachmentVersionReference(target, {
    ownerId: input.ownerId,
    attachmentId: input.attachmentId,
    candidate: winnerCandidate,
    now: sqlTimestamp(),
  });
  return winnerCandidate.versionId;
}

async function cloneMessageAttachmentsInTransaction(
  target: AssistantSqlClient | Transaction,
  input: {
    ownerId: string;
    threadId: string;
    sourceMessageId: string;
    targetMessageId: string;
    now: number;
  },
): Promise<Set<string>> {
  const sourceMessage = await one(
    target,
    `SELECT messages.id, messages.role
      FROM assistant_messages AS messages
      JOIN assistant_threads AS threads ON threads.id = messages.threadId
      WHERE messages.id = ? AND messages.threadId = ?
        AND threads.userId = ? AND threads.deletedAt IS NULL LIMIT 1`,
    [input.sourceMessageId, input.threadId, input.ownerId],
  );
  if (!sourceMessage || sourceMessage.role !== "user") {
    throw new ConversationStoreError(
      "invalid_state",
      "Only an owned user message can provide preserved attachments",
    );
  }
  const sourceRows = await execute(target, {
    sql: `SELECT * FROM assistant_attachments
      WHERE messageId = ? ORDER BY createdAt, id`,
    args: [input.sourceMessageId],
  });
  const identities = new Set<string>();
  for (const source of sourceRows.rows as Row[]) {
    const kind = source.kind as AssistantAttachmentKind;
    const referenceId = String(source.referenceId);
    const snapshotVersion = nullString(source.snapshotVersion);
    assertAttachmentSnapshotInput(kind, snapshotVersion);
    if (kind === "task") {
      const frozenFields = [
        source.frozenPayloadVersion,
        source.frozenPayloadJson,
        source.frozenPayloadDigest,
        source.frozenSourceRevision,
      ];
      const hasAnyFrozenField = frozenFields.some(
        (value) => value !== null && value !== undefined,
      );
      if (hasAnyFrozenField && !frozenTaskSnapshotFromRow(source)) {
        throw new ConversationStoreError(
          "invalid_state",
          "The historical task attachment snapshot is incomplete",
        );
      }
    }
    const attachmentId = newId("aatt");
    await execute(target, {
      sql: `INSERT INTO assistant_attachments
        (id, messageId, kind, referenceId, snapshotVersion,
         frozenPayloadVersion, frozenPayloadJson, frozenPayloadDigest,
         frozenSourceRevision, label, fileId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        attachmentId,
        input.targetMessageId,
        kind,
        referenceId,
        snapshotVersion,
        source.frozenPayloadVersion ?? null,
        source.frozenPayloadJson ?? null,
        source.frozenPayloadDigest ?? null,
        source.frozenSourceRevision ?? null,
        String(source.label),
        source.fileId ?? null,
        input.now,
      ],
    });
    const references = await execute(target, {
      sql: `SELECT * FROM content_version_references
        WHERE userId = ? AND ownerKind = 'assistant-citation'
          AND ownerId = ? ORDER BY id`,
      args: [input.ownerId, String(source.id)],
    });
    for (const reference of references.rows as Row[]) {
      await execute(target, {
        sql: `INSERT INTO content_version_references (
            id, userId, ownerKind, ownerId, sourceVersionId, chunkId,
            locatorSchemaVersion, locatorJson, quotedContentHash,
            referenceKey, createdAt
          ) VALUES (?, ?, 'assistant-citation', ?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          newId("cref"),
          input.ownerId,
          attachmentId,
          reference.sourceVersionId,
          reference.chunkId ?? null,
          reference.locatorSchemaVersion,
          reference.locatorJson,
          reference.quotedContentHash ?? null,
          reference.referenceKey,
          input.now,
        ],
      });
    }
    // Repair a missing legacy GC edge only from the already-frozen exact
    // version. This path never consults the current source head.
    if (snapshotVersion !== null && attachmentSupportsCorpusSnapshot(kind)) {
      await freezeAttachmentSnapshotInTransaction(target, {
        ownerId: input.ownerId,
        attachmentId,
        expectedVersionId: snapshotVersion,
        rejectUnavailableExpectedVersion: true,
      });
    }
    identities.add(attachmentIdentityKey({ kind, referenceId }));
  }
  return identities;
}

async function ownedThread(
  target: AssistantSqlClient | Transaction,
  ownerId: string,
  threadId: string,
  includeDeleted = false,
): Promise<Row> {
  const row = await one(
    target,
    `SELECT * FROM assistant_threads
     WHERE id = ? AND userId = ? ${includeDeleted ? "" : "AND deletedAt IS NULL"}
     LIMIT 1`,
    [threadId, ownerId],
  );
  if (!row) throw new ConversationStoreError("not_found", "Thread not found");
  return row;
}

async function ownedRun(
  target: AssistantSqlClient | Transaction,
  ownerId: string,
  runId: string,
): Promise<Row> {
  const row = await one(
    target,
    `SELECT r.*, t.placement AS threadPlacement,
       t.placementRef AS threadPlacementRef FROM assistant_runs r
     JOIN assistant_threads t ON t.id = r.threadId
     WHERE r.id = ? AND r.userId = ? AND t.userId = ? LIMIT 1`,
    [runId, ownerId, ownerId],
  );
  if (!row) throw new ConversationStoreError("not_found", "Run not found");
  return row;
}

function textParts(
  markdown: string,
  config?: { skillId?: string | null; planMode?: boolean },
): AssistantPartV1[] {
  return [
    assistantPartV1Schema.parse({
      type: "text",
      id: newId("apart"),
      markdown,
    }),
    ...(config
      ? [
          assistantPartV1Schema.parse({
            type: "run-config",
            id: newId("apart"),
            skillId: config.skillId ?? null,
            planMode: config.planMode ?? false,
          }),
        ]
      : []),
  ];
}

function activePath(
  branch: AssistantBranch | undefined,
  messages: readonly AssistantMessage[],
): string[] {
  const byId = new Map(messages.map((message) => [message.id, message]));
  const reversed: string[] = [];
  const seen = new Set<string>();
  let cursor = branch?.headMessageId ?? null;
  while (cursor) {
    if (seen.has(cursor)) {
      throw new ConversationStoreError(
        "invalid_state",
        "Conversation DAG is cyclic",
      );
    }
    seen.add(cursor);
    reversed.push(cursor);
    cursor = byId.get(cursor)?.parentMessageId ?? null;
  }
  return reversed.reverse();
}

export class CoreConversationStore {
  constructor(
    private readonly client: AssistantSqlClient,
    private readonly scheduleConversationIndex?: (input: {
      ownerId: string;
      threadId: string;
      selector?: {
        conversationBranchId: string;
        conversationHeadMessageId: string;
      };
      projectItemId?: string;
    }) => Promise<void>,
    private readonly nodePayloadCodec?: NodeConversationPayloadCodec,
  ) {}

  private storedParts(
    thread: Row,
    ownerId: string,
    threadId: string,
    messageId: string,
    role: "user" | "assistant" | "system" | "tool",
    parentMessageId: string | null,
    parts: AssistantPartV1[],
  ) {
    if (thread.placement !== "node") return parts;
    if (!this.nodePayloadCodec || !thread.placementRef) {
      throw new ConversationStoreError(
        "placement_unavailable",
        "Node conversation envelope encryption is unavailable",
      );
    }
    return this.nodePayloadCodec.sealParts({
      ownerId,
      nodeId: String(thread.placementRef),
      threadId,
      messageId,
      role,
      parentMessageId,
      parts,
    });
  }

  private storedEventPayload(run: Row, eventId: string, payload: unknown) {
    if (run.threadPlacement !== "node") return payload;
    if (!this.nodePayloadCodec || !run.threadPlacementRef) {
      throw new ConversationStoreError(
        "placement_unavailable",
        "Node conversation envelope encryption is unavailable",
      );
    }
    return this.nodePayloadCodec.sealEvent({
      ownerId: String(run.userId),
      nodeId: String(run.threadPlacementRef),
      threadId: String(run.threadId),
      runId: String(run.id),
      eventId,
      payload,
    });
  }

  private openedParts(
    run: Row,
    ownerId: string,
    threadId: string,
    messageId: string,
    role: "user" | "assistant" | "system" | "tool",
    parentMessageId: string | null,
    parts: AssistantPartV1[],
  ) {
    if (run.threadPlacement !== "node") return parts;
    if (!this.nodePayloadCodec || !run.threadPlacementRef) {
      throw new ConversationStoreError(
        "placement_unavailable",
        "Node conversation envelope decryption is unavailable",
      );
    }
    return this.nodePayloadCodec.openParts({
      ownerId,
      nodeId: String(run.threadPlacementRef),
      threadId,
      messageId,
      role,
      parentMessageId,
      parts,
    });
  }

  private async registerConversationSource(
    executor: AssistantSqlClient | Transaction,
    ownerId: string,
    threadId: string,
    now: number,
  ) {
    const sourceId = `csrc_conv_${sha256(`${ownerId}\0${threadId}`).slice(0, 24)}`;
    await execute(executor, {
      sql: `INSERT INTO content_sources
        (id, userId, yearId, subjectId, originKind, originId, status,
         coverage, placement, createdAt, updatedAt)
        SELECT ?, threads.userId, projects.yearId, projects.subjectId,
          'conversation', threads.id, 'registered',
          'searchable-native-text', 'core', ?, ?
        FROM assistant_threads AS threads
        LEFT JOIN study_projects AS projects
          ON projects.id = threads.projectId AND projects.userId = threads.userId
        WHERE threads.id = ? AND threads.userId = ?
        ON CONFLICT(userId, originKind, originId) DO UPDATE SET
          yearId = excluded.yearId,
          subjectId = excluded.subjectId,
          status = CASE
            WHEN content_sources.currentVersionId IS NULL THEN 'registered'
            ELSE content_sources.status
          END,
          error = NULL,
          updatedAt = excluded.updatedAt`,
      args: [sourceId, now, now, threadId, ownerId],
    });
  }

  private async enqueueConversationIndex(
    ownerId: string,
    threadId: string,
    selector?: {
      conversationBranchId: string;
      conversationHeadMessageId: string;
    },
    projectItemId?: string,
  ) {
    if (!this.scheduleConversationIndex) return;
    await this.scheduleConversationIndex({
      ownerId,
      threadId,
      selector,
      projectItemId,
    }).catch((error) => {
      console.error(
        "[assistant] conversation indexing enqueue failed",
        error instanceof Error ? error.message : "Unknown queue error",
      );
    });
  }

  async createThread(input: {
    ownerId: string;
    title?: string;
    projectId?: string | null;
    placement?: "core" | "node";
    nodeId?: string;
  }): Promise<{ thread: AssistantThread; branch: AssistantBranch }> {
    if (input.placement === "node" && !input.nodeId) {
      throw new ConversationStoreError(
        "placement_unavailable",
        "A verified Node conversation placement is required",
      );
    }
    const threadId = newId("athr");
    const branchId = newId("abrn");
    const now = sqlTimestamp();
    const transaction = await this.client.transaction("write");
    try {
      if (input.projectId) {
        const project = await one(
          transaction,
          `SELECT id FROM study_projects
           WHERE id = ? AND userId = ? AND deletedAt IS NULL LIMIT 1`,
          [input.projectId, input.ownerId],
        );
        if (!project) {
          throw new ConversationStoreError(
            "forbidden",
            "The study project is not owned by this account",
          );
        }
      }
      await execute(transaction, {
        sql: `INSERT INTO assistant_threads
          (id, userId, title, revision, projectId, placement, placementRef,
           createdAt, updatedAt)
          VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        args: [
          threadId,
          input.ownerId,
          input.title?.trim() || "Nouvelle conversation",
          input.projectId ?? null,
          input.placement ?? "core",
          input.placement === "node" ? input.nodeId! : null,
          now,
          now,
        ],
      });
      await execute(transaction, {
        sql: `INSERT INTO assistant_branches
          (id, threadId, name, createdAt, updatedAt)
          VALUES (?, ?, 'Principal', ?, ?)`,
        args: [branchId, threadId, now, now],
      });
      await execute(transaction, {
        sql: `UPDATE assistant_threads SET activeBranchId = ? WHERE id = ?`,
        args: [branchId, threadId],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    const thread = await this.thread(input.ownerId, threadId);
    const branchRow = await one(
      this.client,
      `SELECT * FROM assistant_branches WHERE id = ?`,
      [branchId],
    );
    return { thread, branch: branchFromRow(branchRow!) };
  }

  async thread(ownerId: string, threadId: string, includeDeleted = false) {
    return threadFromRow(
      await ownedThread(this.client, ownerId, threadId, includeDeleted),
    );
  }

  async listThreads(input: {
    ownerId: string;
    projectId?: string;
    cursor?: string | null;
    limit?: number;
    includeArchived?: boolean;
    includeDeleted?: boolean;
    starredOnly?: boolean;
    query?: string;
  }): Promise<{ items: AssistantThreadListItem[]; nextCursor: string | null }> {
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    const cursor = input.cursor
      ? Number(input.cursor)
      : Number.MAX_SAFE_INTEGER;
    const clauses = ["t.userId = ?", "t.updatedAt < ?"];
    const args: Array<string | number> = [input.ownerId, cursor];
    const selectArgs: Array<string | number> = [];
    let matchedMessagePreviewSql = "NULL";
    if (!input.includeDeleted) clauses.push("t.deletedAt IS NULL");
    if (!input.includeArchived) clauses.push("t.archivedAt IS NULL");
    if (input.starredOnly) clauses.push("t.starredAt IS NOT NULL");
    if (input.projectId) {
      clauses.push("t.projectId = ?");
      args.push(input.projectId);
    }
    if (input.query?.trim()) {
      clauses.push(`(lower(t.title) LIKE ? OR EXISTS (
        SELECT 1 FROM assistant_messages sm, json_each(sm.partsJson) AS part
        WHERE sm.threadId = t.id AND sm.status = 'complete'
          AND sm.role IN ('user', 'assistant')
          AND json_extract(part.value, '$.type') = 'text'
          AND lower(CAST(json_extract(part.value, '$.markdown') AS TEXT)) LIKE ?
      ))`);
      const query = `%${input.query.trim().toLocaleLowerCase()}%`;
      args.push(query, query);
      selectArgs.push(query);
      matchedMessagePreviewSql = `(SELECT substr(
          CAST(json_extract(part.value, '$.markdown') AS TEXT), 1, 500)
        FROM assistant_messages sm, json_each(sm.partsJson) AS part
        WHERE sm.threadId = t.id AND sm.status = 'complete'
          AND sm.role IN ('user', 'assistant')
          AND json_extract(part.value, '$.type') = 'text'
          AND lower(CAST(json_extract(part.value, '$.markdown') AS TEXT)) LIKE ?
        ORDER BY sm.createdAt DESC, sm.id DESC LIMIT 1)`;
    }
    const result = await this.client.execute({
      sql: `SELECT t.*,
        (SELECT count(*) FROM assistant_messages m WHERE m.threadId = t.id) AS messageCount,
        (SELECT max(m.createdAt) FROM assistant_messages m WHERE m.threadId = t.id) AS lastMessageAt,
        (SELECT r.id FROM assistant_runs r WHERE r.threadId = t.id
          AND r.status IN ('reserved','running','waiting-for-user')
          ORDER BY r.createdAt DESC LIMIT 1) AS activeRunId,
        ${matchedMessagePreviewSql} AS matchedMessagePreview
        FROM assistant_threads t
        WHERE ${clauses.join(" AND ")}
        ORDER BY t.updatedAt DESC, t.id DESC LIMIT ?`,
      args: [...selectArgs, ...args, limit + 1],
    });
    const rows = result.rows.slice(0, limit);
    const items = rows.map((row) =>
      assistantThreadListItemSchema.parse({
        thread: threadFromRow(row),
        messageCount: Number(row.messageCount),
        lastMessageAt:
          row.lastMessageAt === null ? null : isoFromSqlite(row.lastMessageAt),
        activeRunId: nullString(row.activeRunId),
        matchedMessagePreview: nullString(row.matchedMessagePreview),
      }),
    );
    return {
      items,
      nextCursor:
        result.rows.length > limit && rows.at(-1)
          ? String(rows.at(-1)!.updatedAt)
          : null,
    };
  }

  async getThreadDetail(
    ownerId: string,
    threadId: string,
    branchId?: string | null,
    expectedProjectId?: string,
  ): Promise<AssistantThreadDetail> {
    const thread = await this.thread(ownerId, threadId, true);
    if (
      expectedProjectId !== undefined &&
      thread.projectId !== expectedProjectId
    ) {
      // Use not_found so a project-scoped deep link cannot probe membership in
      // another project, even when the caller owns both conversations.
      throw new ConversationStoreError("not_found", "Thread not found");
    }
    const [
      branchRows,
      messageRows,
      runRows,
      citationRows,
      attachmentRows,
      usageRows,
    ] = await Promise.all([
      this.client.execute({
        sql: `SELECT * FROM assistant_branches WHERE threadId = ? ORDER BY createdAt, id`,
        args: [threadId],
      }),
      this.client.execute({
        sql: `SELECT * FROM assistant_messages WHERE threadId = ? ORDER BY createdAt, id`,
        args: [threadId],
      }),
      this.client.execute({
        sql: `SELECT * FROM assistant_runs WHERE threadId = ? ORDER BY createdAt, id`,
        args: [threadId],
      }),
      this.client.execute({
        sql: `SELECT c.* FROM assistant_citations c
            JOIN assistant_runs r ON r.id = c.runId WHERE r.threadId = ?
            ORDER BY c.messageId, c.ordinal`,
        args: [threadId],
      }),
      this.client.execute({
        sql: `SELECT a.* FROM assistant_attachments a
            JOIN assistant_messages m ON m.id = a.messageId WHERE m.threadId = ?
            ORDER BY a.createdAt, a.id`,
        args: [threadId],
      }),
      this.client.execute({
        sql: `SELECT u.* FROM assistant_usage u
            JOIN assistant_runs r ON r.id = u.runId WHERE r.threadId = ?
            ORDER BY u.createdAt, u.runId`,
        args: [threadId],
      }),
    ]);
    const branches = branchRows.rows.map(branchFromRow);
    const messages = messageRows.rows.map(messageFromRow);
    const selectedBranchId = branchId ?? thread.activeBranchId;
    const selected = branches.find((branch) => branch.id === selectedBranchId);
    if (selectedBranchId && !selected) {
      throw new ConversationStoreError("not_found", "Branch not found");
    }
    const runs = runRows.rows.map(runFromRow);
    const activeRunProjections = [];
    for (const run of runs.filter((candidate) =>
      ["reserved", "running", "waiting-for-user"].includes(candidate.status),
    )) {
      const eventRows = await this.client.execute({
        sql: `SELECT e.*, r.threadId, r.branchId FROM assistant_run_events e
          JOIN assistant_runs r ON r.id = e.runId
          WHERE e.runId = ? ORDER BY e.sequence`,
        args: [run.id],
      });
      const events = eventRows.rows.map(eventFromRow);
      const markdown = events
        .filter((event) => event.type === "text.message.delta")
        .map((event) => {
          const payload = event.payload as { delta?: unknown };
          return typeof payload?.delta === "string" ? payload.delta : "";
        })
        .join("");
      const parts: AssistantPartV1[] = markdown
        ? [{ type: "text", id: `stream-${run.id}`, markdown }]
        : [
            {
              type: "status",
              id: `stream-${run.id}`,
              state: run.status === "reserved" ? "pending" : "active",
              label:
                run.status === "waiting-for-user"
                  ? "Waiting for your reply"
                  : "Responding",
            },
          ];
      activeRunProjections.push({
        runId: run.id,
        outputMessageId: run.reservedOutputMessageId,
        parts,
        lastSequence: events.at(-1)?.sequence ?? 0,
        status: run.status,
      });
    }
    return assistantThreadDetailSchema.parse({
      thread,
      branches,
      activeBranchId: selectedBranchId,
      activePathMessageIds: activePath(selected, messages),
      messages,
      runs,
      citations: citationRows.rows.map(citationFromRow),
      attachments: attachmentRows.rows.map(attachmentFromRow),
      usage: usageRows.rows.map(usageFromRow),
      manifests: await this.manifests(ownerId, threadId),
      activeRunProjections,
    });
  }

  async messageParts(ownerId: string, threadId: string, messageId: string) {
    await ownedThread(this.client, ownerId, threadId);
    const row = await one(
      this.client,
      `SELECT partsJson FROM assistant_messages WHERE id = ? AND threadId = ? LIMIT 1`,
      [messageId, threadId],
    );
    if (!row)
      throw new ConversationStoreError("not_found", "Message not found");
    return assistantPartV1Schema.array().parse(jsonValue(row.partsJson));
  }

  /**
   * Resolve the exact ancestor chain of a run input. Sibling messages and the
   * current input are deliberately excluded, so retries and edited branches
   * receive the same deterministic history they were based on.
   */
  async historyBeforeMessage(
    ownerId: string,
    threadId: string,
    messageId: string,
  ): Promise<AssistantMessage[]> {
    const detail = await this.getThreadDetail(ownerId, threadId);
    const byId = new Map(
      detail.messages.map((message) => [message.id, message] as const),
    );
    const current = byId.get(messageId);
    if (!current) {
      throw new ConversationStoreError("not_found", "Message not found");
    }
    const reversed: AssistantMessage[] = [];
    const seen = new Set<string>([messageId]);
    let cursor = current.parentMessageId;
    while (cursor) {
      if (seen.has(cursor)) {
        throw new ConversationStoreError(
          "invalid_state",
          "Conversation DAG is cyclic",
        );
      }
      seen.add(cursor);
      const message = byId.get(cursor);
      if (!message) {
        throw new ConversationStoreError(
          "invalid_state",
          "Conversation history is incomplete",
        );
      }
      reversed.push(message);
      cursor = message.parentMessageId;
    }
    return reversed.reverse();
  }

  async reserveTurn(input: {
    ownerId: string;
    threadId: string;
    branchId: string;
    expectedHeadMessageId: string | null;
    clientRequestId: string;
    markdown: string;
    modelKey: string;
    providerKey?: string;
    modelPolicy?: AssistantRunModelPolicy;
    approvalMode?: "read-only" | "confirm-writes" | "auto-reversible";
    forkOnConflict?: boolean;
    replacesMessageId?: string | null;
    attachments?: AssistantAttachmentInput[];
    /** Internal edit fence: preserve this message's exact attachment rows. */
    preserveAttachmentsFromMessageId?: string;
    skillId?: string | null;
    planMode?: boolean;
    workspaceSnapshotRef?: string | null;
    createBranch?: {
      id: string;
      name: string;
      forkedFromMessageId: string | null;
    };
  }): Promise<TurnReservation> {
    const transaction = await this.client.transaction("write");
    try {
      const owned = await ownedThread(
        transaction,
        input.ownerId,
        input.threadId,
      );
      const duplicate = await one(
        transaction,
        `SELECT * FROM assistant_runs WHERE threadId = ? AND clientRequestId = ? LIMIT 1`,
        [input.threadId, input.clientRequestId],
      );
      if (duplicate) {
        if (
          nullString(duplicate.workspaceSnapshotRef) !==
          (input.workspaceSnapshotRef ?? null)
        ) {
          throw new ConversationStoreError(
            "divergent_replay",
            "The request id was already used with a different workspace branch choice",
          );
        }
        await transaction.commit();
        return {
          threadId: String(duplicate.threadId),
          branchId: String(duplicate.branchId),
          userMessageId: String(duplicate.inputMessageId),
          runId: String(duplicate.id),
          reservedOutputMessageId: String(duplicate.reservedOutputMessageId),
          idempotent: true,
        };
      }
      const now = sqlTimestamp();
      if (input.createBranch) {
        if (
          input.createBranch.id !== input.branchId ||
          input.createBranch.forkedFromMessageId !==
            input.expectedHeadMessageId ||
          !input.createBranch.name.trim()
        ) {
          throw new ConversationStoreError(
            "invalid_state",
            "The explicit branch boundary is invalid",
          );
        }
        if (input.expectedHeadMessageId) {
          const boundary = await one(
            transaction,
            `SELECT id FROM assistant_messages WHERE id = ? AND threadId = ? LIMIT 1`,
            [input.expectedHeadMessageId, input.threadId],
          );
          if (!boundary) {
            throw new ConversationStoreError(
              "head_conflict",
              "The requested branch boundary is not in this thread",
            );
          }
        }
        await execute(transaction, {
          sql: `INSERT INTO assistant_branches
            (id, threadId, name, forkedFromMessageId, headMessageId, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            input.createBranch.id,
            input.threadId,
            input.createBranch.name.trim(),
            input.createBranch.forkedFromMessageId,
            input.expectedHeadMessageId,
            now,
            now,
          ],
        });
      }
      const branch = await one(
        transaction,
        `SELECT * FROM assistant_branches WHERE id = ? AND threadId = ? LIMIT 1`,
        [input.branchId, input.threadId],
      );
      if (!branch)
        throw new ConversationStoreError("not_found", "Branch not found");
      let targetBranchId = input.branchId;
      const currentHead = nullString(branch.headMessageId);
      if (currentHead !== input.expectedHeadMessageId) {
        if (!input.forkOnConflict) {
          throw new ConversationStoreError(
            "head_conflict",
            "The branch head changed; reload or explicitly create a sibling",
          );
        }
        if (input.expectedHeadMessageId) {
          const expected = await one(
            transaction,
            `SELECT id FROM assistant_messages WHERE id = ? AND threadId = ?`,
            [input.expectedHeadMessageId, input.threadId],
          );
          if (!expected) {
            throw new ConversationStoreError(
              "head_conflict",
              "The requested sibling base is not in this thread",
            );
          }
        }
        targetBranchId = newId("abrn");
        await execute(transaction, {
          sql: `INSERT INTO assistant_branches
            (id, threadId, name, forkedFromMessageId, headMessageId, createdAt, updatedAt)
            VALUES (?, ?, 'Branche concurrente', ?, ?, ?, ?)`,
          args: [
            targetBranchId,
            input.threadId,
            input.expectedHeadMessageId,
            input.expectedHeadMessageId,
            now,
            now,
          ],
        });
      }
      const active = await one(
        transaction,
        `SELECT id FROM assistant_runs WHERE branchId = ?
          AND status IN ('reserved','running','waiting-for-user','waiting-approval','cancelling') LIMIT 1`,
        [targetBranchId],
      );
      if (active) {
        throw new ConversationStoreError(
          "active_run",
          "This branch already has an active run",
        );
      }
      const messageId = newId("amsg");
      const runId = newId("arun");
      const outputId = newId("amsg");
      const domainCursorRef = await currentDomainCursorRef(
        transaction,
        input.ownerId,
      );
      await execute(transaction, {
        sql: `INSERT INTO assistant_messages
          (id, threadId, parentMessageId, role, authorship, status,
           partsVersion, partsJson, replacesMessageId, createdAt)
          VALUES (?, ?, ?, 'user', 'user', 'complete', 1, ?, ?, ?)`,
        args: [
          messageId,
          input.threadId,
          input.expectedHeadMessageId,
          canonicalJson(
            this.storedParts(
              owned,
              input.ownerId,
              input.threadId,
              messageId,
              "user",
              input.expectedHeadMessageId,
              textParts(input.markdown, {
                skillId: input.skillId,
                planMode: input.planMode,
              }),
            ),
          ),
          input.replacesMessageId ?? null,
          now,
        ],
      });
      const attachmentIdentities = input.preserveAttachmentsFromMessageId
        ? await cloneMessageAttachmentsInTransaction(transaction, {
            ownerId: input.ownerId,
            threadId: input.threadId,
            sourceMessageId: input.preserveAttachmentsFromMessageId,
            targetMessageId: messageId,
            now,
          })
        : new Set<string>();
      if (attachmentIdentities.size > MAX_ASSISTANT_MESSAGE_ATTACHMENTS) {
        throw new ConversationStoreError(
          "invalid_state",
          "A message cannot contain more than 50 attachments",
        );
      }
      for (const attachment of input.attachments ?? []) {
        const identity = attachmentIdentityKey(attachment);
        // The historical attachment wins when an edit explicitly reattaches
        // the same domain reference. This deduplicates without ever replacing
        // its immutable snapshot with a newer client-supplied version.
        if (attachmentIdentities.has(identity)) continue;
        if (attachmentIdentities.size >= MAX_ASSISTANT_MESSAGE_ATTACHMENTS) {
          throw new ConversationStoreError(
            "invalid_state",
            "A message cannot contain more than 50 attachments",
          );
        }
        attachmentIdentities.add(identity);
        assertAttachmentSnapshotInput(
          attachment.kind,
          attachment.snapshotVersion,
        );
        const attachmentId = newId("aatt");
        await execute(transaction, {
          sql: `INSERT INTO assistant_attachments
            (id, messageId, kind, referenceId, snapshotVersion, label, fileId, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            attachmentId,
            messageId,
            attachment.kind,
            attachment.referenceId,
            attachment.snapshotVersion ?? null,
            attachment.label,
            attachment.kind === "file" ? attachment.referenceId : null,
            now,
          ],
        });
        await freezeAttachmentSnapshotInTransaction(transaction, {
          ownerId: input.ownerId,
          attachmentId,
          expectedVersionId: attachment.snapshotVersion ?? null,
          rejectUnavailableExpectedVersion:
            attachment.snapshotVersion !== undefined &&
            attachment.snapshotVersion !== null,
        });
        if (attachment.kind === "task") {
          await freezeTaskAttachmentSnapshotInTransaction(transaction, {
            ownerId: input.ownerId,
            attachmentId,
            rejectUnavailable: true,
          });
        }
      }
      await execute(transaction, {
        sql: `INSERT INTO assistant_runs
          (id, userId, threadId, branchId, inputMessageId, reservedOutputMessageId,
           clientRequestId, workspaceSnapshotRef, runtimeId, runtimeVersion, graphSchemaVersion,
           modelKey, providerKey, modelPolicyJson, status, approvalMode,
           providerDispatchState, domainCursorRef,
           createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'avermate-agent-runtime', '1', 1,
            ?, ?, ?, 'reserved', ?, 'pending', ?, ?, ?)`,
        args: [
          runId,
          input.ownerId,
          input.threadId,
          targetBranchId,
          messageId,
          outputId,
          input.clientRequestId,
          input.workspaceSnapshotRef ?? null,
          input.modelKey,
          input.providerKey ?? "mock",
          input.modelPolicy ? canonicalJson(input.modelPolicy) : null,
          input.approvalMode ?? "read-only",
          domainCursorRef,
          now,
          now,
        ],
      });
      const headUpdate = await execute(transaction, {
        sql: `UPDATE assistant_branches SET headMessageId = ?, updatedAt = ?
          WHERE id = ? AND headMessageId IS ?`,
        args: [messageId, now, targetBranchId, input.expectedHeadMessageId],
      });
      if (headUpdate.rowsAffected !== 1) {
        throw new ConversationStoreError(
          "head_conflict",
          "Branch head changed",
        );
      }
      await execute(transaction, {
        sql: `UPDATE assistant_threads SET activeBranchId = ?, revision = revision + 1,
          updatedAt = ? WHERE id = ?`,
        args: [targetBranchId, now, input.threadId],
      });
      await transaction.commit();
      return {
        threadId: input.threadId,
        branchId: targetBranchId,
        userMessageId: messageId,
        runId,
        reservedOutputMessageId: outputId,
        idempotent: false,
      };
    } catch (error) {
      await transaction.rollback();
      if (
        error instanceof Error &&
        error.message.includes("assistant_runs_branch_active_unique")
      ) {
        throw new ConversationStoreError(
          "active_run",
          "This branch already has an active run",
        );
      }
      throw error;
    }
  }

  async reserveRetry(input: {
    ownerId: string;
    messageId: string;
    clientRequestId: string;
    modelKey?: string;
    providerKey?: string;
    modelPolicy?: AssistantRunModelPolicy;
    approvalMode?: "read-only" | "confirm-writes" | "auto-reversible";
    destinationBranchId?: string;
    workspaceSnapshotRef?: string | null;
  }): Promise<TurnReservation> {
    const transaction = await this.client.transaction("write");
    try {
      const message = await one(
        transaction,
        `SELECT m.*, t.userId FROM assistant_messages m
         JOIN assistant_threads t ON t.id = m.threadId
         WHERE m.id = ? AND t.userId = ? AND t.deletedAt IS NULL LIMIT 1`,
        [input.messageId, input.ownerId],
      );
      if (
        !message ||
        message.role !== "assistant" ||
        !message.parentMessageId
      ) {
        throw new ConversationStoreError(
          "not_found",
          "Retryable message not found",
        );
      }
      const duplicate = await one(
        transaction,
        `SELECT * FROM assistant_runs WHERE threadId = ? AND clientRequestId = ?`,
        [message.threadId, input.clientRequestId],
      );
      if (duplicate) {
        if (
          nullString(duplicate.workspaceSnapshotRef) !==
          (input.workspaceSnapshotRef ?? null)
        ) {
          throw new ConversationStoreError(
            "divergent_replay",
            "The request id was already used with a different workspace branch choice",
          );
        }
        await transaction.commit();
        return {
          threadId: String(duplicate.threadId),
          branchId: String(duplicate.branchId),
          userMessageId: String(duplicate.inputMessageId),
          runId: String(duplicate.id),
          reservedOutputMessageId: String(duplicate.reservedOutputMessageId),
          idempotent: true,
        };
      }
      const previousRun = await one(
        transaction,
        `SELECT * FROM assistant_runs WHERE outputMessageId = ? LIMIT 1`,
        [input.messageId],
      );
      const branchId = input.destinationBranchId ?? newId("abrn");
      const runId = newId("arun");
      const outputId = newId("amsg");
      const now = sqlTimestamp();
      const domainCursorRef = await currentDomainCursorRef(
        transaction,
        input.ownerId,
      );
      await execute(transaction, {
        sql: `INSERT INTO assistant_branches
          (id, threadId, name, forkedFromMessageId, headMessageId, createdAt, updatedAt)
          VALUES (?, ?, 'Nouvel essai', ?, ?, ?, ?)`,
        args: [
          branchId,
          message.threadId,
          message.parentMessageId,
          message.parentMessageId,
          now,
          now,
        ],
      });
      await execute(transaction, {
        sql: `INSERT INTO assistant_runs
          (id, userId, threadId, branchId, inputMessageId, reservedOutputMessageId,
           parentRunId, clientRequestId, workspaceSnapshotRef,
           runtimeId, runtimeVersion, graphSchemaVersion,
           modelKey, providerKey, modelPolicyJson, status, approvalMode,
           providerDispatchState, domainCursorRef,
           createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'avermate-agent-runtime', '1', 1,
            ?, ?, ?, 'reserved', ?, 'pending', ?, ?, ?)`,
        args: [
          runId,
          input.ownerId,
          message.threadId,
          branchId,
          message.parentMessageId,
          outputId,
          previousRun?.id ?? null,
          input.clientRequestId,
          input.workspaceSnapshotRef ?? null,
          input.modelKey ?? previousRun?.modelKey ?? "mock-readonly",
          input.providerKey ?? previousRun?.providerKey ?? "mock",
          input.modelPolicy
            ? canonicalJson(input.modelPolicy)
            : (previousRun?.modelPolicyJson ?? null),
          input.approvalMode ?? previousRun?.approvalMode ?? "read-only",
          domainCursorRef,
          now,
          now,
        ],
      });
      await execute(transaction, {
        sql: `UPDATE assistant_threads SET activeBranchId = ?, revision = revision + 1,
          updatedAt = ? WHERE id = ?`,
        args: [branchId, now, message.threadId],
      });
      await transaction.commit();
      return {
        threadId: String(message.threadId),
        branchId,
        userMessageId: String(message.parentMessageId),
        runId,
        reservedOutputMessageId: outputId,
        idempotent: false,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async editMessage(input: {
    ownerId: string;
    messageId: string;
    clientRequestId: string;
    markdown: string;
    modelKey: string;
    providerKey?: string;
    modelPolicy?: AssistantRunModelPolicy;
    approvalMode?: "read-only" | "confirm-writes" | "auto-reversible";
    destinationBranchId?: string;
    workspaceSnapshotRef?: string | null;
    attachments?: AssistantAttachmentInput[];
  }): Promise<EditedMessageProjection> {
    const row = await one(
      this.client,
      `SELECT m.*, t.userId, t.placement, t.placementRef FROM assistant_messages m
       JOIN assistant_threads t ON t.id = m.threadId
       WHERE m.id = ? AND t.userId = ? AND t.deletedAt IS NULL LIMIT 1`,
      [input.messageId, input.ownerId],
    );
    if (!row)
      throw new ConversationStoreError("not_found", "Message not found");
    if (row.role === "user") {
      const branchId = input.destinationBranchId ?? newId("abrn");
      return {
        kind: "run-reserved",
        reservation: await this.reserveTurn({
          ownerId: input.ownerId,
          threadId: String(row.threadId),
          branchId,
          expectedHeadMessageId: nullString(row.parentMessageId),
          clientRequestId: input.clientRequestId,
          markdown: input.markdown,
          modelKey: input.modelKey,
          providerKey: input.providerKey,
          modelPolicy: input.modelPolicy,
          approvalMode: input.approvalMode,
          attachments: input.attachments,
          preserveAttachmentsFromMessageId: input.messageId,
          replacesMessageId: input.messageId,
          workspaceSnapshotRef: input.workspaceSnapshotRef ?? null,
          createBranch: {
            id: branchId,
            name: "Message modifié",
            forkedFromMessageId: nullString(row.parentMessageId),
          },
        }),
      };
    }
    if (row.role !== "assistant") {
      throw new ConversationStoreError(
        "invalid_state",
        "This message cannot be edited",
      );
    }
    if (input.workspaceSnapshotRef) {
      throw new ConversationStoreError(
        "invalid_state",
        "Workspace copy is unavailable when curating an assistant response",
      );
    }
    const transaction = await this.client.transaction("write");
    try {
      const branchId = input.destinationBranchId ?? newId("abrn");
      const messageId = newId("amsg");
      const now = sqlTimestamp();
      await execute(transaction, {
        sql: `INSERT INTO assistant_messages
          (id, threadId, parentMessageId, role, authorship, status, partsVersion,
           partsJson, replacesMessageId, createdAt)
          VALUES (?, ?, ?, 'assistant', 'user-edited-model', 'complete', 1, ?, ?, ?)`,
        args: [
          messageId,
          row.threadId,
          row.parentMessageId,
          canonicalJson(
            this.storedParts(
              row,
              input.ownerId,
              String(row.threadId),
              messageId,
              "assistant",
              row.parentMessageId === null ? null : String(row.parentMessageId),
              textParts(input.markdown),
            ),
          ),
          input.messageId,
          now,
        ],
      });
      await execute(transaction, {
        sql: `INSERT INTO assistant_branches
          (id, threadId, name, forkedFromMessageId, headMessageId, createdAt, updatedAt)
          VALUES (?, ?, 'Réponse modifiée', ?, ?, ?, ?)`,
        args: [
          branchId,
          row.threadId,
          row.parentMessageId,
          messageId,
          now,
          now,
        ],
      });
      await execute(transaction, {
        sql: `UPDATE assistant_threads SET activeBranchId = ?, revision = revision + 1,
          updatedAt = ? WHERE id = ?`,
        args: [branchId, now, row.threadId],
      });
      await transaction.commit();
      return {
        kind: "user-curated-model",
        threadId: String(row.threadId),
        branchId,
        messageId,
      };
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async startRun(ownerId: string, runId: string): Promise<AssistantRun> {
    const transaction = await this.client.transaction("write");
    try {
      const run = await ownedRun(transaction, ownerId, runId);
      if (run.status !== "reserved" && run.status !== "running") {
        throw new ConversationStoreError(
          "invalid_state",
          "Run cannot be started",
        );
      }
      if (run.status === "reserved") {
        const now = sqlTimestamp();
        await execute(transaction, {
          sql: `UPDATE assistant_runs SET status = 'running', startedAt = ?,
            providerDispatchState = 'pending', updatedAt = ?
            WHERE id = ? AND status = 'reserved'`,
          args: [now, now, runId],
        });
        await this.appendEventInTransaction(transaction, run, {
          type: "run.started",
          payload: { approvalMode: String(run.approvalMode) },
          terminal: false,
          emittedAt: new Date(now * 1_000),
        });
      }
      const updated = await ownedRun(transaction, ownerId, runId);
      await transaction.commit();
      return runFromRow(updated);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async markProviderDispatch(input: {
    ownerId: string;
    runId: string;
    state: "dispatching" | "acknowledged" | "failed";
    providerRequestKey: string;
  }): Promise<AssistantRun> {
    const transaction = await this.client.transaction("write");
    try {
      const run = await ownedRun(transaction, input.ownerId, input.runId);
      if (run.status !== "running") {
        throw new ConversationStoreError(
          "invalid_state",
          "Only a running assistant turn can change provider dispatch state",
        );
      }
      if (
        run.providerRequestKey !== null &&
        String(run.providerRequestKey) !== input.providerRequestKey
      ) {
        throw new ConversationStoreError(
          "divergent_replay",
          "Provider request key is immutable once dispatch begins",
        );
      }
      const current = String(run.providerDispatchState);
      const allowed =
        current === input.state ||
        (current === "pending" && input.state === "dispatching") ||
        (current === "dispatching" &&
          (input.state === "acknowledged" || input.state === "failed"));
      if (!allowed) {
        throw new ConversationStoreError(
          "invalid_state",
          `Provider dispatch cannot move from ${current} to ${input.state}`,
        );
      }
      await execute(transaction, {
        sql: `UPDATE assistant_runs
          SET providerRequestKey = ?, providerDispatchState = ?, updatedAt = ?
          WHERE id = ? AND userId = ?`,
        args: [
          input.providerRequestKey,
          input.state,
          sqlTimestamp(),
          input.runId,
          input.ownerId,
        ],
      });
      const updated = await ownedRun(transaction, input.ownerId, input.runId);
      await transaction.commit();
      return runFromRow(updated);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async bindConversationCheckpoint(input: {
    ownerId: string;
    runId: string;
    checkpointId: string;
  }): Promise<AssistantRun> {
    const transaction = await this.client.transaction("write");
    try {
      const run = await ownedRun(transaction, input.ownerId, input.runId);
      const checkpoint = await one(
        transaction,
        `SELECT id FROM assistant_conversation_checkpoints
          WHERE id = ? AND userId = ? AND runId = ? AND threadId = ?
            AND branchId = ? AND status = 'committed' LIMIT 1`,
        [
          input.checkpointId,
          input.ownerId,
          input.runId,
          run.threadId,
          run.branchId,
        ],
      );
      if (!checkpoint) {
        throw new ConversationStoreError(
          "forbidden",
          "Conversation checkpoint is not a committed boundary of this run",
        );
      }
      if (
        run.conversationCheckpointRef !== null &&
        String(run.conversationCheckpointRef) !== input.checkpointId
      ) {
        const current = await one(
          transaction,
          `SELECT afterEventSequence FROM assistant_conversation_checkpoints
            WHERE id = ? AND userId = ? LIMIT 1`,
          [run.conversationCheckpointRef, input.ownerId],
        );
        const next = await one(
          transaction,
          `SELECT afterEventSequence FROM assistant_conversation_checkpoints
            WHERE id = ? AND userId = ? LIMIT 1`,
          [input.checkpointId, input.ownerId],
        );
        if (
          !current ||
          !next ||
          Number(next.afterEventSequence) < Number(current.afterEventSequence)
        ) {
          throw new ConversationStoreError(
            "invalid_state",
            "Conversation checkpoint cannot move backwards",
          );
        }
      }
      await execute(transaction, {
        sql: `UPDATE assistant_runs SET conversationCheckpointRef = ?, updatedAt = ?
          WHERE id = ? AND userId = ?`,
        args: [input.checkpointId, sqlTimestamp(), input.runId, input.ownerId],
      });
      const updated = await ownedRun(transaction, input.ownerId, input.runId);
      await transaction.commit();
      return runFromRow(updated);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async appendEventInTransaction(
    transaction: Transaction,
    run: Row,
    input: {
      type: string;
      payload: unknown;
      terminal?: boolean;
      emittedAt?: Date;
      eventId?: string;
    },
  ): Promise<AssistantEventProjection> {
    const latest = await one(
      transaction,
      `SELECT max(sequence) AS sequence FROM assistant_run_events WHERE runId = ?`,
      [run.id],
    );
    const sequence = Number(latest?.sequence ?? 0) + 1;
    const emittedAt = Math.floor(
      (input.emittedAt ?? new Date()).getTime() / 1_000,
    );
    const persistedAt = sqlTimestamp();
    const eventId = input.eventId ?? newId("aevt");
    const event = avermateAgentEventV1Schema.parse({
      protocolVersion: 1,
      eventId,
      sequence,
      threadId: String(run.threadId),
      branchId: String(run.branchId),
      runId: String(run.id),
      emittedAt: new Date(emittedAt * 1_000).toISOString(),
      type: input.type,
      payload: input.payload,
      terminal: input.terminal ?? false,
    });
    await execute(transaction, {
      sql: `INSERT INTO assistant_run_events
        (id, runId, sequence, eventId, type, payloadJson, terminal, emittedAt, persistedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        newId("aevtrow"),
        run.id,
        sequence,
        eventId,
        event.type,
        canonicalJson(
          this.storedEventPayload(run, event.eventId, event.payload),
        ),
        event.terminal ? 1 : 0,
        emittedAt,
        persistedAt,
      ],
    });
    await execute(transaction, {
      sql: `INSERT INTO assistant_outbox
        (id, userId, runId, eventId, kind, state, attempt, availableAt,
         payloadDigest, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?)`,
      args: [
        newId("aout"),
        run.userId,
        run.id,
        eventId,
        event.terminal ? "terminal" : "event",
        persistedAt,
        sha256(canonicalJson(event)),
        persistedAt,
        persistedAt,
      ],
    });
    return {
      ...event,
      persistedAt: new Date(persistedAt * 1_000).toISOString(),
    };
  }

  async appendRunEvent(input: {
    ownerId: string;
    runId: string;
    type: string;
    payload: unknown;
    eventId?: string;
  }): Promise<AssistantEventProjection> {
    const transaction = await this.client.transaction("write");
    try {
      const run = await ownedRun(transaction, input.ownerId, input.runId);
      if (
        !["reserved", "running", "waiting-for-user"].includes(
          String(run.status),
        )
      ) {
        throw new ConversationStoreError("invalid_state", "Run is terminal");
      }
      const event = await this.appendEventInTransaction(transaction, run, {
        type: input.type,
        payload: input.payload,
        eventId: input.eventId,
      });
      await transaction.commit();
      return event;
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async replayEvents(input: {
    ownerId: string;
    runId: string;
    afterSequence?: number;
    limit?: number;
  }): Promise<AssistantEventProjection[]> {
    const run = await ownedRun(this.client, input.ownerId, input.runId);
    const result = await this.client.execute({
      sql: `SELECT e.*, r.threadId, r.branchId FROM assistant_run_events e
        JOIN assistant_runs r ON r.id = e.runId
        WHERE e.runId = ? AND e.sequence > ? ORDER BY e.sequence LIMIT ?`,
      args: [
        run.id,
        Math.max(0, input.afterSequence ?? 0),
        Math.min(Math.max(input.limit ?? 250, 1), 1_000),
      ],
    });
    return result.rows.map(eventFromRow);
  }

  async run(ownerId: string, runId: string): Promise<AssistantRun> {
    return runFromRow(await ownedRun(this.client, ownerId, runId));
  }

  async finalizeRun(input: {
    ownerId: string;
    runId: string;
    expectedInputHeadId: string;
    outputMessageId: string;
    finalParts: AssistantPartV1[];
    citations: Array<{
      ordinal: number;
      proofHandleId: string;
      claimPartId?: string | null;
    }>;
    usage: FinalUsageSnapshot;
    terminal: "complete" | "failed" | "cancelled";
    safeError?: { code: string; message: string } | null;
    terminalReason?: import("@avermate/agent-contracts").AgentTerminalReason;
    siblingPolicy: "create-explicit-sibling-on-head-conflict";
  }): Promise<FinalizedRunProjection> {
    const parts = input.finalParts.map((part) =>
      assistantPartV1Schema.parse(part),
    );
    const transaction = await this.client.transaction("write");
    try {
      const run = await ownedRun(transaction, input.ownerId, input.runId);
      if (String(run.reservedOutputMessageId) !== input.outputMessageId) {
        throw new ConversationStoreError(
          "divergent_replay",
          "Output ID differs from the durable reservation",
        );
      }
      if (["complete", "failed", "cancelled"].includes(String(run.status))) {
        const existing = await one(
          transaction,
          `SELECT * FROM assistant_messages WHERE id = ?`,
          [input.outputMessageId],
        );
        if (
          !existing ||
          canonicalJson(
            this.openedParts(
              run,
              input.ownerId,
              String(run.threadId),
              input.outputMessageId,
              "assistant",
              String(run.inputMessageId),
              assistantPartV1Schema
                .array()
                .parse(jsonValue(existing.partsJson)),
            ),
          ) !== canonicalJson(parts) ||
          run.status !== input.terminal
        ) {
          throw new ConversationStoreError(
            "divergent_replay",
            "Finalization replay is not byte-identical",
          );
        }
        await transaction.commit();
        await this.enqueueConversationIndex(
          input.ownerId,
          String(run.threadId),
        );
        return this.finalizedProjection(input.ownerId, input.runId, false);
      }
      if (String(run.inputMessageId) !== input.expectedInputHeadId) {
        throw new ConversationStoreError(
          "divergent_replay",
          "Finalizer input does not match the run reservation",
        );
      }
      const now = sqlTimestamp();
      const messageStatus = input.terminal;
      await execute(transaction, {
        sql: `INSERT INTO assistant_messages
          (id, threadId, parentMessageId, role, authorship, status, partsVersion,
           partsJson, createdByRunId, createdAt)
          VALUES (?, ?, ?, 'assistant', 'model', ?, ?, ?, ?, ?)`,
        args: [
          input.outputMessageId,
          run.threadId,
          run.inputMessageId,
          messageStatus,
          ASSISTANT_PARTS_VERSION,
          canonicalJson(
            this.storedParts(
              {
                placement: run.threadPlacement,
                placementRef: run.threadPlacementRef,
              },
              input.ownerId,
              String(run.threadId),
              input.outputMessageId,
              "assistant",
              String(run.inputMessageId),
              parts,
            ),
          ),
          run.id,
          now,
        ],
      });
      await execute(transaction, {
        sql: `UPDATE assistant_runs SET outputMessageId = ?, status = ?,
          completedAt = ?, errorCode = ?, safeError = ?,
          terminalReason = ?,
          providerDispatchState = CASE WHEN ? = 'complete' THEN 'completed' ELSE providerDispatchState END,
          updatedAt = ? WHERE id = ? AND status IN ('reserved','running','waiting-for-user','waiting-approval','cancelling')`,
        args: [
          input.outputMessageId,
          input.terminal,
          now,
          input.safeError?.code ?? null,
          input.safeError?.message ?? null,
          input.terminalReason ??
            (input.terminal === "complete"
              ? "completed"
              : input.terminal === "cancelled"
                ? "user-cancelled"
                : "runtime-error"),
          input.terminal,
          now,
          run.id,
        ],
      });
      let siblingCreated = false;
      let branchId = String(run.branchId);
      const head = await one(
        transaction,
        `SELECT headMessageId FROM assistant_branches WHERE id = ?`,
        [run.branchId],
      );
      if (nullString(head?.headMessageId) === String(run.inputMessageId)) {
        await execute(transaction, {
          sql: `UPDATE assistant_branches SET headMessageId = ?, updatedAt = ?
            WHERE id = ? AND headMessageId = ?`,
          args: [input.outputMessageId, now, run.branchId, run.inputMessageId],
        });
      } else {
        siblingCreated = true;
        branchId = newId("abrn");
        await execute(transaction, {
          sql: `INSERT INTO assistant_branches
            (id, threadId, name, forkedFromMessageId, headMessageId, createdAt, updatedAt)
            VALUES (?, ?, 'Réponse concurrente', ?, ?, ?, ?)`,
          args: [
            branchId,
            run.threadId,
            run.inputMessageId,
            input.outputMessageId,
            now,
            now,
          ],
        });
      }
      const claimPartIds = new Set(
        parts
          .filter(
            (part): part is Extract<AssistantPartV1, { type: "text" }> =>
              part.type === "text",
          )
          .map((part) => part.id),
      );
      const citationParts = parts.filter(
        (part): part is Extract<AssistantPartV1, { type: "citation" }> =>
          part.type === "citation",
      );
      if (citationParts.length !== input.citations.length) {
        throw new ConversationStoreError(
          "invalid_state",
          "Every citation part must have one normalized citation",
        );
      }
      const citationOrdinals = new Set<number>();
      for (const citation of [...input.citations].sort(
        (a, b) => a.ordinal - b.ordinal,
      )) {
        const matchingParts = citationParts.filter(
          (part) => part.ordinal === citation.ordinal,
        );
        const citationPart = matchingParts[0];
        if (
          matchingParts.length !== 1 ||
          !citationPart ||
          citationOrdinals.has(citation.ordinal) ||
          !citation.claimPartId ||
          citationPart.claimPartId !== citation.claimPartId ||
          !claimPartIds.has(citation.claimPartId)
        ) {
          throw new ConversationStoreError(
            "invalid_state",
            "Every normalized citation must target one matching text claim part",
          );
        }
        citationOrdinals.add(citation.ordinal);
        await execute(transaction, {
          sql: `INSERT INTO assistant_citations
            (id, messageId, runId, ordinal, proofHandleId, claimPartId, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
          args: [
            citationPart.citationId,
            input.outputMessageId,
            run.id,
            citation.ordinal,
            citation.proofHandleId,
            citation.claimPartId ?? null,
            now,
          ],
        });
      }
      await execute(transaction, {
        sql: `INSERT INTO assistant_usage
          (runId, providerKey, providerRevision, modelKey, modelRevision,
           usageVersion, source, pricingSnapshotId, inputTokens,
           outputTokens, reasoningTokens, cachedReadTokens, cachedWriteTokens,
           estimatedCost, currency, final, createdAt)
          VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
        args: [
          run.id,
          input.usage.providerKey,
          input.usage.providerRevision ??
            String(run.providerRevision ?? "legacy/1"),
          input.usage.modelKey,
          input.usage.modelRevision ?? String(run.modelRevision ?? "legacy/1"),
          input.usage.source ?? "unknown",
          input.usage.pricingSnapshotId ?? null,
          input.usage.inputTokens,
          input.usage.outputTokens,
          input.usage.reasoningTokens,
          input.usage.cachedReadTokens,
          input.usage.cachedWriteTokens,
          input.usage.estimatedCost,
          input.usage.currency,
          now,
        ],
      });
      const terminalType =
        input.terminal === "complete"
          ? "run.finished"
          : input.terminal === "failed"
            ? "run.failed"
            : "run.cancelled";
      await this.appendEventInTransaction(
        transaction,
        { ...run, status: input.terminal },
        {
          type: terminalType,
          payload: input.safeError
            ? { code: input.safeError.code, message: input.safeError.message }
            : { outputMessageId: input.outputMessageId },
          terminal: true,
        },
      );
      await execute(transaction, {
        sql: `UPDATE assistant_threads SET activeBranchId = ?, revision = revision + 1,
          updatedAt = ? WHERE id = ?`,
        args: [branchId, now, run.threadId],
      });
      await this.registerConversationSource(
        transaction,
        input.ownerId,
        String(run.threadId),
        now,
      );
      await transaction.commit();
      await this.enqueueConversationIndex(input.ownerId, String(run.threadId));
      return this.finalizedProjection(
        input.ownerId,
        input.runId,
        siblingCreated,
      );
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  private async finalizedProjection(
    ownerId: string,
    runId: string,
    siblingCreated: boolean,
  ): Promise<FinalizedRunProjection> {
    const runRow = await ownedRun(this.client, ownerId, runId);
    const outputRow = await one(
      this.client,
      `SELECT * FROM assistant_messages WHERE id = ?`,
      [runRow.outputMessageId],
    );
    const citationRows = await this.client.execute({
      sql: `SELECT * FROM assistant_citations WHERE runId = ? ORDER BY ordinal`,
      args: [runId],
    });
    const usageRow = await one(
      this.client,
      `SELECT * FROM assistant_usage WHERE runId = ?`,
      [runId],
    );
    const terminalRow = await one(
      this.client,
      `SELECT e.*, r.threadId, r.branchId FROM assistant_run_events e
       JOIN assistant_runs r ON r.id = e.runId
       WHERE e.runId = ? AND e.terminal = 1 LIMIT 1`,
      [runId],
    );
    return {
      run: runFromRow(runRow),
      output: messageFromRow(outputRow!),
      citations: citationRows.rows.map(citationFromRow),
      usage: usageFromRow(usageRow!),
      terminalEvent: eventFromRow(terminalRow!),
      branchId: String(runRow.branchId),
      siblingCreated,
    };
  }

  async cancelRun(ownerId: string, runId: string): Promise<AssistantRun> {
    const run = await this.run(ownerId, runId);
    if (["complete", "failed", "cancelled"].includes(run.status)) return run;
    await this.finalizeRun({
      ownerId,
      runId,
      expectedInputHeadId: run.inputMessageId,
      outputMessageId: run.reservedOutputMessageId,
      finalParts: [
        {
          type: "safe-error",
          id: newId("apart"),
          code: "cancelled",
          message: "You stopped this response.",
          retryable: true,
        },
      ],
      citations: [],
      usage: {
        providerKey: run.providerKey,
        modelKey: run.modelKey,
        inputTokens: null,
        outputTokens: null,
        reasoningTokens: null,
        cachedReadTokens: null,
        cachedWriteTokens: null,
        estimatedCost: null,
        currency: null,
      },
      terminal: "cancelled",
      safeError: { code: "cancelled", message: "Run cancelled" },
      siblingPolicy: "create-explicit-sibling-on-head-conflict",
    });
    return this.run(ownerId, runId);
  }

  async respondToQuestion(input: {
    ownerId: string;
    runId: string;
    questionId: string;
    answer: string;
  }): Promise<AssistantRun> {
    const transaction = await this.client.transaction("write");
    try {
      const run = await ownedRun(transaction, input.ownerId, input.runId);
      if (run.status !== "waiting-for-user") {
        throw new ConversationStoreError(
          "invalid_state",
          "Run is not waiting for an answer",
        );
      }
      const now = sqlTimestamp();
      await execute(transaction, {
        sql: `UPDATE assistant_runs SET status = 'running', updatedAt = ? WHERE id = ?`,
        args: [now, run.id],
      });
      await this.appendEventInTransaction(transaction, run, {
        type: "avermate.approval.resolved",
        payload: { questionId: input.questionId, answer: input.answer },
      });
      await transaction.commit();
      return this.run(input.ownerId, input.runId);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async updateThread(input: {
    ownerId: string;
    threadId: string;
    expectedRevision: number;
    title?: string;
    starred?: boolean;
    archived?: boolean;
    activeBranchId?: string;
  }): Promise<AssistantThread> {
    const current = await this.thread(input.ownerId, input.threadId, true);
    if (input.activeBranchId) {
      const branch = await one(
        this.client,
        `SELECT id FROM assistant_branches WHERE id = ? AND threadId = ?`,
        [input.activeBranchId, input.threadId],
      );
      if (!branch)
        throw new ConversationStoreError("not_found", "Branch not found");
    }
    const now = sqlTimestamp();
    const result = await this.client.execute({
      sql: `UPDATE assistant_threads SET title = ?, activeBranchId = ?,
        starredAt = ?, archivedAt = ?, revision = revision + 1, updatedAt = ?
        WHERE id = ? AND userId = ? AND revision = ?`,
      args: [
        input.title?.trim() || current.title,
        input.activeBranchId ?? current.activeBranchId,
        input.starred === undefined
          ? current.starredAt
            ? Math.floor(new Date(current.starredAt).getTime() / 1_000)
            : null
          : input.starred
            ? now
            : null,
        input.archived === undefined
          ? current.archivedAt
            ? Math.floor(new Date(current.archivedAt).getTime() / 1_000)
            : null
          : input.archived
            ? now
            : null,
        now,
        input.threadId,
        input.ownerId,
        input.expectedRevision,
      ],
    });
    if (result.rowsAffected !== 1) {
      throw new ConversationStoreError(
        "head_conflict",
        "Thread revision changed",
      );
    }
    return this.thread(input.ownerId, input.threadId, true);
  }

  async trashThread(input: {
    ownerId: string;
    threadId: string;
    expectedRevision: number;
    retentionDays?: number;
  }): Promise<AssistantThread> {
    const now = sqlTimestamp();
    const result = await this.client.execute({
      sql: `UPDATE assistant_threads SET deletedAt = ?, purgeAfter = ?,
        revision = revision + 1, updatedAt = ?
        WHERE id = ? AND userId = ? AND revision = ? AND deletedAt IS NULL`,
      args: [
        now,
        now + Math.min(Math.max(input.retentionDays ?? 30, 1), 365) * 86_400,
        now,
        input.threadId,
        input.ownerId,
        input.expectedRevision,
      ],
    });
    if (result.rowsAffected !== 1) {
      throw new ConversationStoreError(
        "head_conflict",
        "Thread revision changed",
      );
    }
    return this.thread(input.ownerId, input.threadId, true);
  }

  async restoreThread(input: {
    ownerId: string;
    threadId: string;
    expectedRevision: number;
  }): Promise<AssistantThread> {
    const now = sqlTimestamp();
    const result = await this.client.execute({
      sql: `UPDATE assistant_threads SET deletedAt = NULL, purgeAfter = NULL,
        revision = revision + 1, updatedAt = ?
        WHERE id = ? AND userId = ? AND revision = ? AND deletedAt IS NOT NULL`,
      args: [now, input.threadId, input.ownerId, input.expectedRevision],
    });
    if (result.rowsAffected !== 1) {
      throw new ConversationStoreError(
        "head_conflict",
        "Thread revision changed",
      );
    }
    return this.thread(input.ownerId, input.threadId, true);
  }

  async purgeExpired(ownerId?: string): Promise<string[]> {
    const now = sqlTimestamp();
    const result = await this.client.execute({
      sql: `SELECT id FROM assistant_threads WHERE deletedAt IS NOT NULL
        AND purgeAfter <= ? ${ownerId ? "AND userId = ?" : ""}`,
      args: ownerId ? [now, ownerId] : [now],
    });
    let ids = result.rows.map((row) => String(row.id));
    if (ids.length) {
      const transaction = await this.client.transaction("write");
      try {
        // The maintenance scan above is only a candidate list. Restore can
        // race that read, so establish the destructive fence again inside the
        // write transaction before touching any dependent graph rows.
        const candidatePlaceholders = ids.map(() => "?").join(",");
        const eligible = await execute(transaction, {
          sql: `SELECT id FROM assistant_threads
            WHERE id IN (${candidatePlaceholders})
              AND deletedAt IS NOT NULL AND purgeAfter <= ?
              ${ownerId ? "AND userId = ?" : ""}`,
          args: ownerId ? [...ids, now, ownerId] : [...ids, now],
        });
        ids = eligible.rows.map((row) => String(row.id));
        if (ids.length === 0) {
          await transaction.commit();
          return [];
        }
        const placeholders = ids.map(() => "?").join(",");
        await execute(transaction, {
          sql: `UPDATE content_versions SET gcRequestedAt = ?
            WHERE id IN (
              SELECT currentVersionId FROM content_sources
              WHERE originKind = 'conversation'
                AND originId IN (${placeholders})
                AND currentVersionId IS NOT NULL
            )`,
          args: [now, ...ids],
        });
        await execute(transaction, {
          sql: `UPDATE content_sources
            SET currentVersionId = NULL, status = 'failed',
              error = 'source_purged', updatedAt = ?
            WHERE originKind = 'conversation'
              AND originId IN (${placeholders})`,
          args: [now, ...ids],
        });
        await execute(transaction, {
          sql: `DELETE FROM study_project_items
            WHERE kind = 'conversation' AND referenceId IN (${placeholders})`,
          args: ids,
        });
        // The conversation graph deliberately uses RESTRICT edges to keep
        // immutable messages/checkpoints from disappearing through ordinary
        // writes. A retention purge is the one authorized exception, so remove
        // the dependent graph explicitly and from leaves to roots. Relying on
        // a thread-level cascade fails as soon as a run still references its
        // immutable input/output messages.
        await execute(transaction, {
          sql: `DELETE FROM workspace_snapshots
            WHERE threadId IN (${placeholders})`,
          args: ids,
        });
        await execute(transaction, {
          sql: `DELETE FROM assistant_outbox
            WHERE runId IN (
              SELECT id FROM assistant_runs
              WHERE threadId IN (${placeholders})
            ) OR checkpointId IN (
              SELECT id FROM assistant_conversation_checkpoints
              WHERE threadId IN (${placeholders})
            )`,
          args: [...ids, ...ids],
        });
        // Break the run -> manifest/checkpoint half of the intentionally
        // immutable circular graph before deleting its leaves. Both targets
        // are still owner/thread scoped by the surrounding purge transaction.
        await execute(transaction, {
          sql: `UPDATE assistant_runs
            SET contextManifestId = NULL, conversationCheckpointRef = NULL
            WHERE threadId IN (${placeholders})`,
          args: ids,
        });
        await execute(transaction, {
          sql: `DELETE FROM assistant_citations
            WHERE runId IN (
              SELECT id FROM assistant_runs
              WHERE threadId IN (${placeholders})
            )`,
          args: ids,
        });
        await execute(transaction, {
          sql: `DELETE FROM assistant_context_proof_handles
            WHERE runId IN (
              SELECT id FROM assistant_runs
              WHERE threadId IN (${placeholders})
            )`,
          args: ids,
        });
        await execute(transaction, {
          sql: `DELETE FROM content_version_references
            WHERE ownerKind = 'assistant-citation'
              AND (
                ownerId IN (
                  SELECT id FROM assistant_runs
                  WHERE threadId IN (${placeholders})
                )
                OR ownerId IN (
                  SELECT attachments.id FROM assistant_attachments AS attachments
                  JOIN assistant_messages AS messages
                    ON messages.id = attachments.messageId
                  WHERE messages.threadId IN (${placeholders})
                )
              )`,
          args: [...ids, ...ids],
        });
        await execute(transaction, {
          sql: `DELETE FROM assistant_context_manifests
            WHERE runId IN (
              SELECT id FROM assistant_runs
              WHERE threadId IN (${placeholders})
            )`,
          args: ids,
        });
        await execute(transaction, {
          sql: `DELETE FROM assistant_usage
            WHERE runId IN (
              SELECT id FROM assistant_runs
              WHERE threadId IN (${placeholders})
            )`,
          args: ids,
        });
        await execute(transaction, {
          sql: `DELETE FROM assistant_run_events
            WHERE runId IN (
              SELECT id FROM assistant_runs
              WHERE threadId IN (${placeholders})
            )`,
          args: ids,
        });
        while (true) {
          const deleted = await execute(transaction, {
            sql: `DELETE FROM assistant_conversation_checkpoints
              WHERE threadId IN (${placeholders})
                AND NOT EXISTS (
                  SELECT 1 FROM assistant_conversation_checkpoints AS child
                  WHERE child.parentCheckpointId = assistant_conversation_checkpoints.id
                )`,
            args: ids,
          });
          if (Number(deleted.rowsAffected) === 0) break;
        }
        const remainingCheckpoints = await execute(transaction, {
          sql: `SELECT count(*) AS count
            FROM assistant_conversation_checkpoints
            WHERE threadId IN (${placeholders})`,
          args: ids,
        });
        if (Number(remainingCheckpoints.rows[0]?.count ?? 0) !== 0) {
          throw new Error("Conversation checkpoint graph could not be purged");
        }
        await execute(transaction, {
          sql: `DELETE FROM assistant_runs
            WHERE threadId IN (${placeholders})`,
          args: ids,
        });
        await execute(transaction, {
          sql: `DELETE FROM assistant_attachments
            WHERE messageId IN (
              SELECT id FROM assistant_messages
              WHERE threadId IN (${placeholders})
            )`,
          args: ids,
        });
        while (true) {
          const deleted = await execute(transaction, {
            sql: `DELETE FROM assistant_messages
              WHERE threadId IN (${placeholders})
                AND NOT EXISTS (
                  SELECT 1 FROM assistant_messages AS child
                  WHERE child.parentMessageId = assistant_messages.id
                    OR child.replacesMessageId = assistant_messages.id
                )`,
            args: ids,
          });
          if (Number(deleted.rowsAffected) === 0) break;
        }
        const remainingMessages = await execute(transaction, {
          sql: `SELECT count(*) AS count FROM assistant_messages
            WHERE threadId IN (${placeholders})`,
          args: ids,
        });
        if (Number(remainingMessages.rows[0]?.count ?? 0) !== 0) {
          throw new Error("Conversation message graph could not be purged");
        }
        await execute(transaction, {
          sql: `DELETE FROM assistant_threads WHERE id IN (${placeholders})`,
          args: ids,
        });
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    }
    return ids;
  }

  async createAttachment(input: {
    ownerId: string;
    messageId: string;
    kind: AssistantAttachmentKind;
    referenceId: string;
    snapshotVersion?: string | null;
    label: string;
  }): Promise<AssistantAttachment> {
    assertAttachmentSnapshotInput(input.kind, input.snapshotVersion);
    const transaction = await this.client.transaction("write");
    try {
      const message = await one(
        transaction,
        `SELECT m.* FROM assistant_messages m JOIN assistant_threads t ON t.id = m.threadId
         WHERE m.id = ? AND t.userId = ? AND t.deletedAt IS NULL`,
        [input.messageId, input.ownerId],
      );
      if (!message)
        throw new ConversationStoreError("not_found", "Message not found");
      if (message.role !== "user") {
        throw new ConversationStoreError(
          "invalid_state",
          "Attachments may only be added to a user message",
        );
      }
      const id = newId("aatt");
      const now = sqlTimestamp();
      await execute(transaction, {
        sql: `INSERT INTO assistant_attachments
          (id, messageId, kind, referenceId, snapshotVersion, label, fileId, createdAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        args: [
          id,
          input.messageId,
          input.kind,
          input.referenceId,
          input.snapshotVersion ?? null,
          input.label,
          input.kind === "file" ? input.referenceId : null,
          now,
        ],
      });
      await freezeAttachmentSnapshotInTransaction(transaction, {
        ownerId: input.ownerId,
        attachmentId: id,
        expectedVersionId: input.snapshotVersion ?? null,
        rejectUnavailableExpectedVersion:
          input.snapshotVersion !== undefined && input.snapshotVersion !== null,
      });
      if (input.kind === "task") {
        await freezeTaskAttachmentSnapshotInTransaction(transaction, {
          ownerId: input.ownerId,
          attachmentId: id,
          rejectUnavailable: true,
        });
      }
      const row = await one(
        transaction,
        `SELECT * FROM assistant_attachments WHERE id = ?`,
        [id],
      );
      await transaction.commit();
      return attachmentFromRow(row!);
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
  }

  async freezeAttachmentSnapshot(input: {
    ownerId: string;
    attachmentId: string;
    /** Exact version returned by the index publication, when available. */
    expectedVersionId?: string | null;
  }): Promise<string | null> {
    return retrySqliteBusy(async () => {
      const transaction = await this.client.transaction("write");
      try {
        const versionId = await freezeAttachmentSnapshotInTransaction(
          transaction,
          {
            ...input,
            rejectUnavailableExpectedVersion: input.expectedVersionId != null,
          },
        );
        await transaction.commit();
        return versionId;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    });
  }

  async freezeTaskAttachmentSnapshot(input: {
    ownerId: string;
    attachmentId: string;
  }): Promise<FrozenTaskAttachmentSnapshot | null> {
    return retrySqliteBusy(async () => {
      const transaction = await this.client.transaction("write");
      try {
        const snapshot = await freezeTaskAttachmentSnapshotInTransaction(
          transaction,
          { ...input, rejectUnavailable: false },
        );
        await transaction.commit();
        return snapshot;
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    });
  }

  async manifests(
    ownerId: string,
    threadId: string,
  ): Promise<AssistantContextManifest[]> {
    await ownedThread(this.client, ownerId, threadId, true);
    const manifests = await this.client.execute({
      sql: `SELECT m.* FROM assistant_context_manifests m
        JOIN assistant_runs r ON r.id = m.runId WHERE r.threadId = ?
        ORDER BY m.runId, m.revision`,
      args: [threadId],
    });
    const output: AssistantContextManifest[] = [];
    for (const manifest of manifests.rows) {
      const handles = await this.client.execute({
        sql: `SELECT p.*, r.userId AS referenceUserId, r.ownerKind,
          r.ownerId AS referenceOwnerId, r.referenceKey, r.createdAt AS referenceCreatedAt
          FROM assistant_context_proof_handles p
          JOIN content_version_references r ON r.id = p.contentVersionReferenceId
          WHERE p.contextManifestId = ? ORDER BY p.ordinal`,
        args: [manifest.id],
      });
      output.push(
        assistantContextManifestSchema.parse({
          id: String(manifest.id),
          runId: String(manifest.runId),
          version: Number(manifest.version),
          revision: Number(manifest.revision),
          budget: jsonValue(manifest.budgetJson),
          items: jsonValue(manifest.itemsJson),
          proofHandles: handles.rows.map((handle) => ({
            id: String(handle.id),
            contextManifestId: String(handle.contextManifestId),
            runId: String(handle.runId),
            ordinal: Number(handle.ordinal),
            contentVersionReference: {
              id: String(handle.contentVersionReferenceId),
              ownerId: String(handle.referenceUserId),
              ownerKind: handle.ownerKind,
              ownerIdWithinKind: String(handle.referenceOwnerId),
              sourceVersionId: String(handle.sourceVersionId),
              chunkId: nullString(handle.chunkId),
              locatorSchemaVersion: 1,
              locator: jsonValue(handle.locatorJson),
              quotedContentHash: nullString(handle.quotedContentHash),
              referenceKey: String(handle.referenceKey),
              createdAt: isoFromSqlite(handle.referenceCreatedAt),
            },
            locator: jsonValue(handle.locatorJson),
            evidenceDigest: String(handle.evidenceDigest),
            quotedContentHash: nullString(handle.quotedContentHash),
            createdAt: isoFromSqlite(handle.createdAt),
          })),
          digest: String(manifest.digest),
          committedAt: isoFromSqlite(manifest.committedAt),
        }),
      );
    }
    return output;
  }

  async exportThread(input: {
    ownerId: string;
    threadId: string;
    mode: "active-branch" | "whole-dag";
    branchId?: string | null;
  }): Promise<AssistantDagExport> {
    const detail = await this.getThreadDetail(
      input.ownerId,
      input.threadId,
      input.branchId,
    );
    const included = new Set(detail.activePathMessageIds);
    const messages =
      input.mode === "whole-dag"
        ? detail.messages
        : detail.messages.filter((message) => included.has(message.id));
    const runIds = new Set(
      detail.runs
        .filter(
          (run) =>
            included.has(run.inputMessageId) ||
            (run.outputMessageId ? included.has(run.outputMessageId) : false),
        )
        .map((run) => run.id),
    );
    const branches =
      input.mode === "whole-dag"
        ? detail.branches
        : detail.branches.filter(
            (branch) => branch.id === detail.activeBranchId,
          );
    return assistantDagExportSchema.parse({
      exportVersion: 1,
      exportedAt: new Date().toISOString(),
      mode: input.mode,
      thread: detail.thread,
      branches,
      messages,
      runs:
        input.mode === "whole-dag"
          ? detail.runs
          : detail.runs.filter((run) => runIds.has(run.id)),
      attachments: detail.attachments.filter((attachment) =>
        messages.some((message) => message.id === attachment.messageId),
      ),
      citations: detail.citations.filter((citation) =>
        messages.some((message) => message.id === citation.messageId),
      ),
      manifests:
        input.mode === "whole-dag"
          ? detail.manifests
          : detail.manifests.filter((manifest) => runIds.has(manifest.runId)),
      usage:
        input.mode === "whole-dag"
          ? detail.usage
          : detail.usage.filter((usage) => runIds.has(usage.runId)),
    });
  }

  async exportMarkdown(input: {
    ownerId: string;
    threadId: string;
    branchId?: string | null;
  }): Promise<string> {
    const detail = await this.getThreadDetail(
      input.ownerId,
      input.threadId,
      input.branchId,
    );
    const byId = new Map(
      detail.messages.map((message) => [message.id, message]),
    );
    const lines = [`# ${detail.thread.title}`, ""];
    for (const id of detail.activePathMessageIds) {
      const message = byId.get(id)!;
      lines.push(`## ${message.role === "user" ? "Vous" : "Assistant"}`, "");
      for (const part of message.parts) {
        if (part.type === "text") lines.push(part.markdown, "");
        if (part.type === "safe-error") lines.push(`> ${part.message}`, "");
      }
    }
    const citations = detail.citations.filter((citation) =>
      detail.activePathMessageIds.includes(citation.messageId),
    );
    if (citations.length) {
      lines.push("## Sources", "");
      for (const citation of citations) {
        lines.push(
          `- [${citation.ordinal + 1}] Preuve ${citation.proofHandleId}`,
        );
      }
    }
    return lines.join("\n").trimEnd() + "\n";
  }

  async saveConversationToProject(input: {
    ownerId: string;
    threadId: string;
    projectId: string;
    mode: "reference" | "markdown";
    branchId?: string | null;
  }): Promise<
    | { mode: "reference"; itemId: string }
    | { mode: "markdown"; itemId: string; documentId: string }
  > {
    await ownedThread(this.client, input.ownerId, input.threadId);
    const project = await one(
      this.client,
      `SELECT * FROM study_projects WHERE id = ? AND userId = ? AND deletedAt IS NULL`,
      [input.projectId, input.ownerId],
    );
    if (!project)
      throw new ConversationStoreError("not_found", "Project not found");
    if (input.mode === "markdown") {
      if (!project.yearId) {
        throw new ConversationStoreError(
          "invalid_state",
          "Select an academic year on the project before creating a study document",
        );
      }
      const markdown = await this.exportMarkdown({
        ownerId: input.ownerId,
        threadId: input.threadId,
        branchId: input.branchId,
      });
      const detail = await this.getThreadDetail(
        input.ownerId,
        input.threadId,
        input.branchId,
      );
      const digest = sha256(
        canonicalJson([
          input.projectId,
          input.threadId,
          input.branchId ?? detail.activeBranchId,
          markdown,
        ]),
      );
      const documentId = `sdoc_asst_${digest.slice(0, 24)}`;
      const itemId = `pitem_asst_${digest.slice(0, 24)}`;
      const now = sqlTimestamp();
      const transaction = await this.client.transaction("write");
      try {
        await execute(transaction, {
          sql: `INSERT INTO study_documents
            (id, kind, title, bodyMarkdown, revision, metaVersion, yearId,
             subjectId, userId, createdAt, updatedAt)
            VALUES (?, 'fiche', ?, ?, 1, 1, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO NOTHING`,
          args: [
            documentId,
            `${detail.thread.title} — conversation`,
            markdown,
            project.yearId,
            project.subjectId,
            input.ownerId,
            now,
            now,
          ],
        });
        const max = await one(
          transaction,
          `SELECT coalesce(max(position), -1) AS position
            FROM study_project_items WHERE projectId = ?`,
          [input.projectId],
        );
        await execute(transaction, {
          sql: `INSERT INTO content_sources
            (id, userId, yearId, subjectId, originKind, originId, status,
             coverage, placement, createdAt, updatedAt)
            VALUES (?, ?, ?, ?, 'study-document', ?, 'registered',
              'searchable-native-text', 'core', ?, ?)
            ON CONFLICT(userId, originKind, originId) DO NOTHING`,
          args: [
            `csrc_asst_${digest.slice(0, 24)}`,
            input.ownerId,
            project.yearId,
            project.subjectId,
            documentId,
            now,
            now,
          ],
        });
        await execute(transaction, {
          sql: `INSERT INTO study_project_items
            (id, projectId, kind, referenceId, position, contextMode, label, addedAt)
            VALUES (?, ?, 'study-document', ?, ?, 'include', ?, ?)
            ON CONFLICT(projectId, kind, referenceId) DO NOTHING`,
          args: [
            itemId,
            input.projectId,
            documentId,
            Number(max?.position ?? -1) + 1,
            detail.thread.title,
            now,
          ],
        });
        await transaction.commit();
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
      return { mode: "markdown", itemId, documentId };
    }
    const detail = await this.getThreadDetail(
      input.ownerId,
      input.threadId,
      input.branchId,
    );
    const selectedBranchId = input.branchId ?? detail.activeBranchId;
    const selectedBranch = detail.branches.find(
      (branch) => branch.id === selectedBranchId,
    );
    if (!selectedBranch || !selectedBranch.headMessageId) {
      throw new ConversationStoreError(
        "invalid_state",
        "The selected conversation branch has no completed head",
      );
    }
    const existing = await one(
      this.client,
      `SELECT id, conversationBranchId, conversationHeadMessageId,
          selectorReviewRequired
        FROM study_project_items WHERE projectId = ? AND kind = 'conversation'
        AND referenceId = ?`,
      [input.projectId, input.threadId],
    );
    if (existing) {
      const itemId = String(existing.id);
      if (Boolean(existing.selectorReviewRequired)) {
        const updated = await this.client.execute({
          sql: `UPDATE study_project_items
            SET conversationBranchId = ?, conversationHeadMessageId = ?,
              trackingMode = 'pinned', selectorReviewRequired = 0,
              sourceVersionId = NULL
            WHERE id = ? AND projectId = ? AND selectorReviewRequired = 1`,
          args: [
            selectedBranch.id,
            selectedBranch.headMessageId,
            itemId,
            input.projectId,
          ],
        });
        if (Number(updated.rowsAffected) !== 1) {
          throw new ConversationStoreError(
            "invalid_state",
            "The project conversation selector changed while it was reviewed",
          );
        }
        await this.enqueueConversationIndex(
          input.ownerId,
          input.threadId,
          {
            conversationBranchId: selectedBranch.id,
            conversationHeadMessageId: selectedBranch.headMessageId,
          },
          itemId,
        );
        return { mode: "reference", itemId };
      }
      if (
        existing.conversationBranchId !== selectedBranch.id ||
        existing.conversationHeadMessageId !== selectedBranch.headMessageId
      ) {
        throw new ConversationStoreError(
          "invalid_state",
          "This project already pins another branch of the conversation",
        );
      }
      return { mode: "reference", itemId };
    }
    const itemId = newId("pitem");
    const max = await one(
      this.client,
      `SELECT coalesce(max(position), -1) AS position FROM study_project_items WHERE projectId = ?`,
      [input.projectId],
    );
    const now = sqlTimestamp();
    const transaction = await this.client.transaction("write");
    try {
      await execute(transaction, {
        sql: `INSERT INTO content_sources
          (id, userId, yearId, subjectId, originKind, originId, status,
           coverage, placement, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, 'conversation', ?, 'registered',
            'searchable-native-text', 'core', ?, ?)
          ON CONFLICT(userId, originKind, originId) DO UPDATE SET
            yearId = coalesce(content_sources.yearId, excluded.yearId),
            subjectId = coalesce(content_sources.subjectId, excluded.subjectId),
            updatedAt = excluded.updatedAt`,
        args: [
          `csrc_conv_${sha256(`${input.ownerId}\0${input.threadId}`).slice(0, 24)}`,
          input.ownerId,
          project.yearId,
          project.subjectId,
          input.threadId,
          now,
          now,
        ],
      });
      await execute(transaction, {
        sql: `INSERT INTO study_project_items
          (id, projectId, kind, referenceId, conversationBranchId,
           conversationHeadMessageId, trackingMode, selectorReviewRequired,
           position, contextMode, addedAt)
          VALUES (?, ?, 'conversation', ?, ?, ?, 'pinned', 0, ?, 'on-demand', ?)`,
        args: [
          itemId,
          input.projectId,
          input.threadId,
          selectedBranch.id,
          selectedBranch.headMessageId,
          Number(max?.position ?? -1) + 1,
          now,
        ],
      });
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    await this.enqueueConversationIndex(
      input.ownerId,
      input.threadId,
      {
        conversationBranchId: selectedBranch.id,
        conversationHeadMessageId: selectedBranch.headMessageId,
      },
      itemId,
    );
    return { mode: "reference", itemId };
  }
}

export const coreConversationInternals = {
  threadFromRow,
  branchFromRow,
  messageFromRow,
  runFromRow,
  eventFromRow,
  activePath,
};
