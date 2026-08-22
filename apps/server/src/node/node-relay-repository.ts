import type { Client } from "@libsql/client";
import type { NodeCapabilityId } from "@avermate/agent-contracts";

function seconds(date: Date) {
  return Math.floor(date.getTime() / 1_000);
}

export type RelayOperationRecord = {
  id: string;
  nodeId: string;
  userId: string;
  capability: NodeCapabilityId;
  configRevision: string;
  requestDigest: string;
  state: "offered" | "running" | "cancel-requested" | "completed" | "failed";
  lastSequence: number;
  acknowledgedSequence: number;
  deadline: string;
};

export interface RelayOperationJournal {
  begin(record: Omit<RelayOperationRecord, "state" | "lastSequence" | "acknowledgedSequence">, now?: Date): Promise<void>;
  advance(input: {
    operationId: string;
    expectedPreviousSequence: number;
    sequence: number;
    terminalState?: "completed" | "failed";
  }, now?: Date): Promise<void>;
  acknowledge(operationId: string, sequence: number, now?: Date): Promise<void>;
  requestCancellation(operationId: string, now?: Date): Promise<void>;
  fail(operationId: string, now?: Date): Promise<void>;
}

/** Metadata-only durable relay journal. Request and result bodies never enter Core SQL. */
export class SqlRelayOperationJournal implements RelayOperationJournal {
  constructor(private readonly client: Client) {}

  async begin(
    record: Omit<RelayOperationRecord, "state" | "lastSequence" | "acknowledgedSequence">,
    now = new Date(),
  ) {
    await this.client.execute({
      sql: `INSERT INTO node_relay_operations
        (id, nodeId, userId, capability, configRevision, requestDigest, state,
         lastSequence, acknowledgedSequence, deadline, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, 'offered', 0, 0, ?, ?, ?)`,
      args: [
        record.id,
        record.nodeId,
        record.userId,
        record.capability,
        record.configRevision,
        record.requestDigest,
        seconds(new Date(record.deadline)),
        seconds(now),
        seconds(now),
      ],
    });
  }

  async advance(
    input: {
      operationId: string;
      expectedPreviousSequence: number;
      sequence: number;
      terminalState?: "completed" | "failed";
    },
    now = new Date(),
  ) {
    if (input.sequence !== input.expectedPreviousSequence + 1) {
      throw new Error("NODE_RELAY_SEQUENCE_GAP");
    }
    const state = input.terminalState ?? "running";
    const result = await this.client.execute({
      sql: `UPDATE node_relay_operations
        SET state = ?, lastSequence = ?, updatedAt = ?
        WHERE id = ? AND lastSequence = ?
          AND state IN ('offered', 'running', 'cancel-requested')`,
      args: [
        state,
        input.sequence,
        seconds(now),
        input.operationId,
        input.expectedPreviousSequence,
      ],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new Error("NODE_RELAY_OPERATION_FENCED");
    }
  }

  async acknowledge(operationId: string, sequence: number, now = new Date()) {
    const result = await this.client.execute({
      sql: `UPDATE node_relay_operations SET acknowledgedSequence = ?, updatedAt = ?
        WHERE id = ? AND lastSequence >= ? AND acknowledgedSequence < ?`,
      args: [sequence, seconds(now), operationId, sequence, sequence],
    });
    if (Number(result.rowsAffected) !== 1) {
      const current = await this.client.execute({
        sql: `SELECT acknowledgedSequence FROM node_relay_operations
          WHERE id = ? LIMIT 1`,
        args: [operationId],
      });
      if (Number(current.rows[0]?.acknowledgedSequence) !== sequence) {
        throw new Error("NODE_RELAY_ACK_FENCED");
      }
    }
  }

  async requestCancellation(operationId: string, now = new Date()) {
    const result = await this.client.execute({
      sql: `UPDATE node_relay_operations
        SET state = 'cancel-requested', updatedAt = ?
        WHERE id = ? AND state IN ('offered', 'running')`,
      args: [seconds(now), operationId],
    });
    if (Number(result.rowsAffected) !== 1) {
      throw new Error("NODE_RELAY_OPERATION_NOT_CANCELLABLE");
    }
  }

  async fail(operationId: string, now = new Date()) {
    await this.client.execute({
      sql: `UPDATE node_relay_operations SET state = 'failed', updatedAt = ?
        WHERE id = ? AND state IN ('offered', 'running', 'cancel-requested')`,
      args: [seconds(now), operationId],
    });
  }
}
