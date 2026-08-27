import type {
  AssistantThreadDetail,
  AssistantThreadListItem,
  NodeConversationDagListInput,
  NodeConversationDagSnapshot,
  StoredConversationEvent,
} from "@avermate/agent-contracts";
import type { InValue } from "@libsql/client";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { assistantPartV1Schema } from "@avermate/agent-contracts";
import { newId } from "../lib/id";
import {
  ConversationStoreError,
  CoreConversationStore,
  type AssistantSqlClient,
  type NodeConversationPayloadCodec,
} from "./core-conversation-store";

type Row = Record<string, InValue>;

type ConversationMigrationSnapshot = {
  detail: AssistantThreadDetail;
  events: StoredConversationEvent[];
};

function migrationDigest(snapshots: readonly ConversationMigrationSnapshot[]) {
  const canonical = [...snapshots]
    .sort((left, right) =>
      left.detail.thread.id.localeCompare(right.detail.thread.id),
    )
    .map((snapshot) => ({
      detail: {
        ...snapshot.detail,
        // Placement is the field being migrated, not conversation content.
        thread: {
          ...snapshot.detail.thread,
          placement: { kind: "core" as const },
        },
      },
      events: snapshot.events,
    }));
  const serialized = JSON.stringify(canonical);
  return {
    digest: `sha256:${createHash("sha256").update(serialized).digest("hex")}`,
    bytes: new TextEncoder().encode(serialized).byteLength,
  };
}

function samePlacement(
  left: { kind: string; nodeId?: string; providerId?: string },
  right: { kind: string; nodeId?: string; providerId?: string },
) {
  return (
    left.kind === right.kind &&
    (left.kind !== "node" || left.nodeId === right.nodeId)
  );
}

export interface ConversationDagRelay {
  selectedNode(ownerId: string): Promise<string | null>;
  assertOnline(ownerId: string, nodeId: string): Promise<void>;
  import(input: {
    nodeId: string;
    ownerId: string;
    operation: "create" | "append" | "branch";
    snapshot: NodeConversationDagSnapshot;
  }): Promise<unknown>;
  list(input: {
    nodeId: string;
    ownerId: string;
    query: NodeConversationDagListInput;
  }): Promise<AssistantThreadListItem[]>;
  get(input: { nodeId: string; ownerId: string; threadId: string }): Promise<{
    detail: AssistantThreadDetail;
    events: StoredConversationEvent[];
  } | null>;
  delete(input: {
    nodeId: string;
    ownerId: string;
    threadId: string;
  }): Promise<unknown>;
}

function unavailable(error?: unknown): never {
  const suffix =
    error instanceof Error && error.message
      ? ` (${error.message.slice(0, 128)})`
      : "";
  throw new ConversationStoreError(
    "placement_unavailable",
    `This conversation is stored on an unavailable Avermate Node${suffix}`,
  );
}

type SealedEvent = {
  __avermateNodeSealed: {
    algorithm: "aes-256-gcm-v1";
    ciphertext: string;
  };
};

export class NodeConversationEnvelopeCodec implements NodeConversationPayloadCodec {
  readonly #key: Buffer;

  constructor(secret: string) {
    if (new TextEncoder().encode(secret).byteLength < 32) {
      throw new Error("NODE_CONVERSATION_ENVELOPE_SECRET_TOO_SHORT");
    }
    this.#key = createHash("sha256")
      .update("avermate-node-conversation-envelope-v1\0")
      .update(secret)
      .digest();
  }

  #seal(value: unknown, aad: string) {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#key, nonce);
    cipher.setAAD(Buffer.from(aad));
    const ciphertext = Buffer.concat([
      cipher.update(JSON.stringify(value), "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      nonce.toString("base64url"),
      ciphertext.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
    ].join(".");
  }

  #open(value: string, aad: string) {
    const [version, nonce, ciphertext, tag, extra] = value.split(".");
    if (version !== "v1" || !nonce || !ciphertext || !tag || extra) {
      throw new Error("NODE_CONVERSATION_ENVELOPE_INVALID");
    }
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.#key,
        Buffer.from(nonce, "base64url"),
      );
      decipher.setAAD(Buffer.from(aad));
      decipher.setAuthTag(Buffer.from(tag, "base64url"));
      return JSON.parse(
        Buffer.concat([
          decipher.update(Buffer.from(ciphertext, "base64url")),
          decipher.final(),
        ]).toString("utf8"),
      ) as unknown;
    } catch {
      throw new Error("NODE_CONVERSATION_ENVELOPE_AUTH_FAILED");
    }
  }

  #partsAad(input: {
    ownerId: string;
    nodeId: string;
    threadId: string;
    messageId: string;
    role: string;
    parentMessageId: string | null;
  }) {
    return `parts\0${input.ownerId}\0${input.nodeId}\0${input.threadId}\0${input.messageId}\0${input.role}\0${input.parentMessageId ?? ""}`;
  }

  #eventAad(input: {
    ownerId: string;
    nodeId: string;
    threadId: string;
    runId: string;
    eventId: string;
  }) {
    return `event\0${input.ownerId}\0${input.nodeId}\0${input.threadId}\0${input.runId}\0${input.eventId}`;
  }

  sealParts(input: Parameters<NodeConversationPayloadCodec["sealParts"]>[0]) {
    return [
      assistantPartV1Schema.parse({
        type: "node-sealed",
        id: newId("aseal"),
        algorithm: "aes-256-gcm-v1",
        ciphertext: this.#seal(input.parts, this.#partsAad(input)),
      }),
    ];
  }

  openParts(input: Parameters<NodeConversationPayloadCodec["openParts"]>[0]) {
    const sealed = input.parts[0];
    if (input.parts.length !== 1 || !sealed || sealed.type !== "node-sealed") {
      throw new Error("NODE_CONVERSATION_ENVELOPE_REQUIRED");
    }
    return assistantPartV1Schema
      .array()
      .parse(this.#open(sealed.ciphertext, this.#partsAad(input)));
  }

  sealEvent(input: Parameters<NodeConversationPayloadCodec["sealEvent"]>[0]) {
    return {
      __avermateNodeSealed: {
        algorithm: "aes-256-gcm-v1",
        ciphertext: this.#seal(input.payload, this.#eventAad(input)),
      },
    } satisfies SealedEvent;
  }

  openEvent(input: Parameters<NodeConversationPayloadCodec["openEvent"]>[0]) {
    const envelope = input.payload as Partial<SealedEvent> | null;
    const sealed = envelope?.__avermateNodeSealed;
    if (
      !sealed ||
      sealed.algorithm !== "aes-256-gcm-v1" ||
      typeof sealed.ciphertext !== "string"
    ) {
      throw new Error("NODE_CONVERSATION_ENVELOPE_REQUIRED");
    }
    return this.#open(sealed.ciphertext, this.#eventAad(input));
  }
}

function partsPath(detail: AssistantThreadDetail, branchId?: string | null) {
  const selectedBranchId = branchId ?? detail.thread.activeBranchId;
  const branch = detail.branches.find((item) => item.id === selectedBranchId);
  if (selectedBranchId && !branch) {
    throw new ConversationStoreError("not_found", "Branch not found");
  }
  const messages = new Map(
    detail.messages.map((message) => [message.id, message]),
  );
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
    cursor = messages.get(cursor)?.parentMessageId ?? null;
  }
  return {
    ...detail,
    activeBranchId: selectedBranchId,
    activePathMessageIds: reversed.reverse(),
  };
}

/**
 * Core owns authorization/routing/CAS metadata; Node owns message parts and
 * event payloads. Every Node mutation checks the live signed relay first,
 * writes the canonical DAG snapshot, then scrubs plaintext payload columns in
 * Core. Reads never fall back to the scrubbed metadata copy.
 */
export class RoutedConversationStore extends CoreConversationStore {
  readonly #codec: NodeConversationEnvelopeCodec;

  constructor(
    private readonly metadataClient: AssistantSqlClient,
    private readonly relay: ConversationDagRelay,
    envelopeSecret: string,
    scheduleConversationIndex?: ConstructorParameters<
      typeof CoreConversationStore
    >[1],
  ) {
    const codec = new NodeConversationEnvelopeCodec(envelopeSecret);
    super(metadataClient, scheduleConversationIndex, codec);
    this.#codec = codec;
  }

  async #threadPlacement(
    ownerId: string,
    threadId: string,
    includeDeleted = false,
  ) {
    const result = await this.metadataClient.execute({
      sql: `SELECT placement, placementRef FROM assistant_threads
        WHERE id = ? AND userId = ? ${includeDeleted ? "" : "AND deletedAt IS NULL"}
        LIMIT 1`,
      args: [threadId, ownerId],
    });
    const row = result.rows[0];
    if (!row) throw new ConversationStoreError("not_found", "Thread not found");
    return row.placement === "node" ? String(row.placementRef) : null;
  }

  async #runThread(ownerId: string, runId: string) {
    const result = await this.metadataClient.execute({
      sql: `SELECT r.threadId FROM assistant_runs r
        JOIN assistant_threads t ON t.id = r.threadId
        WHERE r.id = ? AND r.userId = ? AND t.userId = ? LIMIT 1`,
      args: [runId, ownerId, ownerId],
    });
    const row = result.rows[0];
    if (!row) throw new ConversationStoreError("not_found", "Run not found");
    return String(row.threadId);
  }

  async #messageThread(ownerId: string, messageId: string) {
    const result = await this.metadataClient.execute({
      sql: `SELECT m.threadId FROM assistant_messages m
        JOIN assistant_threads t ON t.id = m.threadId
        WHERE m.id = ? AND t.userId = ? LIMIT 1`,
      args: [messageId, ownerId],
    });
    const row = result.rows[0];
    if (!row)
      throw new ConversationStoreError("not_found", "Message not found");
    return String(row.threadId);
  }

  async #preflight(ownerId: string, threadId: string) {
    const nodeId = await this.#threadPlacement(ownerId, threadId, true);
    if (!nodeId) return null;
    try {
      await this.relay.assertOnline(ownerId, nodeId);
    } catch (error) {
      unavailable(error);
    }
    return nodeId;
  }

  async #eventsFrom(
    client: Pick<AssistantSqlClient, "execute">,
    threadId: string,
  ) {
    const result = await client.execute({
      sql: `SELECT e.*, r.threadId, r.branchId FROM assistant_run_events e
        JOIN assistant_runs r ON r.id = e.runId
        WHERE r.threadId = ? ORDER BY e.runId, e.sequence`,
      args: [threadId],
    });
    return result.rows.map((row) => ({
      protocolVersion: 1 as const,
      eventId: String(row.eventId),
      sequence: Number(row.sequence),
      threadId: String(row.threadId),
      branchId: String(row.branchId),
      runId: String(row.runId),
      emittedAt: new Date(Number(row.emittedAt) * 1_000).toISOString(),
      persistedAt: new Date(Number(row.persistedAt) * 1_000).toISOString(),
      type: String(row.type),
      payload:
        typeof row.payloadJson === "string"
          ? JSON.parse(row.payloadJson)
          : row.payloadJson,
      terminal: Boolean(row.terminal),
    })) as StoredConversationEvent[];
  }

  async #events(threadId: string) {
    return this.#eventsFrom(this.metadataClient, threadId);
  }

  async #coreSnapshot(
    client: Pick<AssistantSqlClient, "execute">,
    ownerId: string,
    threadId: string,
  ): Promise<ConversationMigrationSnapshot> {
    // getThreadDetail only needs execute calls on this path. Using the active
    // transaction lets Node -> Core verify the exact staged destination before
    // the placement switch is committed.
    const reader = new CoreConversationStore(client as AssistantSqlClient);
    return {
      detail: await reader.getThreadDetail(ownerId, threadId),
      events: await this.#eventsFrom(client, threadId),
    };
  }

  async #sync(
    ownerId: string,
    threadId: string,
    operation: "create" | "append" | "branch" = "append",
  ) {
    const nodeId = await this.#threadPlacement(ownerId, threadId, true);
    if (!nodeId) return;
    const sealedDetail = await super.getThreadDetail(ownerId, threadId);
    const detail = {
      ...sealedDetail,
      messages: sealedDetail.messages.map((message) => ({
        ...message,
        parts: this.#codec.openParts({
          ownerId,
          nodeId,
          threadId,
          messageId: message.id,
          role: message.role,
          parentMessageId: message.parentMessageId,
          parts: message.parts,
        }),
      })),
    };
    const events = (await this.#events(threadId)).map((event) => ({
      ...event,
      payload: this.#codec.openEvent({
        ownerId,
        nodeId,
        threadId,
        runId: event.runId,
        eventId: event.eventId,
        payload: event.payload,
      }),
    }));
    const syncKey = [
      operation,
      threadId,
      detail.thread.revision,
      detail.messages.length,
      detail.runs.length,
      events.length,
      events.at(-1)?.eventId ?? "empty",
      detail.thread.updatedAt,
    ].join(":");
    try {
      await this.relay.import({
        nodeId,
        ownerId,
        operation,
        snapshot: { ownerId, detail, events, syncKey },
      });
    } catch (error) {
      unavailable(error);
    }
  }

  override async createThread(
    input: Parameters<CoreConversationStore["createThread"]>[0],
  ) {
    const nodeId =
      input.placement === "node" || input.placement === undefined
        ? await this.relay.selectedNode(input.ownerId)
        : null;
    const useNode = input.placement === "node" || (!input.placement && nodeId);
    if (useNode && !nodeId) unavailable();
    if (nodeId) {
      try {
        await this.relay.assertOnline(input.ownerId, nodeId);
      } catch (error) {
        unavailable(error);
      }
    }
    const created = await super.createThread({
      ...input,
      placement: useNode ? "node" : "core",
      ...(useNode ? { nodeId: nodeId! } : {}),
    });
    try {
      await this.#sync(input.ownerId, created.thread.id, "create");
    } catch (error) {
      await this.metadataClient.execute({
        sql: `DELETE FROM assistant_threads WHERE id = ? AND userId = ?`,
        args: [created.thread.id, input.ownerId],
      });
      throw error;
    }
    return created;
  }

  override async getThreadDetail(
    ownerId: string,
    threadId: string,
    branchId?: string | null,
  ) {
    const nodeId = await this.#threadPlacement(ownerId, threadId, true);
    if (!nodeId) return super.getThreadDetail(ownerId, threadId, branchId);
    try {
      await this.relay.assertOnline(ownerId, nodeId);
      const stored = await this.relay.get({ nodeId, ownerId, threadId });
      if (!stored) throw new Error("NODE_CONVERSATION_DAG_NOT_FOUND");
      return partsPath(stored.detail, branchId);
    } catch (error) {
      unavailable(error);
    }
  }

  override async listThreads(
    input: Parameters<CoreConversationStore["listThreads"]>[0],
  ) {
    const core = await super.listThreads(input);
    const refClauses = [
      "userId = ?",
      "placement = 'node'",
      "placementRef IS NOT NULL",
    ];
    const refArgs: string[] = [input.ownerId];
    if (input.projectId) {
      refClauses.push("projectId = ?");
      refArgs.push(input.projectId);
    }
    const refs = await this.metadataClient.execute({
      sql: `SELECT DISTINCT placementRef FROM assistant_threads
        WHERE ${refClauses.join(" AND ")}`,
      args: refArgs,
    });
    if (refs.rows.length === 0) return core;
    const remote: AssistantThreadListItem[] = [];
    for (const row of refs.rows) {
      const nodeId = String(row.placementRef);
      try {
        await this.relay.assertOnline(input.ownerId, nodeId);
        remote.push(
          ...(await this.relay.list({
            nodeId,
            ownerId: input.ownerId,
            query: {
              ...(input.query ? { query: input.query } : {}),
              ...(input.projectId ? { projectId: input.projectId } : {}),
              includeArchived: input.includeArchived ?? false,
              includeDeleted: input.includeDeleted ?? false,
              starredOnly: input.starredOnly ?? false,
              limit: input.limit ?? 30,
            },
          })),
        );
      } catch (error) {
        unavailable(error);
      }
    }
    const byId = new Map(
      [
        ...core.items.filter((item) => item.thread.placement.kind === "core"),
        ...remote,
      ].map((item) => [item.thread.id, item]),
    );
    const cursor = input.cursor
      ? Number(input.cursor)
      : Number.MAX_SAFE_INTEGER;
    const limit = Math.min(Math.max(input.limit ?? 30, 1), 100);
    const items = [...byId.values()]
      .filter(
        (item) =>
          (!input.projectId || item.thread.projectId === input.projectId) &&
          new Date(item.thread.updatedAt).getTime() / 1_000 < cursor,
      )
      .sort((left, right) =>
        right.thread.updatedAt.localeCompare(left.thread.updatedAt),
      )
      .slice(0, limit);
    return {
      items,
      nextCursor:
        items.length === limit
          ? String(
              Math.floor(
                new Date(items.at(-1)!.thread.updatedAt).getTime() / 1_000,
              ),
            )
          : null,
    };
  }

  override async messageParts(
    ownerId: string,
    threadId: string,
    messageId: string,
  ) {
    const nodeId = await this.#threadPlacement(ownerId, threadId);
    if (!nodeId) return super.messageParts(ownerId, threadId, messageId);
    const detail = await this.getThreadDetail(ownerId, threadId);
    const message = detail.messages.find(
      (candidate) => candidate.id === messageId,
    );
    if (!message)
      throw new ConversationStoreError("not_found", "Message not found");
    return message.parts;
  }

  override async replayEvents(
    input: Parameters<CoreConversationStore["replayEvents"]>[0],
  ) {
    const threadId = await this.#runThread(input.ownerId, input.runId);
    const nodeId = await this.#threadPlacement(input.ownerId, threadId, true);
    if (!nodeId) return super.replayEvents(input);
    try {
      await this.relay.assertOnline(input.ownerId, nodeId);
      const stored = await this.relay.get({
        nodeId,
        ownerId: input.ownerId,
        threadId,
      });
      if (!stored) throw new Error("NODE_CONVERSATION_DAG_NOT_FOUND");
      return stored.events
        .filter(
          (event) =>
            event.runId === input.runId &&
            event.sequence > (input.afterSequence ?? 0),
        )
        .slice(0, input.limit ?? 250);
    } catch (error) {
      unavailable(error);
    }
  }

  async #mutateThread<T>(
    ownerId: string,
    threadId: string,
    operation: () => Promise<T>,
    syncOperation: "append" | "branch" = "append",
  ) {
    const nodeId = await this.#preflight(ownerId, threadId);
    const result = await operation();
    if (nodeId) await this.#sync(ownerId, threadId, syncOperation);
    return result;
  }

  async reconcileNode(nodeId: string, limit = 250) {
    const result = await this.metadataClient.execute({
      sql: `SELECT id, userId FROM assistant_threads
        WHERE placement = 'node' AND placementRef = ?
        ORDER BY updatedAt, id LIMIT ?`,
      args: [nodeId, Math.max(1, Math.min(1_000, limit))],
    });
    const outcomes: Array<{ threadId: string; outcome: "synced" | "failed" }> =
      [];
    for (const row of result.rows) {
      const threadId = String(row.id);
      try {
        await this.#sync(String(row.userId), threadId, "append");
        outcomes.push({ threadId, outcome: "synced" });
      } catch {
        outcomes.push({ threadId, outcome: "failed" });
      }
    }
    return outcomes;
  }

  async migratePlacement(input: {
    ownerId: string;
    source: { kind: string; nodeId?: string; providerId?: string };
    destination: { kind: string; nodeId?: string; providerId?: string };
  }) {
    if (
      !["core", "node"].includes(input.source.kind) ||
      !["core", "node"].includes(input.destination.kind) ||
      samePlacement(input.source, input.destination)
    ) {
      throw new Error("CONVERSATION_MIGRATION_PLACEMENT_UNSUPPORTED");
    }
    const rows = await this.metadataClient.execute({
      sql:
        input.source.kind === "node"
          ? `SELECT id FROM assistant_threads WHERE userId = ?
             AND placement = 'node' AND placementRef = ? ORDER BY id`
          : `SELECT id FROM assistant_threads WHERE userId = ?
             AND placement = 'core' ORDER BY id`,
      args:
        input.source.kind === "node"
          ? [input.ownerId, input.source.nodeId ?? ""]
          : [input.ownerId],
    });
    const snapshots: ConversationMigrationSnapshot[] = [];
    for (const row of rows.rows) {
      const threadId = String(row.id);
      if (input.source.kind === "node") {
        const nodeId = input.source.nodeId;
        if (!nodeId) throw new Error("CONVERSATION_MIGRATION_NODE_REQUIRED");
        await this.relay.assertOnline(input.ownerId, nodeId);
        const snapshot = await this.relay.get({
          nodeId,
          ownerId: input.ownerId,
          threadId,
        });
        if (!snapshot) throw new Error("NODE_CONVERSATION_DAG_NOT_FOUND");
        snapshots.push(snapshot);
      } else {
        snapshots.push(
          await this.#coreSnapshot(
            this.metadataClient,
            input.ownerId,
            threadId,
          ),
        );
      }
    }
    const source = migrationDigest(snapshots);
    const destinationNodeId = input.destination.nodeId;
    let destinationDigest: string | null = null;
    if (input.destination.kind === "node") {
      if (!destinationNodeId) {
        throw new Error("CONVERSATION_MIGRATION_NODE_REQUIRED");
      }
      await this.relay.assertOnline(input.ownerId, destinationNodeId);
      const destinationSnapshots: ConversationMigrationSnapshot[] = [];
      for (const snapshot of snapshots) {
        const detail = {
          ...snapshot.detail,
          thread: {
            ...snapshot.detail.thread,
            placement: { kind: "node" as const, nodeId: destinationNodeId },
          },
        };
        await this.relay.import({
          nodeId: destinationNodeId,
          ownerId: input.ownerId,
          operation: "create",
          snapshot: {
            ownerId: input.ownerId,
            detail,
            events: snapshot.events,
            syncKey: `placement-migration:${detail.thread.id}:${detail.thread.revision}`,
          },
        });
        const stored = await this.relay.get({
          nodeId: destinationNodeId,
          ownerId: input.ownerId,
          threadId: detail.thread.id,
        });
        if (!stored) throw new Error("NODE_CONVERSATION_DAG_NOT_FOUND");
        destinationSnapshots.push(stored);
      }
      destinationDigest = migrationDigest(destinationSnapshots).digest;
      if (source.digest !== destinationDigest) {
        throw new Error("MIGRATION_DIGEST_MISMATCH");
      }
    }

    const transaction = await this.metadataClient.transaction("write");
    try {
      for (const snapshot of snapshots) {
        const threadId = snapshot.detail.thread.id;
        for (const message of snapshot.detail.messages) {
          const parts =
            input.destination.kind === "node"
              ? this.#codec.sealParts({
                  ownerId: input.ownerId,
                  nodeId: destinationNodeId!,
                  threadId,
                  messageId: message.id,
                  role: message.role,
                  parentMessageId: message.parentMessageId,
                  parts: message.parts,
                })
              : message.parts;
          await transaction.execute({
            sql: `UPDATE assistant_messages SET partsJson = ?
              WHERE id = ? AND threadId = ?`,
            args: [JSON.stringify(parts), message.id, threadId],
          });
        }
        for (const event of snapshot.events) {
          const payload =
            input.destination.kind === "node"
              ? this.#codec.sealEvent({
                  ownerId: input.ownerId,
                  nodeId: destinationNodeId!,
                  threadId,
                  runId: event.runId,
                  eventId: event.eventId,
                  payload: event.payload,
                })
              : event.payload;
          await transaction.execute({
            sql: `UPDATE assistant_run_events SET payloadJson = ?
              WHERE runId = ? AND eventId = ?`,
            args: [JSON.stringify(payload), event.runId, event.eventId],
          });
        }
        await transaction.execute({
          sql: `UPDATE assistant_threads SET placement = ?, placementRef = ?
            WHERE id = ? AND userId = ?`,
          args: [
            input.destination.kind,
            input.destination.kind === "node" ? destinationNodeId! : null,
            threadId,
            input.ownerId,
          ],
        });
        await transaction.execute({
          sql: `UPDATE content_sources SET placement = ?, placementRef = ?,
            updatedAt = ? WHERE userId = ? AND originKind = 'conversation'
              AND originId = ?`,
          args: [
            input.destination.kind,
            input.destination.kind === "node" ? destinationNodeId! : null,
            Math.floor(Date.now() / 1_000),
            input.ownerId,
            threadId,
          ],
        });
      }
      if (input.destination.kind === "core") {
        const destinationSnapshots: ConversationMigrationSnapshot[] = [];
        for (const snapshot of snapshots) {
          destinationSnapshots.push(
            await this.#coreSnapshot(
              transaction,
              input.ownerId,
              snapshot.detail.thread.id,
            ),
          );
        }
        destinationDigest = migrationDigest(destinationSnapshots).digest;
        if (source.digest !== destinationDigest) {
          throw new Error("MIGRATION_DIGEST_MISMATCH");
        }
      }
      await transaction.commit();
    } catch (error) {
      await transaction.rollback();
      throw error;
    }
    return {
      itemCount: snapshots.length,
      copiedBytes: source.bytes,
      sourceDigest: source.digest,
      destinationDigest: destinationDigest ?? migrationDigest([]).digest,
    };
  }

  override reserveTurn(
    input: Parameters<CoreConversationStore["reserveTurn"]>[0],
  ) {
    return this.#mutateThread(
      input.ownerId,
      input.threadId,
      () => super.reserveTurn(input),
      input.createBranch || input.forkOnConflict ? "branch" : "append",
    );
  }

  override async reserveRetry(
    input: Parameters<CoreConversationStore["reserveRetry"]>[0],
  ) {
    const threadId = await this.#messageThread(input.ownerId, input.messageId);
    return this.#mutateThread(
      input.ownerId,
      threadId,
      () => super.reserveRetry(input),
      "branch",
    );
  }

  override async editMessage(
    input: Parameters<CoreConversationStore["editMessage"]>[0],
  ) {
    const threadId = await this.#messageThread(input.ownerId, input.messageId);
    return this.#mutateThread(
      input.ownerId,
      threadId,
      () => super.editMessage(input),
      "branch",
    );
  }

  override async startRun(ownerId: string, runId: string) {
    const threadId = await this.#runThread(ownerId, runId);
    return this.#mutateThread(ownerId, threadId, () =>
      super.startRun(ownerId, runId),
    );
  }

  override async markProviderDispatch(
    input: Parameters<CoreConversationStore["markProviderDispatch"]>[0],
  ) {
    const threadId = await this.#runThread(input.ownerId, input.runId);
    return this.#mutateThread(input.ownerId, threadId, () =>
      super.markProviderDispatch(input),
    );
  }

  override async bindConversationCheckpoint(
    input: Parameters<CoreConversationStore["bindConversationCheckpoint"]>[0],
  ) {
    const threadId = await this.#runThread(input.ownerId, input.runId);
    return this.#mutateThread(input.ownerId, threadId, () =>
      super.bindConversationCheckpoint(input),
    );
  }

  override async appendRunEvent(
    input: Parameters<CoreConversationStore["appendRunEvent"]>[0],
  ) {
    const threadId = await this.#runThread(input.ownerId, input.runId);
    return this.#mutateThread(input.ownerId, threadId, () =>
      super.appendRunEvent(input),
    );
  }

  override async finalizeRun(
    input: Parameters<CoreConversationStore["finalizeRun"]>[0],
  ) {
    const threadId = await this.#runThread(input.ownerId, input.runId);
    const nodeId = await this.#threadPlacement(input.ownerId, threadId, true);
    const result = await this.#mutateThread(input.ownerId, threadId, () =>
      super.finalizeRun(input),
    );
    return nodeId
      ? { ...result, output: { ...result.output, parts: input.finalParts } }
      : result;
  }

  override async cancelRun(ownerId: string, runId: string) {
    const threadId = await this.#runThread(ownerId, runId);
    return this.#mutateThread(ownerId, threadId, () =>
      super.cancelRun(ownerId, runId),
    );
  }

  override async respondToQuestion(
    input: Parameters<CoreConversationStore["respondToQuestion"]>[0],
  ) {
    const threadId = await this.#runThread(input.ownerId, input.runId);
    return this.#mutateThread(input.ownerId, threadId, () =>
      super.respondToQuestion(input),
    );
  }

  override updateThread(
    input: Parameters<CoreConversationStore["updateThread"]>[0],
  ) {
    return this.#mutateThread(input.ownerId, input.threadId, () =>
      super.updateThread(input),
    );
  }

  override trashThread(
    input: Parameters<CoreConversationStore["trashThread"]>[0],
  ) {
    return this.#mutateThread(input.ownerId, input.threadId, () =>
      super.trashThread(input),
    );
  }

  override restoreThread(
    input: Parameters<CoreConversationStore["restoreThread"]>[0],
  ) {
    return this.#mutateThread(input.ownerId, input.threadId, () =>
      super.restoreThread(input),
    );
  }

  override async createAttachment(
    input: Parameters<CoreConversationStore["createAttachment"]>[0],
  ) {
    const threadId = await this.#messageThread(input.ownerId, input.messageId);
    return this.#mutateThread(input.ownerId, threadId, () =>
      super.createAttachment(input),
    );
  }

  override async purgeExpired(ownerId?: string) {
    const result = await this.metadataClient.execute({
      sql: `SELECT id, userId, placementRef FROM assistant_threads
        WHERE deletedAt IS NOT NULL AND purgeAfter <= ? AND placement = 'node'
          ${ownerId ? "AND userId = ?" : ""}`,
      args: ownerId
        ? [Math.floor(Date.now() / 1_000), ownerId]
        : [Math.floor(Date.now() / 1_000)],
    });
    for (const row of result.rows) {
      try {
        await this.relay.assertOnline(
          String(row.userId),
          String(row.placementRef),
        );
        await this.relay.delete({
          nodeId: String(row.placementRef),
          ownerId: String(row.userId),
          threadId: String(row.id),
        });
      } catch (error) {
        unavailable(error);
      }
    }
    return super.purgeExpired(ownerId);
  }
}
