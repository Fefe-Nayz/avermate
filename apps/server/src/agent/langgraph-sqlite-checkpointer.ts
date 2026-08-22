import { Database } from "bun:sqlite";
import {
  BaseCheckpointSaver,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from "@langchain/langgraph";
import type { RunnableConfig } from "@langchain/core/runnables";

type CheckpointRow = {
  thread_id: string;
  checkpoint_ns: string;
  checkpoint_id: string;
  parent_checkpoint_id: string | null;
  checkpoint_type: string;
  checkpoint_blob: Uint8Array;
  metadata_type: string;
  metadata_blob: Uint8Array;
  graph_schema_version: string;
};

type WriteRow = {
  task_id: string;
  channel: string;
  value_type: string;
  value_blob: Uint8Array;
};

type PendingWrite = [channel: string, value: unknown];
type CheckpointListOptions = {
  limit?: number;
  before?: RunnableConfig;
  filter?: Record<string, unknown>;
};

const IDENTIFIER_MAX_LENGTH = 512;

function specialWriteIndex(channel: string): number | undefined {
  switch (channel) {
    case "__error__":
      return -1;
    case "__scheduled__":
      return -2;
    case "__interrupt__":
      return -3;
    case "__resume__":
      return -4;
    default:
      return undefined;
  }
}

function requiredIdentifier(name: string, value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > IDENTIFIER_MAX_LENGTH ||
    value.includes("\0")
  ) {
    throw new Error(`Invalid LangGraph ${name}`);
  }
  return value;
}

function checkpointNamespace(config: RunnableConfig): string {
  const value = config.configurable?.checkpoint_ns ?? "";
  if (
    typeof value !== "string" ||
    value.length > IDENTIFIER_MAX_LENGTH ||
    value.includes("\0")
  ) {
    throw new Error("Invalid LangGraph checkpoint namespace");
  }
  return value;
}

function checkpointId(config: RunnableConfig): string | undefined {
  const value =
    config.configurable?.checkpoint_id ?? config.configurable?.thread_ts;
  if (value === undefined) return undefined;
  return requiredIdentifier("checkpoint ID", value);
}

function bytes(value: Uint8Array): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

function metadataMatches(
  metadata: CheckpointMetadata,
  filter: Record<string, unknown> | undefined,
): boolean {
  if (!filter) return true;
  // SAFETY: CheckpointMetadata permits saver-specific metadata properties at
  // runtime; this read-only view implements LangGraph's shallow filter API.
  const searchable = metadata as CheckpointMetadata & Record<string, unknown>;
  return Object.entries(filter).every(
    ([key, expected]) => searchable[key] === expected,
  );
}

export class IncompatibleGraphSchemaError extends Error {
  constructor(expected: string, observed: string) {
    super(
      `Incompatible LangGraph checkpoint schema: expected ${expected}, observed ${observed}`,
    );
    this.name = "IncompatibleGraphSchemaError";
  }
}

export type SqliteLangGraphCheckpointerOptions = {
  graphSchemaVersion: string;
};

/**
 * A small Bun-SQLite LangGraph saver owned by Avermate.
 *
 * The graph schema is stored on every checkpoint and pending write. Reads fail
 * closed when a newer runtime opens an incompatible in-flight graph.
 */
export class SqliteLangGraphCheckpointer extends BaseCheckpointSaver {
  readonly database: Database;
  readonly graphSchemaVersion: string;
  readonly #ownsDatabase: boolean;

  constructor(
    database: Database | string,
    options: SqliteLangGraphCheckpointerOptions,
  ) {
    super();
    this.graphSchemaVersion = requiredIdentifier(
      "schema version",
      options.graphSchemaVersion,
    );
    this.#ownsDatabase = typeof database === "string";
    this.database =
      typeof database === "string"
        ? new Database(database, { create: true })
        : database;
    this.database.exec("PRAGMA foreign_keys = ON");
    this.database.exec("PRAGMA busy_timeout = 5000");
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS agent_langgraph_checkpoints (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        parent_checkpoint_id TEXT,
        checkpoint_type TEXT NOT NULL,
        checkpoint_blob BLOB NOT NULL,
        metadata_type TEXT NOT NULL,
        metadata_blob BLOB NOT NULL,
        graph_schema_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
      );
      CREATE INDEX IF NOT EXISTS agent_langgraph_checkpoints_latest_idx
        ON agent_langgraph_checkpoints(thread_id, checkpoint_ns, checkpoint_id DESC);

      CREATE TABLE IF NOT EXISTS agent_langgraph_writes (
        thread_id TEXT NOT NULL,
        checkpoint_ns TEXT NOT NULL DEFAULT '',
        checkpoint_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        write_index INTEGER NOT NULL,
        channel TEXT NOT NULL,
        value_type TEXT NOT NULL,
        value_blob BLOB NOT NULL,
        graph_schema_version TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (
          thread_id,
          checkpoint_ns,
          checkpoint_id,
          task_id,
          write_index
        ),
        FOREIGN KEY (thread_id, checkpoint_ns, checkpoint_id)
          REFERENCES agent_langgraph_checkpoints(
            thread_id,
            checkpoint_ns,
            checkpoint_id
          ) ON DELETE CASCADE
      );
    `);
  }

  #assertConfigSchema(config: RunnableConfig): void {
    const configured = config.configurable?.graph_schema_version;
    if (configured !== undefined && configured !== this.graphSchemaVersion) {
      throw new IncompatibleGraphSchemaError(
        this.graphSchemaVersion,
        String(configured),
      );
    }
  }

  #assertStoredSchema(observed: string): void {
    if (observed !== this.graphSchemaVersion) {
      throw new IncompatibleGraphSchemaError(this.graphSchemaVersion, observed);
    }
  }

  async #pendingWrites(
    threadId: string,
    namespace: string,
    id: string,
  ): Promise<Array<[string, string, unknown]>> {
    const rows = this.database
      .query(
        `SELECT task_id, channel, value_type, value_blob,
                graph_schema_version
         FROM agent_langgraph_writes
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
         ORDER BY task_id ASC, write_index ASC`,
      )
      .all(threadId, namespace, id) as Array<
      WriteRow & { graph_schema_version: string }
    >;

    return Promise.all(
      rows.map(async (row) => {
        this.#assertStoredSchema(row.graph_schema_version);
        return [
          row.task_id,
          row.channel,
          await this.serde.loadsTyped(row.value_type, bytes(row.value_blob)),
        ];
      }),
    );
  }

  async #tuple(row: CheckpointRow): Promise<CheckpointTuple> {
    this.#assertStoredSchema(row.graph_schema_version);
    const config: RunnableConfig = {
      configurable: {
        thread_id: row.thread_id,
        checkpoint_ns: row.checkpoint_ns,
        checkpoint_id: row.checkpoint_id,
        graph_schema_version: row.graph_schema_version,
      },
    };
    const tuple: CheckpointTuple = {
      config,
      checkpoint: (await this.serde.loadsTyped(
        row.checkpoint_type,
        bytes(row.checkpoint_blob),
      )) as Checkpoint,
      metadata: (await this.serde.loadsTyped(
        row.metadata_type,
        bytes(row.metadata_blob),
      )) as CheckpointMetadata,
      pendingWrites: await this.#pendingWrites(
        row.thread_id,
        row.checkpoint_ns,
        row.checkpoint_id,
      ),
    };
    if (row.parent_checkpoint_id) {
      tuple.parentConfig = {
        configurable: {
          thread_id: row.thread_id,
          checkpoint_ns: row.checkpoint_ns,
          checkpoint_id: row.parent_checkpoint_id,
          graph_schema_version: row.graph_schema_version,
        },
      };
    }
    return tuple;
  }

  async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    this.#assertConfigSchema(config);
    const threadId = requiredIdentifier(
      "thread ID",
      config.configurable?.thread_id,
    );
    const namespace = checkpointNamespace(config);
    const id = checkpointId(config);
    const row = (
      id
        ? this.database
            .query(
              `SELECT * FROM agent_langgraph_checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
            )
            .get(threadId, namespace, id)
        : this.database
            .query(
              `SELECT * FROM agent_langgraph_checkpoints
             WHERE thread_id = ? AND checkpoint_ns = ?
             ORDER BY checkpoint_id DESC LIMIT 1`,
            )
            .get(threadId, namespace)
    ) as CheckpointRow | null;
    return row ? this.#tuple(row) : undefined;
  }

  async *list(
    config: RunnableConfig,
    options: CheckpointListOptions = {},
  ): AsyncGenerator<CheckpointTuple> {
    this.#assertConfigSchema(config);
    const threadIdValue = config.configurable?.thread_id;
    const namespaceValue = config.configurable?.checkpoint_ns;
    const exactId = checkpointId(config);
    const beforeId = options.before ? checkpointId(options.before) : undefined;
    const clauses: string[] = [];
    const parameters: Array<string> = [];

    if (threadIdValue !== undefined) {
      clauses.push("thread_id = ?");
      parameters.push(requiredIdentifier("thread ID", threadIdValue));
    }
    if (namespaceValue !== undefined) {
      clauses.push("checkpoint_ns = ?");
      parameters.push(checkpointNamespace(config));
    }
    if (exactId) {
      clauses.push("checkpoint_id = ?");
      parameters.push(exactId);
    }
    if (beforeId) {
      clauses.push("checkpoint_id < ?");
      parameters.push(beforeId);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .query(
        `SELECT * FROM agent_langgraph_checkpoints
         ${where}
         ORDER BY checkpoint_id DESC`,
      )
      .all(...parameters) as CheckpointRow[];
    let remaining = options.limit ?? Number.POSITIVE_INFINITY;
    if (
      !Number.isSafeInteger(remaining) &&
      remaining !== Number.POSITIVE_INFINITY
    ) {
      throw new Error("Invalid LangGraph checkpoint list limit");
    }
    if (remaining <= 0) return;

    for (const row of rows) {
      const tuple = await this.#tuple(row);
      if (
        !metadataMatches(tuple.metadata as CheckpointMetadata, options.filter)
      ) {
        continue;
      }
      yield tuple;
      remaining -= 1;
      if (remaining <= 0) return;
    }
  }

  async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions?: Record<string, string | number>,
  ): Promise<RunnableConfig> {
    this.#assertConfigSchema(config);
    const threadId = requiredIdentifier(
      "thread ID",
      config.configurable?.thread_id,
    );
    const namespace = checkpointNamespace(config);
    const id = requiredIdentifier("checkpoint ID", checkpoint.id);
    const parentId = checkpointId(config) ?? null;
    const [serializedCheckpoint, serializedMetadata] = await Promise.all([
      this.serde.dumpsTyped(checkpoint),
      this.serde.dumpsTyped(metadata),
    ]);
    const now = new Date().toISOString();

    this.database
      .query(
        `INSERT INTO agent_langgraph_checkpoints (
          thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
          checkpoint_type, checkpoint_blob, metadata_type, metadata_blob,
          graph_schema_version, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
          parent_checkpoint_id = excluded.parent_checkpoint_id,
          checkpoint_type = excluded.checkpoint_type,
          checkpoint_blob = excluded.checkpoint_blob,
          metadata_type = excluded.metadata_type,
          metadata_blob = excluded.metadata_blob,
          graph_schema_version = excluded.graph_schema_version`,
      )
      .run(
        threadId,
        namespace,
        id,
        parentId,
        serializedCheckpoint[0],
        serializedCheckpoint[1],
        serializedMetadata[0],
        serializedMetadata[1],
        this.graphSchemaVersion,
        now,
      );

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: namespace,
        checkpoint_id: id,
        graph_schema_version: this.graphSchemaVersion,
      },
    };
  }

  async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskIdValue: string,
  ): Promise<void> {
    this.#assertConfigSchema(config);
    const threadId = requiredIdentifier(
      "thread ID",
      config.configurable?.thread_id,
    );
    const namespace = checkpointNamespace(config);
    const id = requiredIdentifier("checkpoint ID", checkpointId(config));
    const taskId = requiredIdentifier("task ID", taskIdValue);
    const serialized = await Promise.all(
      writes.map(async ([channelValue, value], index) => {
        const channel = requiredIdentifier("write channel", channelValue);
        const writeIndex = specialWriteIndex(channel) ?? index;
        const [valueType, valueBlob] = await this.serde.dumpsTyped(value);
        return { channel, writeIndex, valueType, valueBlob };
      }),
    );
    const write = this.database.transaction(() => {
      const now = new Date().toISOString();
      for (const item of serialized) {
        const conflictAction =
          item.writeIndex < 0
            ? `DO UPDATE SET
                 channel = excluded.channel,
                 value_type = excluded.value_type,
                 value_blob = excluded.value_blob,
                 graph_schema_version = excluded.graph_schema_version`
            : "DO NOTHING";
        this.database
          .query(
            `INSERT INTO agent_langgraph_writes (
              thread_id, checkpoint_ns, checkpoint_id, task_id, write_index,
              channel, value_type, value_blob, graph_schema_version, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(
              thread_id, checkpoint_ns, checkpoint_id, task_id, write_index
            ) ${conflictAction}`,
          )
          .run(
            threadId,
            namespace,
            id,
            taskId,
            item.writeIndex,
            item.channel,
            item.valueType,
            item.valueBlob,
            this.graphSchemaVersion,
            now,
          );
      }
    });
    write.immediate();
  }

  /** Clone one exact checkpoint into a distinct LangGraph thread. */
  async forkCheckpoint(
    sourceConfig: RunnableConfig,
    targetThreadIdValue: string,
  ): Promise<RunnableConfig> {
    const source = await this.getTuple(sourceConfig);
    if (!source)
      throw new Error("Source conversation checkpoint does not exist");
    const targetThreadId = requiredIdentifier(
      "target thread ID",
      targetThreadIdValue,
    );
    const namespace = checkpointNamespace(source.config);
    const id = requiredIdentifier(
      "checkpoint ID",
      source.config.configurable?.checkpoint_id,
    );
    const metadata: CheckpointMetadata = {
      ...(source.metadata as CheckpointMetadata),
      source: "fork",
    };
    const [serializedCheckpoint, serializedMetadata] = await Promise.all([
      this.serde.dumpsTyped(source.checkpoint),
      this.serde.dumpsTyped(metadata),
    ]);

    this.database
      .query(
        `INSERT INTO agent_langgraph_checkpoints (
          thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
          checkpoint_type, checkpoint_blob, metadata_type, metadata_blob,
          graph_schema_version, created_at
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        targetThreadId,
        namespace,
        id,
        serializedCheckpoint[0],
        serializedCheckpoint[1],
        serializedMetadata[0],
        serializedMetadata[1],
        this.graphSchemaVersion,
        new Date().toISOString(),
      );

    return {
      configurable: {
        thread_id: targetThreadId,
        checkpoint_ns: namespace,
        checkpoint_id: id,
        graph_schema_version: this.graphSchemaVersion,
      },
    };
  }

  async deleteThread(threadIdValue: string): Promise<void> {
    const threadId = requiredIdentifier("thread ID", threadIdValue);
    this.database
      .query("DELETE FROM agent_langgraph_checkpoints WHERE thread_id = ?")
      .run(threadId);
  }

  close(): void {
    if (this.#ownsDatabase) this.database.close();
  }
}
