import type { Client, InValue, Transaction } from "@libsql/client";
import {
  beginActionWriteTransaction,
  createPersonalTaskInTransaction,
  PersonalTaskCommandError,
  type PersonalTaskInput,
} from "../actions/personal-task-command";
import { newId } from "../lib/id";

type PlanApplyClient = Pick<Client, "execute" | "transaction">;
type Row = Record<string, InValue>;

export class LearningPlanApplyError extends Error {
  constructor(
    readonly code:
      | "not-found"
      | "stale-revision"
      | "divergent-replay"
      | "invalid-state"
      | "invalid-task",
    message: string,
  ) {
    super(message);
    this.name = "LearningPlanApplyError";
  }
}

export type LearningPlanApplyResult = {
  itemId: string;
  planningTaskId: string;
  revision: number;
  replayed: boolean;
};

async function one(
  transaction: Transaction,
  sql: string,
  args: InValue[],
): Promise<Row | null> {
  return (
    ((await transaction.execute({ sql, args })).rows[0] as Row | undefined) ??
    null
  );
}

function taskInput(
  row: Row,
  input: {
    userId: string;
    scheduledAt: Date | null;
    dueAt: Date | null;
  },
  resourceId: string,
): PersonalTaskInput {
  return {
    resourceId,
    userId: input.userId,
    yearId: String(row.yearId),
    title: `Réviser · ${String(row.conceptLocalLabel ?? row.conceptCanonicalLabel)}`,
    notes: String(row.objectiveStatement),
    localNote: "Créé depuis le plan d’apprentissage Avermate",
    startsAt: null,
    scheduledAt: input.scheduledAt,
    dueAt: input.dueAt,
    subjectId: row.subjectId === null ? null : String(row.subjectId),
  };
}

/**
 * Atomically turns one revision-fenced recommendation into its authoritative
 * personal planning task. Replaying the exact committed request is safe; a
 * replay with different dates fails closed as divergent.
 */
export async function applyLearningPlanItemCommand(
  client: PlanApplyClient,
  input: {
    userId: string;
    itemId: string;
    expectedRevision: number;
    scheduledAt: Date | null;
    dueAt: Date | null;
  },
): Promise<LearningPlanApplyResult> {
  const transaction = await beginActionWriteTransaction(client);
  try {
    const row = await one(
      transaction,
      `SELECT item.id, item.revision, item.status, item.planningTaskId,
              item.yearId, item.subjectId, objective.statement AS objectiveStatement,
              concept.localLabel AS conceptLocalLabel,
              concept.canonicalLabel AS conceptCanonicalLabel
       FROM learning_plan_items item
       INNER JOIN learning_objectives objective ON objective.id = item.objectiveId
       INNER JOIN learning_concepts concept ON concept.id = objective.conceptId
       WHERE item.id = ? AND item.userId = ?
       LIMIT 1`,
      [input.itemId, input.userId],
    );
    if (!row) {
      throw new LearningPlanApplyError(
        "not-found",
        "Learning plan item not found",
      );
    }

    const revision = Number(row.revision);
    const existingTaskId =
      row.planningTaskId === null ? null : String(row.planningTaskId);
    if (existingTaskId) {
      if (revision !== input.expectedRevision + 1) {
        throw new LearningPlanApplyError(
          "stale-revision",
          "The learning plan item changed before this request was replayed",
        );
      }
      try {
        await createPersonalTaskInTransaction(
          transaction,
          taskInput(row, input, existingTaskId),
        );
      } catch (error) {
        if (
          error instanceof PersonalTaskCommandError &&
          error.code === "conflict"
        ) {
          throw new LearningPlanApplyError(
            "divergent-replay",
            "The learning plan request was replayed with different task content",
          );
        }
        throw error;
      }
      await transaction.commit();
      return {
        itemId: input.itemId,
        planningTaskId: existingTaskId,
        revision,
        replayed: true,
      };
    }

    if (revision !== input.expectedRevision) {
      throw new LearningPlanApplyError(
        "stale-revision",
        "The learning plan item changed before it was applied",
      );
    }
    if (row.status !== "proposed") {
      throw new LearningPlanApplyError(
        "invalid-state",
        "Only a proposed learning plan item can create a planning task",
      );
    }

    const planningTaskId = newId("ptask");
    try {
      await createPersonalTaskInTransaction(
        transaction,
        taskInput(row, input, planningTaskId),
      );
    } catch (error) {
      if (
        error instanceof PersonalTaskCommandError &&
        error.code === "invalid"
      ) {
        throw new LearningPlanApplyError("invalid-task", error.message);
      }
      throw error;
    }
    const now = Math.floor(Date.now() / 1_000);
    const updated = await transaction.execute({
      sql: `UPDATE learning_plan_items
            SET planningTaskId = ?, status = 'accepted',
                revision = revision + 1, updatedAt = ?
            WHERE id = ? AND userId = ? AND revision = ?
              AND planningTaskId IS NULL AND status = 'proposed'`,
      args: [
        planningTaskId,
        now,
        input.itemId,
        input.userId,
        input.expectedRevision,
      ],
    });
    if (updated.rowsAffected !== 1) {
      throw new LearningPlanApplyError(
        "stale-revision",
        "The learning plan item changed while it was applied",
      );
    }
    await transaction.commit();
    return {
      itemId: input.itemId,
      planningTaskId,
      revision: input.expectedRevision + 1,
      replayed: false,
    };
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
