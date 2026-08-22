import { Database } from "bun:sqlite";
import {
  Annotation,
  Command,
  type CommandInstance,
  END,
  START,
  StateGraph,
  interrupt,
  type StateSnapshot,
} from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";
import {
  agentCancelInputSchema,
  agentForkInputSchema,
  agentInspectInputSchema,
  agentResumeInputSchema,
  agentRunInputSchema,
  agentRuntimeStateSchema,
  contextManifestSchema,
  conversationCheckpointRefSchema,
  type AgentCancelInput,
  type AgentForkInput,
  type AgentInspectInput,
  type AgentResumeInput,
  type AgentRunHandle,
  type AgentRunInput,
  type AgentRuntime,
  type AgentRuntimeState,
  type ConversationCheckpointRef,
} from "@avermate/agent-contracts";
import {
  IncompatibleGraphSchemaError,
  SqliteLangGraphCheckpointer,
} from "./langgraph-sqlite-checkpointer";

export const LANGGRAPH_SPIKE_SCHEMA_VERSION = "avermate-agent-graph/1";

const CONVERSATION_REFERENCE_PREFIX = "avermate-conversation-checkpoint:v1:";

type RuntimePhase = AgentRuntimeState["phase"];

type RuntimeRow = {
  run_id: string;
  owner_id: string;
  public_thread_id: string;
  branch_id: string;
  graph_thread_id: string;
  graph_schema_version: string;
  phase: RuntimePhase;
  question: string;
  interrupt_json: string | null;
  current_checkpoint_id: string | null;
  parent_run_id: string | null;
  cancel_reason: string | null;
  created_at: string;
  updated_at: string;
};

type ReferenceRow = {
  ref_id: string;
  owner_id: string;
  run_id: string;
  checkpoint_id: string;
  graph_schema_version: string;
};

type ResolvedCheckpointReference = {
  runId: string;
  checkpointId: string;
};

type ApprovalRequest = {
  kind: "medium-risk";
  action: "record-study-review";
  question: string;
  readResult: string;
};

type ApprovalResume = boolean | { approved: boolean };

const AgentGraphState = Annotation.Root({
  graphSchemaVersion: Annotation<string>,
  ownerId: Annotation<string>,
  runId: Annotation<string>,
  threadId: Annotation<string>,
  branchId: Annotation<string>,
  question: Annotation<string>,
  readResult: Annotation<string>,
  approved: Annotation<boolean>,
  finalAnswer: Annotation<string>,
});

type AgentGraphStateValue = typeof AgentGraphState.State;
type AgentGraphNode = "__start__" | "read_tool" | "approval" | "final";

export type LangGraphAgentRuntimeOptions = {
  /** Test/observability hook; it must never make an authorization decision. */
  onReadTool?: (question: string) => void | Promise<void>;
};

function assertSchemaVersion(observed: string, expected: string): void {
  if (observed !== expected) {
    throw new IncompatibleGraphSchemaError(expected, observed);
  }
}

function readToolResult(question: string): string {
  return `Machine-readable study source for: ${question}`;
}

function parseApprovalResume(value: unknown): ApprovalResume {
  if (typeof value === "boolean") return value;
  if (
    value !== null &&
    typeof value === "object" &&
    "approved" in value &&
    Object.keys(value).length === 1 &&
    typeof value.approved === "boolean"
  ) {
    return { approved: value.approved };
  }
  throw new Error("Approval resume value must explicitly contain a boolean");
}

function approved(value: ApprovalResume): boolean {
  return typeof value === "boolean" ? value : value.approved;
}

function firstUserQuestion(input: AgentRunInput): string {
  const manifest = contextManifestSchema.parse(input.contextManifest);
  const question = manifest.blocks.find(
    (block) => block.trust === "user-instruction",
  )?.content;
  return question && question.trim().length > 0
    ? question
    : "Prepare a concise study review.";
}

function parseReferenceToken(reference: ConversationCheckpointRef): string {
  const value = conversationCheckpointRefSchema.parse(reference);
  if (!value.startsWith(CONVERSATION_REFERENCE_PREFIX)) {
    throw new Error("Not an Avermate conversation checkpoint reference");
  }
  const token = value.slice(CONVERSATION_REFERENCE_PREFIX.length);
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      token,
    )
  ) {
    throw new Error("Invalid Avermate conversation checkpoint reference");
  }
  return token;
}

function checkpointIdFromConfig(config: RunnableConfig): string {
  const value = config.configurable?.checkpoint_id;
  if (typeof value !== "string" || value.length === 0) {
    throw new Error("LangGraph did not return a durable checkpoint ID");
  }
  return value;
}

function interruptFromSnapshot(snapshot: StateSnapshot): unknown | null {
  for (const task of snapshot.tasks) {
    for (const item of task.interrupts) {
      if (item.value !== undefined) return item.value;
    }
  }
  return null;
}

function graphStateFromSnapshot(snapshot: StateSnapshot): AgentGraphStateValue {
  // SAFETY: snapshots are produced by the compiled AgentGraphState graph and
  // are schema-version checked before any state field is used.
  return snapshot.values as AgentGraphStateValue;
}

export class LangGraphAgentRuntime implements AgentRuntime {
  readonly checkpointer: SqliteLangGraphCheckpointer;
  readonly database: Database;
  readonly graphSchemaVersion = LANGGRAPH_SPIKE_SCHEMA_VERSION;
  readonly #activeRuns = new Map<string, AbortController>();
  readonly #graph;

  constructor(
    checkpointer: SqliteLangGraphCheckpointer,
    options: LangGraphAgentRuntimeOptions = {},
  ) {
    assertSchemaVersion(
      checkpointer.graphSchemaVersion,
      LANGGRAPH_SPIKE_SCHEMA_VERSION,
    );
    this.checkpointer = checkpointer;
    this.database = checkpointer.database;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_langgraph_runs (
        run_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        public_thread_id TEXT NOT NULL,
        branch_id TEXT NOT NULL,
        graph_thread_id TEXT UNIQUE NOT NULL,
        graph_schema_version TEXT NOT NULL,
        phase TEXT NOT NULL CHECK (
          phase IN (
            'queued', 'running', 'interrupted', 'finished', 'failed',
            'cancelled'
          )
        ),
        question TEXT NOT NULL,
        interrupt_json TEXT,
        current_checkpoint_id TEXT,
        parent_run_id TEXT,
        cancel_reason TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS agent_langgraph_runs_branch_idx
        ON agent_langgraph_runs(owner_id, public_thread_id, branch_id);

      CREATE TABLE IF NOT EXISTS agent_langgraph_checkpoint_refs (
        ref_id TEXT PRIMARY KEY NOT NULL,
        owner_id TEXT NOT NULL,
        run_id TEXT NOT NULL REFERENCES agent_langgraph_runs(run_id)
          ON DELETE CASCADE,
        checkpoint_id TEXT NOT NULL,
        graph_schema_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(owner_id, run_id, checkpoint_id)
      );
    `);

    const validateStateVersion = (state: AgentGraphStateValue) => {
      assertSchemaVersion(state.graphSchemaVersion, this.graphSchemaVersion);
    };
    this.#graph = new StateGraph(AgentGraphState)
      .addNode("read_tool", async (state) => {
        validateStateVersion(state);
        await options.onReadTool?.(state.question);
        return { readResult: readToolResult(state.question) };
      })
      .addNode("approval", (state) => {
        validateStateVersion(state);
        const decision = interrupt<ApprovalRequest, ApprovalResume>({
          kind: "medium-risk",
          action: "record-study-review",
          question: state.question,
          readResult: state.readResult,
        });
        return { approved: approved(decision) };
      })
      .addNode("final", (state) => {
        validateStateVersion(state);
        return {
          finalAnswer: state.approved
            ? `Approved study review: ${state.readResult}`
            : "The proposed study action was declined.",
        };
      })
      .addEdge(START, "read_tool")
      .addEdge("read_tool", "approval")
      .addEdge("approval", "final")
      .addEdge("final", END)
      .compile({ checkpointer });
  }

  #config(
    row: RuntimeRow,
    checkpointId?: string,
  ): RunnableConfig & {
    durability: "sync";
  } {
    const configurable: Record<string, string> = {
      thread_id: row.graph_thread_id,
      checkpoint_ns: "",
      graph_schema_version: row.graph_schema_version,
    };
    if (checkpointId) configurable.checkpoint_id = checkpointId;
    return {
      configurable: {
        ...configurable,
      },
      durability: "sync",
    };
  }

  #getRun(runId: string): RuntimeRow | null {
    return this.database
      .query("SELECT * FROM agent_langgraph_runs WHERE run_id = ?")
      .get(runId) as RuntimeRow | null;
  }

  #ownedRun(ownerId: string, runId: string): RuntimeRow {
    const row = this.#getRun(runId);
    if (!row || row.owner_id !== ownerId) {
      throw new Error("Agent run does not exist for this owner");
    }
    assertSchemaVersion(row.graph_schema_version, this.graphSchemaVersion);
    return row;
  }

  #insertRun(input: {
    ownerId: string;
    runId: string;
    publicThreadId: string;
    branchId: string;
    question: string;
    parentRunId?: string;
  }): RuntimeRow {
    const now = new Date().toISOString();
    this.database
      .query(
        `INSERT INTO agent_langgraph_runs (
          run_id, owner_id, public_thread_id, branch_id, graph_thread_id,
          graph_schema_version, phase, question, interrupt_json,
          current_checkpoint_id, parent_run_id, cancel_reason, created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'running', ?, NULL, NULL, ?, NULL, ?, ?)`,
      )
      .run(
        input.runId,
        input.ownerId,
        input.publicThreadId,
        input.branchId,
        crypto.randomUUID(),
        this.graphSchemaVersion,
        input.question,
        input.parentRunId ?? null,
        now,
        now,
      );
    const row = this.#getRun(input.runId);
    if (!row) throw new Error("Failed to create the durable agent run");
    return row;
  }

  #setPhase(
    runId: string,
    phase: RuntimePhase,
    checkpointId: string | null,
    interruption: unknown | null,
  ): RuntimeRow {
    this.database
      .query(
        `UPDATE agent_langgraph_runs
         SET phase = ?, current_checkpoint_id = ?, interrupt_json = ?,
             updated_at = ?
         WHERE run_id = ? AND phase != 'cancelled'`,
      )
      .run(
        phase,
        checkpointId,
        interruption === null ? null : JSON.stringify(interruption),
        new Date().toISOString(),
        runId,
      );
    const row = this.#getRun(runId);
    if (!row) throw new Error("Agent run disappeared while updating state");
    return row;
  }

  #reference(
    ownerId: string,
    runId: string,
    checkpointId: string,
  ): ConversationCheckpointRef {
    const existing = this.database
      .query(
        `SELECT * FROM agent_langgraph_checkpoint_refs
         WHERE owner_id = ? AND run_id = ? AND checkpoint_id = ?`,
      )
      .get(ownerId, runId, checkpointId) as ReferenceRow | null;
    const referenceId = existing?.ref_id ?? crypto.randomUUID();
    if (!existing) {
      this.database
        .query(
          `INSERT INTO agent_langgraph_checkpoint_refs (
            ref_id, owner_id, run_id, checkpoint_id, graph_schema_version,
            created_at
          ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          referenceId,
          ownerId,
          runId,
          checkpointId,
          this.graphSchemaVersion,
          new Date().toISOString(),
        );
    }
    return conversationCheckpointRefSchema.parse(
      `${CONVERSATION_REFERENCE_PREFIX}${referenceId}`,
    );
  }

  #resolveReference(
    ownerId: string,
    reference: ConversationCheckpointRef,
    expectedRunId?: string,
  ): ReferenceRow {
    const token = parseReferenceToken(reference);
    const row = this.database
      .query("SELECT * FROM agent_langgraph_checkpoint_refs WHERE ref_id = ?")
      .get(token) as ReferenceRow | null;
    if (
      !row ||
      row.owner_id !== ownerId ||
      (expectedRunId !== undefined && row.run_id !== expectedRunId)
    ) {
      throw new Error("Conversation checkpoint does not exist for this owner");
    }
    assertSchemaVersion(row.graph_schema_version, this.graphSchemaVersion);
    return row;
  }

  async resolveCheckpointReference(
    ownerId: string,
    reference: ConversationCheckpointRef,
  ): Promise<ResolvedCheckpointReference> {
    const row = this.#resolveReference(ownerId, reference);
    return { runId: row.run_id, checkpointId: row.checkpoint_id };
  }

  /**
   * Creates an opaque, owner-bound reference for a historical checkpoint.
   * Conversation DAG persistence can use this when exposing branch points.
   */
  async createCheckpointReference(
    ownerId: string,
    runId: string,
    checkpointId: string,
  ): Promise<ConversationCheckpointRef> {
    const row = this.#ownedRun(ownerId, runId);
    const checkpoint = await this.checkpointer.getTuple(
      this.#config(row, checkpointId),
    );
    if (!checkpoint) {
      throw new Error("Historical conversation checkpoint does not exist");
    }
    return this.#reference(ownerId, runId, checkpointId);
  }

  async #runtimeState(
    row: RuntimeRow,
    snapshot?: StateSnapshot,
  ): Promise<AgentRuntimeState> {
    let checkpointReference: ConversationCheckpointRef | undefined;
    if (row.current_checkpoint_id) {
      checkpointReference = this.#reference(
        row.owner_id,
        row.run_id,
        row.current_checkpoint_id,
      );
    }
    if (snapshot) {
      assertSchemaVersion(
        graphStateFromSnapshot(snapshot).graphSchemaVersion,
        this.graphSchemaVersion,
      );
    }
    const state: Record<string, unknown> = {
      runId: row.run_id,
      phase: row.phase,
      graphSchemaVersion: row.graph_schema_version,
      interrupt: row.interrupt_json
        ? (JSON.parse(row.interrupt_json) as unknown)
        : null,
    };
    if (checkpointReference) {
      state.boundary = {
        conversationCheckpointRef: checkpointReference,
      };
    }
    return agentRuntimeStateSchema.parse(state);
  }

  async #execute(
    initialRow: RuntimeRow,
    graphInput:
      | AgentGraphStateValue
      | CommandInstance<
          ApprovalResume,
          typeof AgentGraphState.Update,
          AgentGraphNode
        >
      | null,
    checkpointId?: string,
  ): Promise<AgentRuntimeState> {
    const controller = new AbortController();
    this.#activeRuns.set(initialRow.run_id, controller);
    try {
      await this.#graph.invoke(graphInput, {
        ...this.#config(initialRow, checkpointId),
        signal: controller.signal,
      });
      const snapshot = await this.#graph.getState(this.#config(initialRow));
      const persistedCheckpointId = checkpointIdFromConfig(snapshot.config);
      const interruption = interruptFromSnapshot(snapshot);
      const phase: RuntimePhase =
        interruption !== null
          ? "interrupted"
          : snapshot.next.length === 0
            ? "finished"
            : "running";
      const row = this.#setPhase(
        initialRow.run_id,
        phase,
        persistedCheckpointId,
        interruption,
      );
      return this.#runtimeState(row, snapshot);
    } catch (error) {
      const current = this.#getRun(initialRow.run_id);
      if (!current) throw error;
      if (current.phase === "cancelled" || controller.signal.aborted) {
        return this.#runtimeState(current);
      }
      const failed = this.#setPhase(initialRow.run_id, "failed", null, null);
      await this.#runtimeState(failed);
      throw error;
    } finally {
      this.#activeRuns.delete(initialRow.run_id);
    }
  }

  #handle(state: AgentRuntimeState): AgentRunHandle {
    return {
      runId: state.runId,
      conversationCheckpointRef:
        state.boundary?.conversationCheckpointRef ?? null,
      completed: Promise.resolve(state),
    };
  }

  async start(inputValue: AgentRunInput): Promise<AgentRunHandle> {
    const parsed = agentRunInputSchema.parse(inputValue);
    assertSchemaVersion(parsed.graphSchemaVersion, this.graphSchemaVersion);
    const existing = this.#getRun(parsed.runId);
    if (existing) {
      if (
        existing.owner_id !== parsed.ownerId ||
        existing.public_thread_id !== parsed.threadId ||
        existing.branch_id !== parsed.branchId
      ) {
        throw new Error("Run ID is already bound to another conversation");
      }
      return this.#handle(await this.inspect(parsed));
    }

    const question = firstUserQuestion(inputValue);
    const row = this.#insertRun({
      ownerId: parsed.ownerId,
      runId: parsed.runId,
      publicThreadId: parsed.threadId,
      branchId: parsed.branchId,
      question,
    });
    const state = await this.#execute(row, {
      graphSchemaVersion: this.graphSchemaVersion,
      ownerId: parsed.ownerId,
      runId: parsed.runId,
      threadId: parsed.threadId,
      branchId: parsed.branchId,
      question,
      readResult: "",
      approved: false,
      finalAnswer: "",
    });
    return this.#handle(state);
  }

  async resume(inputValue: AgentResumeInput): Promise<AgentRunHandle> {
    const input = agentResumeInputSchema.parse(inputValue);
    const reference = this.#resolveReference(
      input.ownerId,
      input.conversationCheckpointRef,
      input.runId,
    );
    const row = this.#ownedRun(input.ownerId, input.runId);
    if (
      row.phase !== "interrupted" ||
      row.current_checkpoint_id !== reference.checkpoint_id
    ) {
      throw new Error("Only the current interrupted checkpoint can be resumed");
    }
    const transition = this.database
      .query(
        `UPDATE agent_langgraph_runs
         SET phase = 'running', interrupt_json = NULL, updated_at = ?
         WHERE run_id = ? AND owner_id = ? AND phase = 'interrupted'
           AND current_checkpoint_id = ?`,
      )
      .run(
        new Date().toISOString(),
        input.runId,
        input.ownerId,
        reference.checkpoint_id,
      );
    if (transition.changes !== 1) {
      throw new Error("Agent run was resumed concurrently");
    }
    const running = this.#ownedRun(input.ownerId, input.runId);
    const resumeValue = parseApprovalResume(input.resumeValue);
    const state = await this.#execute(
      running,
      new Command<
        ApprovalResume,
        typeof AgentGraphState.Update,
        AgentGraphNode
      >({ resume: resumeValue }),
      reference.checkpoint_id,
    );
    return this.#handle(state);
  }

  async cancel(inputValue: AgentCancelInput): Promise<void> {
    const input = agentCancelInputSchema.parse(inputValue);
    const row = this.#ownedRun(input.ownerId, input.runId);
    if (["finished", "failed", "cancelled"].includes(row.phase)) return;
    this.database
      .query(
        `UPDATE agent_langgraph_runs
         SET phase = 'cancelled', cancel_reason = ?, interrupt_json = NULL,
             updated_at = ?
         WHERE run_id = ? AND owner_id = ?`,
      )
      .run(input.reason, new Date().toISOString(), input.runId, input.ownerId);
    this.#activeRuns.get(input.runId)?.abort();
  }

  async fork(inputValue: AgentForkInput): Promise<ConversationCheckpointRef> {
    const input = agentForkInputSchema.parse(inputValue);
    const sourceReferenceValue = input.boundary.conversationCheckpointRef;
    if (!sourceReferenceValue) {
      throw new Error("Forking the harness requires a conversation checkpoint");
    }
    const sourceReference = this.#resolveReference(
      input.ownerId,
      sourceReferenceValue,
    );
    const source = this.#ownedRun(input.ownerId, sourceReference.run_id);
    if (
      source.public_thread_id !== input.sourceThreadId ||
      source.branch_id !== input.sourceBranchId
    ) {
      throw new Error("Fork source does not match the checkpoint branch");
    }
    if (input.targetBranchId === input.sourceBranchId) {
      throw new Error("A fork must create a distinct branch");
    }

    const sourceSnapshot = await this.#graph.getState(
      this.#config(source, sourceReference.checkpoint_id),
    );
    assertSchemaVersion(
      graphStateFromSnapshot(sourceSnapshot).graphSchemaVersion,
      this.graphSchemaVersion,
    );

    const targetRunId = `fork-${crypto.randomUUID()}`;
    const target = this.#insertRun({
      ownerId: input.ownerId,
      runId: targetRunId,
      publicThreadId: input.sourceThreadId,
      branchId: input.targetBranchId,
      question: input.editedInput,
      parentRunId: source.run_id,
    });
    const clonedConfig = await this.checkpointer.forkCheckpoint(
      this.#config(source, sourceReference.checkpoint_id),
      target.graph_thread_id,
    );
    const updatedConfig = await this.#graph.updateState(
      clonedConfig,
      {
        graphSchemaVersion: this.graphSchemaVersion,
        ownerId: input.ownerId,
        runId: targetRunId,
        threadId: input.sourceThreadId,
        branchId: input.targetBranchId,
        question: input.editedInput,
        readResult: readToolResult(input.editedInput),
        approved: false,
        finalAnswer: "",
      },
      "read_tool",
    );
    const updatedCheckpointId = checkpointIdFromConfig(updatedConfig);
    this.#setPhase(targetRunId, "running", updatedCheckpointId, null);
    const state = await this.#execute(target, null, updatedCheckpointId);
    const reference = state.boundary?.conversationCheckpointRef;
    if (!reference)
      throw new Error("Fork did not produce a durable checkpoint");
    return reference;
  }

  async inspect(inputValue: AgentInspectInput): Promise<AgentRuntimeState> {
    const input = agentInspectInputSchema.parse(inputValue);
    const row = this.#ownedRun(input.ownerId, input.runId);
    if (!row.current_checkpoint_id) return this.#runtimeState(row);
    const snapshot = await this.#graph.getState(
      this.#config(row, row.current_checkpoint_id),
    );
    return this.#runtimeState(row, snapshot);
  }

  close(): void {
    for (const controller of this.#activeRuns.values()) controller.abort();
    this.#activeRuns.clear();
  }
}
