import {
  afterAll,
  afterEach,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from "bun:test";
import { createClient, type Client } from "@libsql/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  actionHash,
  ActionLedgerError,
  ActionLedgerService,
  DurableToolActionLedgerWriter,
  type ActionReservationInput,
} from "./action-ledger";
import {
  createPersonalTaskCommand,
  getPersonalTaskCommand,
  PersonalTaskCommandError,
  restorePersonalTaskCommand,
  trashPersonalTaskCommand,
} from "./personal-task-command";
import { resolveApprovalAndResume } from "./approval-execution";
import { recoverInterruptedActions } from "./action-recovery";
import { InMemoryToolActionContinuationStore } from "../tools/action-continuation";
import {
  noOpToolCapabilities,
  noOpToolEvents,
  ToolBroker,
} from "../tools/broker";
import { ToolRegistry } from "../tools/registry";

const clients: Client[] = [];
const testDirectory = mkdtempSync(join(tmpdir(), "avermate-actions-"));

setDefaultTimeout(15_000);

async function closeClients() {
  for (const client of clients.splice(0)) {
    await Promise.resolve(client.close());
  }
}

afterAll(async () => {
  await closeClients();
  try {
    rmSync(testDirectory, { recursive: true, force: true });
  } catch {
    // Windows may retain a short-lived SQLite file handle after close. The
    // directory is under the OS temp root and will be reclaimed normally.
  }
});

afterEach(closeClients);

async function setup() {
  const client = createClient({
    url: `file:${join(testDirectory, `${crypto.randomUUID()}.db`)}`,
  });
  clients.push(client);
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id text PRIMARY KEY NOT NULL);
    CREATE TABLE years (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE subjects (
      id text PRIMARY KEY NOT NULL,
      name text NOT NULL,
      yearId text NOT NULL REFERENCES years(id) ON DELETE CASCADE,
      userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE planning_tasks (
      id text PRIMARY KEY NOT NULL,
      title text NOT NULL,
      notes text,
      localNote text,
      startsAt integer,
      scheduledAt integer,
      dueAt integer,
      status text DEFAULT 'todo' NOT NULL,
      completedAt integer,
      subjectId text REFERENCES subjects(id) ON DELETE SET NULL,
      sortOrder integer DEFAULT 0 NOT NULL,
      yearId text NOT NULL REFERENCES years(id) ON DELETE CASCADE,
      userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      sourceConnectionId text,
      externalId text,
      syncState text DEFAULT 'detached' NOT NULL,
      createdAt integer NOT NULL,
      updatedAt integer NOT NULL
    );
    CREATE TABLE assistant_threads (
      id text PRIMARY KEY NOT NULL,
      userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE assistant_branches (
      id text PRIMARY KEY NOT NULL,
      threadId text NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE
    );
    CREATE TABLE assistant_runs (
      id text PRIMARY KEY NOT NULL,
      userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      threadId text NOT NULL REFERENCES assistant_threads(id) ON DELETE CASCADE,
      branchId text NOT NULL REFERENCES assistant_branches(id) ON DELETE CASCADE
    );
    CREATE TABLE learning_evidence (
      id text PRIMARY KEY NOT NULL,
      objectiveId text NOT NULL,
      userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE learning_evidence_decisions (
      id text PRIMARY KEY NOT NULL,
      evidenceId text NOT NULL REFERENCES learning_evidence(id) ON DELETE CASCADE,
      state text NOT NULL,
      reason text,
      actor text NOT NULL,
      idempotencyKey text NOT NULL,
      userId text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      createdAt integer NOT NULL
    );
    CREATE UNIQUE INDEX learning_evidence_decisions_key_unique
      ON learning_evidence_decisions (userId, idempotencyKey);
  `);
  const migration = await Bun.file(
    new URL("../../drizzle/0057_agent_action_ledger.sql", import.meta.url),
  ).text();
  for (const statement of migration.split("--> statement-breakpoint")) {
    if (statement.trim()) await client.execute(statement);
  }
  await client.batch([
    { sql: "INSERT INTO users (id) VALUES (?)", args: ["user-a"] },
    { sql: "INSERT INTO users (id) VALUES (?)", args: ["user-b"] },
    {
      sql: "INSERT INTO years (id, name, userId) VALUES (?, ?, ?)",
      args: ["year-a", "2026-2027", "user-a"],
    },
    {
      sql: "INSERT INTO years (id, name, userId) VALUES (?, ?, ?)",
      args: ["year-b", "2026-2027", "user-b"],
    },
    {
      sql: "INSERT INTO subjects (id, name, yearId, userId) VALUES (?, ?, ?, ?)",
      args: ["subject-a", "Maths", "year-a", "user-a"],
    },
    {
      sql: "INSERT INTO assistant_threads (id, userId) VALUES (?, ?)",
      args: ["thread-a", "user-a"],
    },
    {
      sql: "INSERT INTO assistant_branches (id, threadId) VALUES (?, ?)",
      args: ["branch-a", "thread-a"],
    },
  ]);
  return { client, ledger: new ActionLedgerService(client) };
}

async function reservationInput(
  overrides: Partial<ActionReservationInput> = {},
): Promise<ActionReservationInput> {
  const key = overrides.idempotencyKey ?? crypto.randomUUID();
  const redactedInput = overrides.redactedInput ?? { title: `Task ${key}` };
  return {
    userId: "user-a",
    actorKind: "embedded-agent",
    actorClientId: "web:test",
    threadId: null,
    branchId: null,
    runId: null,
    toolCallId: `call:${key}`,
    toolId: "planning.tasks.create",
    toolVersion: 1,
    effect: "create",
    risk: "medium",
    approval: "policy",
    approvalMode: "auto-reversible",
    compensation: "guaranteed",
    compensatorId: "planning.tasks.trash-created@1",
    crashRecovery: "idempotent-retry",
    idempotencyKey: key,
    argumentsHash:
      overrides.argumentsHash ?? (await actionHash({ redactedInput })),
    redactedInput,
    preview: overrides.preview ?? {
      title: "Create a personal task",
      consequence: "One recoverable task will be added",
    },
    domainScopeKind: "academic-year",
    domainScopeId: "year-a",
    batchId: null,
    ...overrides,
  };
}

async function completeTaskAction(input: {
  client: Client;
  ledger: ActionLedgerService;
  actionId: string;
  taskId: string;
  title?: string;
}) {
  await input.ledger.markExecuting("user-a", input.actionId);
  const task = await createPersonalTaskCommand(input.client, {
    resourceId: input.taskId,
    userId: "user-a",
    yearId: "year-a",
    title: input.title ?? input.taskId,
    notes: null,
    localNote: null,
    startsAt: null,
    scheduledAt: null,
    dueAt: null,
    subjectId: "subject-a",
  });
  await input.ledger.complete("user-a", input.actionId, {
    modelProjection: { id: task.id, revision: task.revision },
    uiProjection: { id: task.id, revision: task.revision },
    auditProjection: { outcome: "created", resourceId: task.id },
    resources: [
      {
        resourceKind: "planning-task",
        resourceId: task.id,
        operation: "create",
        beforeRevision: null,
        afterRevision: String(task.revision),
        afterSnapshot: { title: task.title },
      },
    ],
  });
  return task;
}

async function completeEvidenceDecisionAction(input: {
  client: Client;
  ledger: ActionLedgerService;
  actionId: string;
  evidenceId: string;
  decisionId: string;
  previousDecisionId?: string;
}) {
  const previousDecisionId = input.previousDecisionId ?? "decision-included";
  await input.client.batch([
    {
      sql: `INSERT OR IGNORE INTO learning_evidence
            (id, objectiveId, userId) VALUES (?, ?, ?)`,
      args: [input.evidenceId, "objective-a", "user-a"],
    },
    {
      sql: `INSERT OR IGNORE INTO learning_evidence_decisions
            (id, evidenceId, state, reason, actor, idempotencyKey, userId,
             createdAt) VALUES (?, ?, 'included', NULL, 'user', ?, ?, 1)`,
      args: [
        previousDecisionId,
        input.evidenceId,
        `seed:${input.evidenceId}`,
        "user-a",
      ],
    },
  ]);
  await input.ledger.markExecuting("user-a", input.actionId);
  await input.client.execute({
    sql: `INSERT INTO learning_evidence_decisions
          (id, evidenceId, state, reason, actor, idempotencyKey, userId,
           createdAt) VALUES (?, ?, 'excluded', ?, 'user', ?, ?, 2)`,
    args: [
      input.decisionId,
      input.evidenceId,
      "Assistant exclusion",
      input.actionId,
      "user-a",
    ],
  });
  await input.ledger.complete("user-a", input.actionId, {
    modelProjection: { id: input.decisionId, state: "excluded" },
    uiProjection: { id: input.decisionId, state: "excluded" },
    auditProjection: { outcome: "excluded", resourceId: input.evidenceId },
    resources: [
      {
        resourceKind: "learning-evidence",
        resourceId: input.evidenceId,
        operation: "update",
        beforeRevision: previousDecisionId,
        afterRevision: input.decisionId,
        beforeSnapshot: { state: "included", reason: null },
        afterSnapshot: { state: "excluded", reason: "Assistant exclusion" },
      },
    ],
  });
}

async function reserveReady(
  ledger: ActionLedgerService,
  overrides: Partial<ActionReservationInput> = {},
) {
  const reservation = await ledger.reserve(await reservationInput(overrides));
  expect(reservation.state).toBe("ready");
  if (reservation.state !== "ready") throw new Error("Expected ready action");
  return reservation.actionId;
}

describe("durable action ledger", () => {
  test("binds approval to exact input, keeps rejection terminal and requires a fresh key", async () => {
    const { ledger } = await setup();
    const pendingInput = await reservationInput({
      idempotencyKey: "approve-exact",
      approvalMode: "confirm-writes",
    });
    const pending = await ledger.reserve(pendingInput);
    expect(pending.state).toBe("awaiting-approval");
    if (pending.state !== "awaiting-approval") return;

    await expect(
      ledger.resolveApproval({
        userId: "user-a",
        actionId: pending.actionId,
        approvalId: pending.approvalId,
        previewHash: "0".repeat(64),
        decision: "approve",
      }),
    ).rejects.toMatchObject({ code: "preview-stale" });
    const approved = await ledger.resolveApproval({
      userId: "user-a",
      actionId: pending.actionId,
      approvalId: pending.approvalId,
      previewHash: pending.previewHash,
      decision: "approve",
    });
    expect(approved.status).toBe("reserved");
    expect((await ledger.reserve(pendingInput)).state).toBe("ready");
    await expect(
      ledger.reserve({
        ...pendingInput,
        preview: { title: "Changed after approval" },
      }),
    ).rejects.toMatchObject({ code: "preview-stale" });

    const rejectedInput = await reservationInput({
      idempotencyKey: "reject-terminal",
      approvalMode: "confirm-writes",
    });
    const rejectedPending = await ledger.reserve(rejectedInput);
    if (rejectedPending.state !== "awaiting-approval") return;
    const rejected = await ledger.resolveApproval({
      userId: "user-a",
      actionId: rejectedPending.actionId,
      approvalId: rejectedPending.approvalId,
      previewHash: rejectedPending.previewHash,
      decision: "reject",
    });
    expect(rejected.status).toBe("rejected");
    expect(await ledger.reserve(rejectedInput)).toMatchObject({
      state: "terminal",
      status: "rejected",
    });
    expect(
      (
        await ledger.reserve(
          await reservationInput({
            idempotencyKey: "reject-fresh-key",
            approvalMode: "confirm-writes",
          }),
        )
      ).state,
    ).toBe("awaiting-approval");
  });

  test("expires once under concurrent sweepers and never revives an expired action", async () => {
    const { ledger } = await setup();
    const input = await reservationInput({
      idempotencyKey: "expiry-terminal",
      approvalMode: "confirm-writes",
    });
    const pending = await ledger.reserve(input);
    expect(pending.state).toBe("awaiting-approval");
    const future = new Date(Date.now() + 11 * 60_000);
    const sweeps = await Promise.all([
      ledger.expireApprovals({ workerId: "sweeper-a", now: future }),
      ledger.expireApprovals({ workerId: "sweeper-b", now: future }),
    ]);
    expect(sweeps.flat()).toHaveLength(1);
    expect(await ledger.reserve(input)).toMatchObject({
      state: "terminal",
      status: "expired",
    });
    const events = await ledger.listEvents({
      userId: "user-a",
      actionId:
        pending.state === "awaiting-approval" ? pending.actionId : "invalid",
    });
    expect(
      events.filter((event) => event.type === "action.approval-expired"),
    ).toHaveLength(1);
  });

  test("rejects changed arguments for a reserved idempotency key", async () => {
    const { ledger } = await setup();
    const initial = await reservationInput({ idempotencyKey: "same-key" });
    await ledger.reserve(initial);
    await expect(
      ledger.reserve({
        ...initial,
        argumentsHash: await actionHash({ title: "different" }),
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      ledger.reserve({
        ...initial,
        actorKind: "mcp",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  test("rejects credential material in approval resolution metadata", async () => {
    const { ledger } = await setup();
    const pending = await ledger.reserve(
      await reservationInput({
        idempotencyKey: "approval-secret",
        approvalMode: "confirm-writes",
      }),
    );
    if (pending.state !== "awaiting-approval") return;
    await expect(
      ledger.resolveApproval({
        userId: "user-a",
        actionId: pending.actionId,
        approvalId: pending.approvalId,
        previewHash: pending.previewHash,
        decision: "approve",
        resolutionContext: { clientSecret: "never-persist" },
      }),
    ).rejects.toMatchObject({ code: "invalid-state" });
    expect((await ledger.get("user-a", pending.actionId)).status).toBe(
      "awaiting-approval",
    );
  });

  test("coalesces concurrent reservations for one exact idempotency key", async () => {
    const { client, ledger } = await setup();
    const input = await reservationInput({ idempotencyKey: "concurrent-key" });
    const reservations = await Promise.all([
      ledger.reserve(input),
      ledger.reserve(input),
      ledger.reserve(input),
    ]);
    expect(new Set(reservations.map((item) => item.actionId)).size).toBe(1);
    const rows = await client.execute(
      "SELECT COUNT(*) AS count FROM agent_actions WHERE idempotencyKey = 'concurrent-key'",
    );
    expect(Number(rows.rows[0]?.count)).toBe(1);
  });

  test("recovers the create crash window without duplicating the effect", async () => {
    const { client, ledger } = await setup();
    const reservation = await ledger.reserve(
      await reservationInput({ idempotencyKey: "crash-retry" }),
    );
    if (reservation.state !== "ready") return;
    await ledger.markExecuting("user-a", reservation.actionId);
    const command = {
      resourceId: "task-crash",
      userId: "user-a",
      yearId: "year-a",
      title: "Crash-safe task",
      notes: null,
      localNote: null,
      startsAt: null,
      scheduledAt: null,
      dueAt: null,
      subjectId: "subject-a",
    } as const;
    await createPersonalTaskCommand(client, command);
    expect(
      await ledger.reserve(
        await reservationInput({ idempotencyKey: "crash-retry" }),
      ),
    ).toMatchObject({ state: "ready", replayed: true });
    const replayedTask = await createPersonalTaskCommand(client, command);
    expect(replayedTask.revision).toBe(1);
    const count = await client.execute(
      "SELECT COUNT(*) AS count FROM planning_tasks WHERE id = 'task-crash'",
    );
    expect(Number(count.rows[0]?.count)).toBe(1);
    await ledger.complete("user-a", reservation.actionId, {
      modelProjection: { id: replayedTask.id },
      uiProjection: { id: replayedTask.id },
      auditProjection: { outcome: "created" },
      resources: [
        {
          resourceKind: "planning-task",
          resourceId: replayedTask.id,
          operation: "create",
          beforeRevision: null,
          afterRevision: "1",
        },
      ],
    });
    expect((await ledger.get("user-a", reservation.actionId)).status).toBe(
      "completed",
    );
  });

  test("requires resource fences for compensatable completions and binds them on replay", async () => {
    const { client, ledger } = await setup();
    const missingFence = await reserveReady(ledger, {
      idempotencyKey: "missing-completion-fence",
    });
    await ledger.markExecuting("user-a", missingFence);
    await expect(
      ledger.complete("user-a", missingFence, {
        modelProjection: { id: "missing" },
        uiProjection: { id: "missing" },
        auditProjection: { outcome: "created" },
        resources: [],
      }),
    ).rejects.toMatchObject({ code: "invalid-state" });

    const actionId = await reserveReady(ledger, {
      idempotencyKey: "completion-resource-replay",
    });
    const task = await completeTaskAction({
      client,
      ledger,
      actionId,
      taskId: "completion-resource-task",
    });
    const completion = {
      modelProjection: { id: task.id, revision: task.revision },
      uiProjection: { id: task.id, revision: task.revision },
      auditProjection: { outcome: "created", resourceId: task.id },
      resources: [
        {
          resourceKind: "planning-task",
          resourceId: task.id,
          operation: "create" as const,
          beforeRevision: null,
          afterRevision: String(task.revision),
          afterSnapshot: { title: task.title },
        },
      ],
    };
    await ledger.complete("user-a", actionId, completion);
    await expect(
      ledger.complete("user-a", actionId, {
        ...completion,
        resources: [
          {
            ...completion.resources[0]!,
            resourceId: "different-task",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "conflict" });
  });

  test("marks ambiguous crash replay inspect-required instead of retrying", async () => {
    const { ledger } = await setup();
    const input = await reservationInput({
      idempotencyKey: "ambiguous",
      crashRecovery: "inspect-required",
      compensation: "none",
      compensatorId: null,
      approval: "never",
    });
    const reservation = await ledger.reserve(input);
    if (reservation.state !== "ready") return;
    await ledger.markExecuting("user-a", reservation.actionId);
    expect(await ledger.reserve(input)).toMatchObject({
      state: "terminal",
      status: "inspect-required",
    });
  });

  test("records compensation as a new approved action and never rewrites the source lifecycle", async () => {
    const { client, ledger } = await setup();
    const sourceId = await reserveReady(ledger, {
      idempotencyKey: "undo-source",
    });
    await completeTaskAction({
      client,
      ledger,
      actionId: sourceId,
      taskId: "task-undo",
    });
    const preview = await ledger.previewUndo("user-a", [sourceId]);
    expect(preview.eligible).toEqual([sourceId]);
    const result = await ledger.executeUndo({ userId: "user-a", preview });
    expect(result).toMatchObject({ complete: true, partial: false });
    const source = await ledger.get("user-a", sourceId);
    expect(source.status).toBe("completed");
    expect(source.undoState).toBe("compensated");
    const compensation = await ledger.get(
      "user-a",
      result.outcomes[0]!.compensationActionId!,
    );
    expect(compensation).toMatchObject({
      status: "completed",
      compensationOfActionId: sourceId,
      actorKind: "user-undo",
      approval: { state: "approved" },
    });
    expect(
      (
        await getPersonalTaskCommand(client, {
          userId: "user-a",
          taskId: "task-undo",
          includeTrashed: true,
        })
      ).trashedAt,
    ).toBeInstanceOf(Date);
  }, 15_000);

  test("undoes an evidence exclusion by appending a fenced correction", async () => {
    const { client } = await setup();
    const recomputed: string[] = [];
    const ledger = new ActionLedgerService(client, {
      recomputeLearningMastery: async (_userId, objectiveId) => {
        recomputed.push(objectiveId);
      },
    });
    const sourceId = await reserveReady(ledger, {
      idempotencyKey: "evidence-exclusion-source",
      toolId: "learning.evidence.decide",
      effect: "update",
      approval: "never",
      compensation: "supported",
      compensatorId: "learning.evidence.restore-decision@1",
      crashRecovery: "idempotent-retry",
      domainScopeKind: "learning-evidence",
      domainScopeId: "evidence-a",
    });
    await completeEvidenceDecisionAction({
      client,
      ledger,
      actionId: sourceId,
      evidenceId: "evidence-a",
      decisionId: "decision-excluded",
    });

    const preview = await ledger.previewUndo("user-a", [sourceId]);
    expect(preview.eligible).toEqual([sourceId]);
    const result = await ledger.executeUndo({ userId: "user-a", preview });
    expect(result).toMatchObject({ complete: true, partial: false });
    expect(recomputed).toEqual(["objective-a"]);
    const latest = await client.execute({
      sql: `SELECT state, reason, actor FROM learning_evidence_decisions
            WHERE evidenceId = ? AND userId = ?
            ORDER BY createdAt DESC, id DESC LIMIT 1`,
      args: ["evidence-a", "user-a"],
    });
    expect(latest.rows[0]).toMatchObject({
      state: "included",
      reason: null,
      actor: "system-correction",
    });
    expect(await ledger.get("user-a", sourceId)).toMatchObject({
      status: "completed",
      undoState: "compensated",
    });
  }, 15_000);

  test("never overwrites a later manual evidence decision during undo", async () => {
    const { client, ledger } = await setup();
    const sourceId = await reserveReady(ledger, {
      idempotencyKey: "evidence-conflict-source",
      toolId: "learning.evidence.decide",
      effect: "update",
      approval: "never",
      compensation: "supported",
      compensatorId: "learning.evidence.restore-decision@1",
      crashRecovery: "idempotent-retry",
      domainScopeKind: "learning-evidence",
      domainScopeId: "evidence-conflict",
    });
    await completeEvidenceDecisionAction({
      client,
      ledger,
      actionId: sourceId,
      evidenceId: "evidence-conflict",
      decisionId: "decision-excluded-conflict",
    });
    await client.execute({
      sql: `INSERT INTO learning_evidence_decisions
            (id, evidenceId, state, reason, actor, idempotencyKey, userId,
             createdAt) VALUES (?, ?, 'included', ?, 'user', ?, ?, 3)`,
      args: [
        "decision-later-human",
        "evidence-conflict",
        "Later human choice",
        "later-human-choice",
        "user-a",
      ],
    });

    const source = await ledger.get("user-a", sourceId);
    expect(source).toMatchObject({
      undoState: "conflicted",
      undoReasonCode: "resource-revision-changed",
    });
    const preview = await ledger.previewUndo("user-a", [sourceId]);
    expect(preview.conflicted).toEqual([sourceId]);
    const result = await ledger.executeUndo({ userId: "user-a", preview });
    expect(result.outcomes[0]).toMatchObject({ state: "conflicted" });
    const decisions = await client.execute({
      sql: `SELECT state, reason FROM learning_evidence_decisions
            WHERE evidenceId = ? ORDER BY createdAt, id`,
      args: ["evidence-conflict"],
    });
    expect(decisions.rows).toHaveLength(3);
    expect(decisions.rows.at(-1)).toMatchObject({
      state: "included",
      reason: "Later human choice",
    });
  });

  test("conflicts instead of overwriting a later manual edit", async () => {
    const { client, ledger } = await setup();
    const sourceId = await reserveReady(ledger, {
      idempotencyKey: "manual-edit-source",
    });
    await completeTaskAction({
      client,
      ledger,
      actionId: sourceId,
      taskId: "task-edited",
    });
    await client.execute({
      sql: "UPDATE planning_tasks SET title = ?, revision = revision + 1 WHERE id = ?",
      args: ["Human edit", "task-edited"],
    });
    const source = await ledger.get("user-a", sourceId);
    expect(source).toMatchObject({
      status: "completed",
      undoState: "conflicted",
      undoReasonCode: "resource-revision-changed",
    });
    const preview = await ledger.previewUndo("user-a", [sourceId]);
    expect(preview.conflicted).toEqual([sourceId]);
    const result = await ledger.executeUndo({ userId: "user-a", preview });
    expect(result).toMatchObject({ complete: false, partial: false });
    expect(result.outcomes[0]?.state).toBe("conflicted");
    expect(
      await getPersonalTaskCommand(client, {
        userId: "user-a",
        taskId: "task-edited",
      }),
    ).toMatchObject({ title: "Human edit", trashedAt: null });
    const resolved = await ledger.resolveConflict({
      userId: "user-a",
      actionId: sourceId,
      resolution: "keep-current",
    });
    expect(resolved).toMatchObject({
      undoState: "blocked",
      undoReasonCode: "conflict-kept-current",
    });
    expect(
      await ledger.resolveConflict({
        userId: "user-a",
        actionId: sourceId,
        resolution: "keep-current",
      }),
    ).toMatchObject({
      undoState: "blocked",
      undoReasonCode: "conflict-kept-current",
    });
    expect(
      (await ledger.previewUndo("user-a", [sourceId])).blocked,
    ).toContain(sourceId);
  });

  test("validates tenant and provider ownership on canonical task commands", async () => {
    const { client, ledger } = await setup();
    const sourceId = await reserveReady(ledger, {
      idempotencyKey: "owned-source",
    });
    await completeTaskAction({
      client,
      ledger,
      actionId: sourceId,
      taskId: "owned-task",
    });
    await expect(
      ledger.previewUndo("user-b", [sourceId]),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      trashPersonalTaskCommand(client, {
        userId: "user-b",
        taskId: "owned-task",
        expectedRevision: 1,
      }),
    ).rejects.toBeInstanceOf(PersonalTaskCommandError);

    const now = Math.floor(Date.now() / 1_000);
    await client.execute({
      sql: `INSERT INTO planning_tasks
        (id, title, status, sortOrder, revision, yearId, userId,
         sourceConnectionId, externalId, syncState, createdAt, updatedAt)
        VALUES (?, ?, 'todo', 0, 1, ?, ?, ?, ?, 'managed', ?, ?)`,
      args: [
        "provider-task",
        "Provider fact",
        "year-a",
        "user-a",
        "connection-a",
        "remote-a",
        now,
        now,
      ],
    });
    await expect(
      trashPersonalTaskCommand(client, {
        userId: "user-a",
        taskId: "provider-task",
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await client.execute({
      sql: "UPDATE planning_tasks SET trashedAt = ? WHERE id = ?",
      args: [now, "provider-task"],
    });
    await expect(
      restorePersonalTaskCommand(client, {
        userId: "user-a",
        taskId: "provider-task",
        expectedRevision: 1,
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  test("serializes dependency fences, rejects cycles and compensates reverse-topologically across batches", async () => {
    const { client, ledger } = await setup();
    const batchA = await ledger.createBatch({
      userId: "user-a",
      label: "batch-a",
    });
    const batchB = await ledger.createBatch({
      userId: "user-a",
      label: "batch-b",
    });
    const predecessor = await reserveReady(ledger, {
      idempotencyKey: "dependency-predecessor",
      batchId: batchA.id,
    });
    const dependant = await reserveReady(ledger, {
      idempotencyKey: "dependency-dependant",
      batchId: batchB.id,
    });
    expect(
      await ledger.addDependency({
        userId: "user-a",
        actionId: dependant,
        dependsOnActionId: predecessor,
        scopeKind: "domain",
        scopeId: "academic-year:year-a",
        relation: "resource",
        expectedFenceVersion: 0,
      }),
    ).toBe(1);
    expect(
      await ledger.addDependency({
        userId: "user-a",
        actionId: dependant,
        dependsOnActionId: predecessor,
        scopeKind: "domain",
        scopeId: "academic-year:year-a",
        relation: "resource",
        expectedFenceVersion: 1,
      }),
    ).toBe(1);
    await expect(
      ledger.addDependency({
        userId: "user-a",
        actionId: predecessor,
        dependsOnActionId: dependant,
        scopeKind: "domain",
        scopeId: "academic-year:year-a",
        relation: "resource",
        expectedFenceVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "dependency-cycle" });
    await completeTaskAction({
      client,
      ledger,
      actionId: predecessor,
      taskId: "task-predecessor",
    });
    await completeTaskAction({
      client,
      ledger,
      actionId: dependant,
      taskId: "task-dependant",
    });
    await ledger.completeBatch({ userId: "user-a", batchId: batchA.id });
    await ledger.completeBatch({ userId: "user-a", batchId: batchB.id });
    const preview = await ledger.previewUndo("user-a", [predecessor]);
    expect(preview.actionIds).toEqual(
      expect.arrayContaining([predecessor, dependant]),
    );
    expect(preview.reverseTopologicalOrder).toEqual([dependant, predecessor]);
    expect((await ledger.previewUndo("user-a", [dependant])).actionIds).toEqual(
      expect.arrayContaining([predecessor, dependant]),
    );
    const undone = await ledger.executeUndo({ userId: "user-a", preview });
    expect(undone.outcomes.map((item) => item.sourceActionId)).toEqual([
      dependant,
      predecessor,
    ]);
    expect(undone.complete).toBe(true);
  }, 45_000);

  test("does not execute before dependencies complete or label a failed batch completed", async () => {
    const { client, ledger } = await setup();
    const batch = await ledger.createBatch({ userId: "user-a" });
    const predecessor = await reserveReady(ledger, {
      idempotencyKey: "execution-predecessor",
    });
    const dependant = await reserveReady(ledger, {
      idempotencyKey: "execution-dependant",
      batchId: batch.id,
    });
    await ledger.addDependency({
      userId: "user-a",
      actionId: dependant,
      dependsOnActionId: predecessor,
      scopeKind: "domain",
      scopeId: "academic-year:year-a",
      relation: "explicit",
      expectedFenceVersion: 0,
    });
    await expect(
      ledger.markExecuting("user-a", dependant),
    ).rejects.toMatchObject({ code: "dependency-pending" });
    expect((await ledger.get("user-a", dependant)).status).toBe("reserved");
    await completeTaskAction({
      client,
      ledger,
      actionId: predecessor,
      taskId: "execution-predecessor-task",
    });
    await ledger.markExecuting("user-a", dependant);
    await ledger.fail(
      "user-a",
      dependant,
      { code: "EXECUTION_FAILED", message: "Safe failure", retryable: false },
      false,
    );
    await expect(
      ledger.completeBatch({ userId: "user-a", batchId: batch.id }),
    ).rejects.toMatchObject({ code: "invalid-state" });
    await ledger.completeBatch({
      userId: "user-a",
      batchId: batch.id,
      failed: true,
    });
  });

  test("serializes opposite branch/domain edges so concurrent workers cannot commit a cycle", async () => {
    const { ledger } = await setup();
    const left = await reserveReady(ledger, {
      idempotencyKey: "cycle-left",
      threadId: "thread-a",
      branchId: "branch-a",
    });
    const right = await reserveReady(ledger, {
      idempotencyKey: "cycle-right",
      threadId: "thread-a",
      branchId: "branch-a",
    });
    const attempts = await Promise.allSettled([
      ledger.addDependency({
        userId: "user-a",
        actionId: left,
        dependsOnActionId: right,
        scopeKind: "branch",
        scopeId: "branch-a",
        relation: "explicit",
        expectedFenceVersion: 0,
      }),
      ledger.addDependency({
        userId: "user-a",
        actionId: right,
        dependsOnActionId: left,
        scopeKind: "domain",
        scopeId: "academic-year:year-a",
        relation: "resource",
        expectedFenceVersion: 0,
      }),
    ]);
    expect(
      attempts.filter((attempt) => attempt.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      attempts.filter((attempt) => attempt.status === "rejected"),
    ).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect((rejected as PromiseRejectedResult).reason).toBeInstanceOf(
      ActionLedgerError,
    );
    expect(await ledger.dependencyFenceVersion("user-a")).toBe(1);
    const retry =
      attempts[0]?.status === "fulfilled"
        ? {
            actionId: right,
            dependsOnActionId: left,
            scopeKind: "domain" as const,
            scopeId: "academic-year:year-a",
            relation: "resource" as const,
          }
        : {
            actionId: left,
            dependsOnActionId: right,
            scopeKind: "branch" as const,
            scopeId: "branch-a",
            relation: "explicit" as const,
          };
    await expect(
      ledger.addDependency({
        userId: "user-a",
        ...retry,
        expectedFenceVersion: 1,
      }),
    ).rejects.toMatchObject({ code: "dependency-cycle" });
  });

  test("reports partial truth, blocks unsafe predecessors and continues an independent component", async () => {
    const { client, ledger } = await setup();
    const predecessor = await reserveReady(ledger, {
      idempotencyKey: "partial-predecessor",
    });
    const dependant = await reserveReady(ledger, {
      idempotencyKey: "partial-dependant",
    });
    const independent = await reserveReady(ledger, {
      idempotencyKey: "partial-independent",
    });
    await ledger.addDependency({
      userId: "user-a",
      actionId: dependant,
      dependsOnActionId: predecessor,
      scopeKind: "domain",
      scopeId: "academic-year:year-a",
      relation: "resource",
      expectedFenceVersion: 0,
    });
    for (const [actionId, taskId] of [
      [predecessor, "partial-task-predecessor"],
      [dependant, "partial-task-dependant"],
      [independent, "partial-task-independent"],
    ] as const) {
      await completeTaskAction({ client, ledger, actionId, taskId });
    }
    await client.execute(
      "UPDATE planning_tasks SET revision = revision + 1 WHERE id = 'partial-task-dependant'",
    );
    const preview = await ledger.previewUndo("user-a", [
      predecessor,
      independent,
    ]);
    const result = await ledger.executeUndo({ userId: "user-a", preview });
    expect(result).toMatchObject({ complete: false, partial: true });
    expect(
      Object.fromEntries(
        result.outcomes.map((outcome) => [
          outcome.sourceActionId,
          outcome.state,
        ]),
      ),
    ).toMatchObject({
      [dependant]: "conflicted",
      [predecessor]: "blocked",
      [independent]: "compensated",
    });
  });

  test("retries only a proven pre-effect compensation failure as a new action", async () => {
    const { client, ledger } = await setup();
    const sourceId = await reserveReady(ledger, {
      idempotencyKey: "retry-compensation-source",
    });
    await completeTaskAction({
      client,
      ledger,
      actionId: sourceId,
      taskId: "retry-compensation-task",
    });
    const now = Math.floor(Date.now() / 1_000);
    await client.batch([
      {
        sql: `UPDATE agent_action_sequences SET nextSequence = 2,
              updatedAt = ? WHERE userId = 'user-a'`,
        args: [now],
      },
      {
        sql: `INSERT INTO agent_actions
          (id, userId, actorKind, toolId, toolVersion, effect, risk,
           argumentsHash, idempotencyKey, actionSequence, redactedInputJson,
           previewJson, previewHash, status, safeError,
           compensationOfActionId, crashRecovery, completedAt, createdAt)
          VALUES ('failed-compensation', 'user-a', 'user-undo',
                  'planning.tasks.trash-created', 1, 'delete', 'medium', ?,
                  'failed-compensation-attempt', 2, '{}', '{}', ?, 'failed',
                  'EXECUTION_FAILED:Safe pre-effect failure', ?,
                  'idempotent-retry', ?, ?)`,
        args: ["a".repeat(64), "b".repeat(64), sourceId, now, now],
      },
    ]);

    expect((await ledger.get("user-a", sourceId)).undoState).toBe("failed");
    const preview = await ledger.previewUndo("user-a", [sourceId]);
    expect(preview.eligible).toContain(sourceId);
    const result = await ledger.executeUndo({ userId: "user-a", preview });
    expect(result).toMatchObject({ complete: true, partial: false });
    expect(result.outcomes[0]?.compensationActionId).not.toBe(
      "failed-compensation",
    );
    expect(
      (
        await getPersonalTaskCommand(client, {
          userId: "user-a",
          taskId: "retry-compensation-task",
          includeTrashed: true,
        })
      ).trashedAt,
    ).not.toBeNull();
    const source = await ledger.get("user-a", sourceId);
    expect(source.status).toBe("completed");
    expect(source.undoState).toBe("compensated");
    expect(source.compensationActionIds).toHaveLength(2);
  });

  test("filters activity by resource, actor, status and derived undo state", async () => {
    const { client, ledger } = await setup();
    const sourceId = await reserveReady(ledger, {
      idempotencyKey: "activity-source",
    });
    await completeTaskAction({
      client,
      ledger,
      actionId: sourceId,
      taskId: "activity-task",
    });
    expect(
      (
        await ledger.list("user-a", {
          limit: 10,
          resourceKind: "planning-task",
          resourceId: "activity-task",
          actorKind: "embedded-agent",
          status: "completed",
          undoState: "eligible",
        })
      ).items.map((item) => item.id),
    ).toEqual([sourceId]);
    expect(
      (
        await ledger.list("user-a", {
          limit: 10,
          branchId: "branch-a",
        })
      ).items,
    ).toEqual([]);
    expect((await ledger.list("user-b", { limit: 10 })).items).toEqual([]);
  });

  test("reviews only attributable post-cursor branch actions and never selects unrelated work", async () => {
    const { client, ledger } = await setup();
    const attributable = await reserveReady(ledger, {
      idempotencyKey: "historical-attributable",
      threadId: "thread-a",
      branchId: "branch-a",
    });
    await completeTaskAction({
      client,
      ledger,
      actionId: attributable,
      taskId: "historical-attributable-task",
    });
    const unrelated = await reserveReady(ledger, {
      idempotencyKey: "historical-unrelated",
      threadId: null,
      branchId: null,
    });
    await completeTaskAction({
      client,
      ledger,
      actionId: unrelated,
      taskId: "historical-unrelated-task",
    });

    const review = await ledger.reviewBranchSince({
      userId: "user-a",
      branchId: "branch-a",
      domainCursorRef: "domain:user-a:0",
    });
    expect(review.safeToCompensate.map((action) => action.id)).toEqual([
      attributable,
    ]);
    expect(review.unrelatedActionCount).toBe(1);
    expect(review.undoPreview?.actionIds).toEqual([attributable]);
    expect(review.conflicted).toEqual([]);
    expect(review.alreadyCompensated).toEqual([]);
    expect(review.nonUndoable).toEqual([]);
    await expect(
      ledger.reviewBranchSince({
        userId: "user-b",
        branchId: "branch-a",
        domainCursorRef: "domain:user-a:0",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  test("fails closed before persisting credentials, signed URLs or oversized snapshots", async () => {
    const { client, ledger } = await setup();
    await expect(
      ledger.reserve(
        await reservationInput({
          idempotencyKey: "secret-input",
          redactedInput: { refreshToken: "must-never-persist" },
        }),
      ),
    ).rejects.toBeInstanceOf(ActionLedgerError);
    await expect(
      ledger.reserve(
        await reservationInput({
          idempotencyKey: "signed-preview",
          preview: {
            url: "https://storage.invalid/a?X-Amz-Signature=secret",
          },
        }),
      ),
    ).rejects.toBeInstanceOf(ActionLedgerError);
    const rows = await client.execute(
      "SELECT COUNT(*) AS count FROM agent_actions",
    );
    expect(Number(rows.rows[0]?.count)).toBe(0);
  });

  test("expires an approved reservation when its recomputed preview is stale", async () => {
    const { ledger } = await setup();
    const pending = await ledger.reserve(
      await reservationInput({
        idempotencyKey: "stale-approved-preview",
        approvalMode: "confirm-writes",
      }),
    );
    if (pending.state !== "awaiting-approval") {
      throw new Error("Expected an approval reservation");
    }
    await ledger.resolveApproval({
      userId: "user-a",
      actionId: pending.actionId,
      approvalId: pending.approvalId,
      previewHash: pending.previewHash,
      decision: "approve",
    });
    await ledger.fail(
      "user-a",
      pending.actionId,
      {
        code: "PREVIEW_STALE",
        message: "The owned resource changed after approval",
        retryable: false,
      },
      false,
    );
    const expired = await ledger.get("user-a", pending.actionId);
    expect(expired.status).toBe("expired");
    expect(expired.approval?.state).toBe("expired");
  });

  test("approval resumes the exact private continuation without a second client submission", async () => {
    const { ledger } = await setup();
    const continuations = new InMemoryToolActionContinuationStore();
    const registry = new ToolRegistry();
    let executions = 0;
    const budget = { maxBytes: 16_384, maxDepth: 8, maxItems: 100 };
    const output = z.strictObject({ id: z.string(), title: z.string() });
    registry.register({
      id: "tests.private_create",
      version: 1,
      title: "Private create",
      description: "Exercise an approval continuation.",
      inputSchema: z.strictObject({
        title: z.string().min(1),
        privateNotes: z.string().min(1),
      }),
      outputSchema: output,
      requiredScopes: ["avermate:planner.write"],
      effect: "create",
      risk: "medium",
      approval: "policy",
      idempotency: "required",
      preview: "required",
      compensation: "none",
      crashRecovery: "idempotent-retry",
      inputBudget: budget,
      resultBudget: budget,
      redact: (value) => ({ title: value.title, privateNotes: "[redacted]" }),
      buildActionPreview: async (_context, value) => ({
        title: value.title,
        consequence: "Create one fixture",
      }),
      execute: async (context, value) => {
        expect(context.actionReference).toBeTruthy();
        executions += 1;
        return { id: "fixture-1", title: value.title };
      },
      resultProjections: {
        model: { schema: output, budget, project: (value) => value },
        ui: { schema: output, budget, project: (value) => value },
        audit: {
          schema: z.strictObject({ outcome: z.literal("created") }),
          budget,
          project: () => ({ outcome: "created" as const }),
        },
      },
    });
    const broker = new ToolBroker(
      registry,
      undefined,
      undefined,
      continuations,
    );
    const context = broker.createContext({
      principal: {
        userId: "user-a",
        clientId: "web:test-session",
        scopes: new Set(["avermate:planner.write"]),
      },
      actionActorKind: "embedded-agent",
      approvalMode: "confirm-writes",
      approvalProof: null,
      threadId: null,
      branchId: null,
      runId: null,
      toolCallId: "tool-call-private",
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 30_000),
      capabilities: noOpToolCapabilities,
      events: noOpToolEvents,
      actionLedger: new DurableToolActionLedgerWriter(
        ledger,
        "embedded-agent",
        "user-a",
      ),
    });
    const reserved = await broker.invoke(context, {
      toolId: "tests.private_create",
      toolVersion: 1,
      input: { title: "Exact title", privateNotes: "never audit this" },
      idempotencyKey: "private-continuation",
    });
    expect(reserved.model.error?.code).toBe("APPROVAL_REQUIRED");
    expect(executions).toBe(0);
    const actionId = reserved.model.error?.actionId!;
    const approvalId = reserved.model.error?.approvalId!;
    const previewHash = reserved.model.error?.previewHash!;
    const before = await ledger.get("user-a", actionId);
    expect(before.redactedInput).toEqual({
      title: "Exact title",
      privateNotes: "[redacted]",
    });
    expect(JSON.stringify(before)).not.toContain("never audit this");

    const resume = (channel: string) =>
      resolveApprovalAndResume({
        ledger,
        broker,
        userId: "user-a",
        resolution: {
          actionId,
          approvalId,
          previewHash,
          decision: "approve" as const,
        },
        resolutionContext: { channel },
        continuations,
      });
    await Promise.all([resume("test-a"), resume("test-b"), resume("test-c")]);
    const completed = await ledger.get("user-a", actionId);
    expect(completed.status).toBe("completed");
    expect(completed.resultSummary).toEqual({ outcome: "created" });
    expect(executions).toBe(1);
    expect(await continuations.load("user-a", actionId)).toBeNull();

    const replay = await resolveApprovalAndResume({
      ledger,
      broker,
      userId: "user-a",
      resolution: {
        actionId,
        approvalId,
        previewHash,
        decision: "approve",
      },
      resolutionContext: { channel: "test-replay" },
      continuations,
    });
    expect(replay.status).toBe("completed");
    expect(executions).toBe(1);
  });

  test("startup reconciliation replays an approved idempotent action after its durable claim", async () => {
    const { ledger } = await setup();
    const continuations = new InMemoryToolActionContinuationStore();
    let executions = 0;
    const budget = { maxBytes: 16_384, maxDepth: 8, maxItems: 100 };
    const output = z.strictObject({ id: z.string(), title: z.string() });
    const buildBroker = () => {
      const registry = new ToolRegistry();
      registry.register({
        id: "tests.restart_create",
        version: 1,
        title: "Restart-safe create",
        description: "Exercise process restart reconciliation.",
        inputSchema: z.strictObject({ title: z.string().min(1) }),
        outputSchema: output,
        requiredScopes: ["avermate:planner.write"],
        effect: "create",
        risk: "medium",
        approval: "policy",
        idempotency: "required",
        preview: "required",
        compensation: "none",
        crashRecovery: "idempotent-retry",
        inputBudget: budget,
        resultBudget: budget,
        redact: (value) => ({ title: value.title }),
        buildActionPreview: async (_context, value) => ({
          title: value.title,
          consequence: "Create one restart fixture",
        }),
        execute: async (_context, value) => {
          executions += 1;
          return { id: "restart-fixture-1", title: value.title };
        },
        resultProjections: {
          model: { schema: output, budget, project: (value) => value },
          ui: { schema: output, budget, project: (value) => value },
          audit: {
            schema: z.strictObject({ outcome: z.literal("created") }),
            budget,
            project: () => ({ outcome: "created" as const }),
          },
        },
      });
      return new ToolBroker(registry, undefined, undefined, continuations);
    };
    const firstBroker = buildBroker();
    const context = firstBroker.createContext({
      principal: {
        userId: "user-a",
        clientId: "web:restart-test",
        scopes: new Set(["avermate:planner.write"]),
      },
      actionActorKind: "embedded-agent",
      approvalMode: "confirm-writes",
      approvalProof: null,
      threadId: null,
      branchId: null,
      runId: null,
      toolCallId: "tool-call-restart",
      signal: new AbortController().signal,
      deadline: new Date(Date.now() + 30_000),
      capabilities: noOpToolCapabilities,
      events: noOpToolEvents,
      actionLedger: new DurableToolActionLedgerWriter(
        ledger,
        "embedded-agent",
        "user-a",
      ),
    });
    const pending = await firstBroker.invoke(context, {
      toolId: "tests.restart_create",
      toolVersion: 1,
      input: { title: "Resume me" },
      idempotencyKey: "restart-continuation",
    });
    expect(pending.model.error?.code).toBe("APPROVAL_REQUIRED");
    const actionId = pending.model.error?.actionId!;
    await ledger.resolveApproval({
      userId: "user-a",
      actionId,
      approvalId: pending.model.error?.approvalId!,
      previewHash: pending.model.error?.previewHash!,
      decision: "approve",
      resolutionContext: { channel: "restart-fixture" },
    });
    // This is the exact durable crash window: approval committed and execution
    // claimed, but the old process never reached the descriptor.
    await ledger.markExecuting("user-a", actionId);
    expect((await ledger.get("user-a", actionId)).status).toBe("executing");
    expect(executions).toBe(0);

    const recovered = await recoverInterruptedActions({
      ledger,
      continuations,
      brokerForOwner: async () => buildBroker(),
    });
    expect(recovered).toEqual({
      resumed: [actionId],
      inspectRequired: [],
      failed: [],
      deferred: [],
    });
    expect((await ledger.get("user-a", actionId)).status).toBe("completed");
    expect(executions).toBe(1);
    expect(await continuations.load("user-a", actionId)).toBeNull();
  });

  test("startup reconciliation fails ambiguous interrupted effects closed", async () => {
    const { ledger } = await setup();
    const continuations = new InMemoryToolActionContinuationStore();
    const actionId = await reserveReady(ledger, {
      idempotencyKey: "ambiguous-restart",
      crashRecovery: "inspect-required",
    });
    await ledger.markExecuting("user-a", actionId);
    let brokerRequested = false;
    const recovered = await recoverInterruptedActions({
      ledger,
      continuations,
      brokerForOwner: async () => {
        brokerRequested = true;
        return new ToolBroker(new ToolRegistry());
      },
    });
    expect(recovered.inspectRequired).toEqual([actionId]);
    expect(brokerRequested).toBe(false);
    expect((await ledger.get("user-a", actionId)).status).toBe(
      "inspect-required",
    );
  });
});
