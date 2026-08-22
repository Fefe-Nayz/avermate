import { describe, expect, test } from "bun:test";
import { z } from "zod";
import type {
  AgentActionReservation,
  AvermateToolDescriptor,
  ToolApprovalProof,
  ToolActionLedgerWriter,
  ToolExecutionContext,
} from "@avermate/agent-contracts";
import { noOpActionLedger, noOpToolCapabilities, ToolBroker } from "./broker";
import { ToolRegistry } from "./registry";

const budget = { maxBytes: 16_384, maxDepth: 8, maxItems: 100 } as const;
const outputSchema = z.strictObject({
  id: z.string(),
  count: z.number().int(),
});
const projectionSchema = z.strictObject({
  id: z.string(),
  count: z.number().int(),
});
const auditSchema = z.strictObject({
  id: z.string(),
  outcome: z.literal("created"),
});

class MemoryActionLedger implements ToolActionLedgerWriter {
  readonly kind = "durable" as const;
  readonly rows = new Map<
    string,
    {
      actionId: string;
      argumentsHash: string;
      state: "ready" | "executing" | "completed" | "failed";
      projections?: {
        modelProjection: unknown;
        uiProjection: unknown;
        auditProjection: unknown;
      };
    }
  >();

  async prepare(
    input: Parameters<ToolActionLedgerWriter["prepare"]>[0],
  ): Promise<AgentActionReservation> {
    const key = `${input.userId}:${input.toolId}:${input.toolVersion}:${input.idempotencyKey}`;
    const existing = this.rows.get(key);
    if (existing) {
      if (existing.argumentsHash !== input.argumentsHash) {
        throw Object.assign(new Error("idempotency conflict"), {
          name: "ActionLedgerError",
          code: "conflict",
        });
      }
      if (existing.state === "completed") {
        return {
          state: "completed",
          actionId: existing.actionId,
          ...existing.projections!,
        };
      }
      return { state: "ready", actionId: existing.actionId, replayed: true };
    }
    const actionId = `action-${this.rows.size + 1}`;
    this.rows.set(key, {
      actionId,
      argumentsHash: input.argumentsHash,
      state: "ready",
    });
    if (
      input.approval === "always" ||
      input.approvalMode === "confirm" ||
      input.approvalMode === "confirm-writes"
    ) {
      return {
        state: "awaiting-approval",
        actionId,
        approvalId: `approval-${actionId}`,
        previewHash: "a".repeat(64),
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      };
    }
    return { state: "ready", actionId, replayed: false };
  }

  async markExecuting(reference: string) {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.actionId === reference,
    )!;
    row.state = "executing";
  }

  async complete(
    reference: string,
    input: Parameters<ToolActionLedgerWriter["complete"]>[1],
  ) {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.actionId === reference,
    )!;
    row.state = "completed";
    row.projections = input;
  }

  async fail(reference: string) {
    const row = [...this.rows.values()].find(
      (candidate) => candidate.actionId === reference,
    );
    if (row) row.state = "failed";
  }
}

function descriptor(
  execute: (
    context: ToolExecutionContext,
    input: { title: string },
  ) => Promise<{
    id: string;
    count: number;
  }>,
): AvermateToolDescriptor<
  { title: string },
  { id: string; count: number },
  { id: string; count: number },
  { id: string; count: number },
  { id: string; outcome: "created" }
> {
  return {
    id: "planner.create",
    version: 1,
    title: "Create task",
    description: "Create a personal planning task.",
    inputSchema: z.strictObject({ title: z.string().min(1).max(100) }),
    outputSchema,
    requiredScopes: ["avermate:planner.write"],
    effect: "create",
    risk: "medium",
    approval: "policy",
    idempotency: "required",
    preview: "supported",
    compensation: "supported",
    compensatorId: "planner.trash@1",
    crashRecovery: "idempotent-retry",
    inputBudget: budget,
    resultBudget: budget,
    redact: (input) => ({ title: input.title }),
    execute,
    actionResources: (_input, output) => [
      {
        resourceKind: "planning-task",
        resourceId: output.id,
        operation: "create",
        beforeRevision: null,
        afterRevision: String(output.count),
      },
    ],
    resultProjections: {
      model: { schema: projectionSchema, budget, project: (output) => output },
      ui: { schema: projectionSchema, budget, project: (output) => output },
      audit: {
        schema: auditSchema,
        budget,
        project: (output) => ({ id: output.id, outcome: "created" }),
      },
    },
  };
}

function setup(
  options: { scopes?: string[]; approvalProof?: ToolApprovalProof } = {},
) {
  const events: string[] = [];
  let executions = 0;
  const registry = new ToolRegistry();
  registry.register(
    descriptor(async () => {
      executions += 1;
      return { id: "task-1", count: executions };
    }),
  );
  const actionLedger = new MemoryActionLedger();
  const broker = new ToolBroker(registry);
  const context = broker.createContext({
    principal: {
      userId: "user-1",
      clientId: "client-1",
      scopes: new Set(options.scopes ?? ["avermate:planner.write"]),
    },
    approvalMode: "auto",
    approvalProof: options.approvalProof,
    threadId: "thread-1",
    branchId: "branch-1",
    runId: "run-1",
    toolCallId: "call-1",
    signal: new AbortController().signal,
    deadline: new Date(Date.now() + 60_000),
    capabilities: noOpToolCapabilities,
    events: { publish: (event) => void events.push(event.kind) },
    actionLedger,
  });
  return {
    broker,
    context,
    events,
    actionLedger,
    executions: () => executions,
  };
}

describe("ToolBroker", () => {
  test("executes the ordered pipeline and validates three projections", async () => {
    const { broker, context, events } = setup();
    const result = await broker.invoke(context, {
      toolId: "planner.create",
      toolVersion: 1,
      input: { title: "Read chapter 2" },
      idempotencyKey: "idem-1",
    });
    expect(result.model).toEqual({
      ok: true,
      data: { id: "task-1", count: 1 },
    });
    expect(result.audit).toEqual({
      ok: true,
      data: { id: "task-1", outcome: "created" },
    });
    expect(events).toEqual(["queued", "started", "result"]);
  });

  test("rejects client authority fields and missing scopes before execution", async () => {
    const unscoped = setup({ scopes: [] });
    const denied = await unscoped.broker.invoke(unscoped.context, {
      toolId: "planner.create",
      toolVersion: 1,
      input: { title: "x" },
      idempotencyKey: "idem-2",
    });
    expect(denied.model.error?.code).toBe("SCOPE_DENIED");
    expect(unscoped.executions()).toBe(0);

    const injected = setup();
    const rejected = await injected.broker.invoke(injected.context, {
      toolId: "planner.create",
      toolVersion: 1,
      input: { title: "x", userId: "victim", risk: "low" },
      idempotencyKey: "idem-3",
    });
    expect(rejected.model.error?.code).toBe("INVALID_INPUT");
    expect(injected.executions()).toBe(0);
  });

  test("replays completed projections and changed arguments conflict", async () => {
    const { broker, context, executions } = setup();
    const input = {
      toolId: "planner.create",
      toolVersion: 1,
      input: { title: "same" },
      idempotencyKey: "idem-replay",
    } as const;
    expect((await broker.invoke(context, input)).model.ok).toBe(true);
    const replay = await broker.invoke(context, input);
    expect(replay.model.replayed).toBe(true);
    expect(executions()).toBe(1);

    const conflict = await broker.invoke(context, {
      ...input,
      input: { title: "changed" },
    });
    expect(conflict.model.error?.code).toBe("IDEMPOTENCY_CONFLICT");
    expect(executions()).toBe(1);
  });

  test("requires exact approval when policy is confirm", async () => {
    const { broker, context, executions } = setup();
    context.approvalMode = "confirm";
    context.approvalProof = {
      proofId: "forged-proof",
      userId: context.principal.userId,
      clientId: context.principal.clientId,
      toolId: "planner.create",
      toolVersion: 1,
      argumentsHash: "0".repeat(64),
      branchId: context.branchId,
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    };
    const result = await broker.invoke(context, {
      toolId: "planner.create",
      toolVersion: 1,
      input: { title: "confirm me" },
      idempotencyKey: "idem-approval",
    });
    expect(result.model.error?.code).toBe("APPROVAL_REQUIRED");
    expect(executions()).toBe(0);
  });

  test("fails closed for no-op ledgers, external, custom, provider and admin writes", async () => {
    const noLedger = setup();
    noLedger.context.actionLedger = noOpActionLedger;
    expect(
      (
        await noLedger.broker.invoke(noLedger.context, {
          toolId: "planner.create",
          toolVersion: 1,
          input: { title: "must not run" },
          idempotencyKey: "no-ledger",
        })
      ).model.error?.code,
    ).toBe("ACTION_LEDGER_REQUIRED");
    expect(noLedger.executions()).toBe(0);

    for (const [toolId, effect] of [
      ["admin.rotate", "create"],
      ["provider.sync", "update"],
      ["custom.unreviewed_write", "update"],
      ["remote.send", "external"],
    ] as const) {
      const registry = new ToolRegistry();
      registry.register({
        ...descriptor(async () => ({ id: "never", count: 1 })),
        id: toolId,
        effect,
        compensation: "none",
        compensatorId: undefined,
        crashRecovery: "inspect-required",
      });
      const broker = new ToolBroker(registry);
      const base = setup().context;
      const denied = await broker.invoke(broker.createContext(base), {
        toolId,
        toolVersion: 1,
        input: { title: "blocked" },
        idempotencyKey: `blocked-${toolId}`,
      });
      expect(denied.model.error?.code).toBe("CAPABILITY_MISSING");
    }

    const custom = setup();
    expect(
      (
        await custom.broker.invoke(custom.context, {
          toolId: "custom.unreviewed_write",
          toolVersion: 1,
          input: {},
          idempotencyKey: "custom",
        })
      ).model.error?.code,
    ).toBe("TOOL_NOT_FOUND");
  });

  test("does not accept contexts minted outside the broker", async () => {
    const { broker, context } = setup();
    const forged = { ...context, principal: { ...context.principal } };
    const result = await broker.invoke(forged, {
      toolId: "planner.create",
      toolVersion: 1,
      input: { title: "forged" },
      idempotencyKey: "idem-forged",
    });
    expect(result.model.error?.code).toBe("AUTHENTICATION_REQUIRED");
  });

  test("blocks signed URLs from every persistent audience", async () => {
    const registry = new ToolRegistry();
    registry.register({
      ...descriptor(async () => ({ id: "x", count: 1 })),
      resultProjections: {
        model: {
          schema: z.strictObject({ url: z.string() }),
          budget,
          project: () => ({
            url: "https://storage.invalid/file?X-Amz-Signature=not-a-real-secret",
          }),
        },
        ui: { schema: projectionSchema, budget, project: (output) => output },
        audit: {
          schema: auditSchema,
          budget,
          project: (output) => ({ id: output.id, outcome: "created" as const }),
        },
      },
    });
    const broker = new ToolBroker(registry);
    const base = setup().context;
    const context = broker.createContext(base);
    const result = await broker.invoke(context, {
      toolId: "planner.create",
      toolVersion: 1,
      input: { title: "x" },
      idempotencyKey: "idem-url",
    });
    expect(result.model.error?.code).toBe("EXECUTION_FAILED");
  });
});
