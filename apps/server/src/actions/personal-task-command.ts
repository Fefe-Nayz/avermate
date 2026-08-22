import type { Client, InStatement, InValue, Transaction } from "@libsql/client";

export type ActionSqlClient = Pick<Client, "execute" | "transaction">;
type TransactionStarter = Pick<Client, "transaction">;
type SqlTarget = ActionSqlClient | Transaction;
type Row = Record<string, InValue>;

export type PersonalTaskInput = {
  resourceId: string;
  userId: string;
  yearId: string;
  title: string;
  notes: string | null;
  localNote: string | null;
  startsAt: Date | null;
  scheduledAt: Date | null;
  dueAt: Date | null;
  subjectId: string | null;
};

export type PersonalTaskRecord = {
  id: string;
  title: string;
  notes: string | null;
  localNote: string | null;
  startsAt: Date | null;
  scheduledAt: Date | null;
  dueAt: Date | null;
  status: "todo" | "doing" | "done";
  completedAt: Date | null;
  subjectId: string | null;
  sortOrder: number;
  revision: number;
  trashedAt: Date | null;
  yearId: string;
  userId: string;
  sourceConnectionId: string | null;
  externalId: string | null;
  syncState: "managed" | "detached" | "missing" | "dismissed";
  createdAt: Date;
  updatedAt: Date;
};

export class PersonalTaskCommandError extends Error {
  constructor(
    readonly code: "not-found" | "forbidden" | "conflict" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "PersonalTaskCommandError";
  }
}

export function isActionSqlBusy(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === "object" &&
    "code" in error &&
    ["SQLITE_BUSY", "SQLITE_LOCKED"].includes(String(error.code))
  );
}

const clientWriteTails = new WeakMap<TransactionStarter, Promise<void>>();

async function acquireClientWriteTurn(
  client: TransactionStarter,
): Promise<() => void> {
  const previous = clientWriteTails.get(client) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.catch(() => undefined).then(() => current);
  clientWriteTails.set(client, tail);
  await previous.catch(() => undefined);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    if (clientWriteTails.get(client) === tail) {
      void tail.finally(() => {
        if (clientWriteTails.get(client) === tail)
          clientWriteTails.delete(client);
      });
    }
  };
}

/**
 * SQLite begins a write transaction eagerly. Independent workers can race at
 * that boundary, so retry only the pre-transaction lock acquisition; domain
 * statements are never replayed by this helper.
 */
export async function beginActionWriteTransaction(
  client: TransactionStarter,
): Promise<Transaction> {
  const release = await acquireClientWriteTurn(client);
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      const transaction = await client.transaction("write");
      return new Proxy(transaction, {
        get(target, property) {
          if (property === "commit") {
            return async () => {
              try {
                return await target.commit();
              } finally {
                release();
              }
            };
          }
          if (property === "rollback") {
            return async () => {
              try {
                return await target.rollback();
              } finally {
                release();
              }
            };
          }
          const value = target[property as keyof Transaction] as unknown;
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    } catch (error) {
      lastError = error;
      if (!isActionSqlBusy(error)) {
        release();
        throw error;
      }
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(50, 2 + attempt * 3)),
      );
    }
  }
  release();
  throw lastError;
}

function unix(date: Date | null): number | null {
  return date === null ? null : Math.floor(date.getTime() / 1_000);
}

function fromUnix(value: InValue): Date | null {
  if (value === null) return null;
  const numeric = Number(value);
  return new Date(numeric < 10_000_000_000 ? numeric * 1_000 : numeric);
}

async function execute(target: SqlTarget, statement: InStatement) {
  return target.execute(statement);
}

async function one(
  target: SqlTarget,
  sql: string,
  args: InValue[] = [],
): Promise<Row | null> {
  return (
    ((await execute(target, { sql, args })).rows[0] as Row | undefined) ?? null
  );
}

function stringOrNull(value: InValue): string | null {
  return value === null ? null : String(value);
}

function taskFromRow(row: Row): PersonalTaskRecord {
  return {
    id: String(row.id),
    title: String(row.title),
    notes: stringOrNull(row.notes),
    localNote: stringOrNull(row.localNote),
    startsAt: fromUnix(row.startsAt),
    scheduledAt: fromUnix(row.scheduledAt),
    dueAt: fromUnix(row.dueAt),
    status: row.status as PersonalTaskRecord["status"],
    completedAt: fromUnix(row.completedAt),
    subjectId: stringOrNull(row.subjectId),
    sortOrder: Number(row.sortOrder),
    revision: Number(row.revision),
    trashedAt: fromUnix(row.trashedAt),
    yearId: String(row.yearId),
    userId: String(row.userId),
    sourceConnectionId: stringOrNull(row.sourceConnectionId),
    externalId: stringOrNull(row.externalId),
    syncState: row.syncState as PersonalTaskRecord["syncState"],
    createdAt: fromUnix(row.createdAt)!,
    updatedAt: fromUnix(row.updatedAt)!,
  };
}

function sameNullable(left: InValue, right: InValue): boolean {
  return left === right || (left === null && right === null);
}

function assertTaskDates(
  input: Pick<PersonalTaskInput, "startsAt" | "scheduledAt" | "dueAt">,
): void {
  if (input.startsAt && input.dueAt && input.dueAt < input.startsAt) {
    throw new PersonalTaskCommandError(
      "invalid",
      "A task cannot start after its due date",
    );
  }
  if (input.scheduledAt && input.dueAt && input.dueAt < input.scheduledAt) {
    throw new PersonalTaskCommandError(
      "invalid",
      "A task cannot be due before its scheduled time",
    );
  }
}

async function validateScope(
  target: SqlTarget,
  input: Pick<PersonalTaskInput, "userId" | "yearId" | "subjectId">,
): Promise<void> {
  if (
    !(await one(target, "SELECT id FROM years WHERE id = ? AND userId = ?", [
      input.yearId,
      input.userId,
    ]))
  ) {
    throw new PersonalTaskCommandError("not-found", "Academic year not found");
  }
  if (
    input.subjectId &&
    !(await one(
      target,
      "SELECT id FROM subjects WHERE id = ? AND userId = ? AND yearId = ?",
      [input.subjectId, input.userId, input.yearId],
    ))
  ) {
    throw new PersonalTaskCommandError("not-found", "Subject not found");
  }
}

/**
 * Canonical, effect-idempotent task creation command. The resource ID is
 * server-reserved (the agent/model never supplies it), making crash replay safe.
 */
export async function createPersonalTaskCommand(
  client: ActionSqlClient,
  input: PersonalTaskInput,
): Promise<PersonalTaskRecord> {
  const transaction = await beginActionWriteTransaction(client);
  try {
    const task = await createPersonalTaskInTransaction(transaction, input);
    await transaction.commit();
    return task;
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

/**
 * Transaction-scoped variant used when task creation is one effect in a wider
 * atomic domain command. The caller owns commit and rollback.
 */
export async function createPersonalTaskInTransaction(
  transaction: Transaction,
  input: PersonalTaskInput,
): Promise<PersonalTaskRecord> {
  assertTaskDates(input);
  await validateScope(transaction, input);
  const last = await one(
    transaction,
    `SELECT sortOrder FROM planning_tasks
     WHERE userId = ? AND yearId = ? AND status = 'todo' AND trashedAt IS NULL
     ORDER BY sortOrder DESC LIMIT 1`,
    [input.userId, input.yearId],
  );
  const now = Math.floor(Date.now() / 1_000);
  const values: InValue[] = [
    input.resourceId,
    input.title,
    input.notes,
    input.localNote,
    unix(input.startsAt),
    unix(input.scheduledAt),
    unix(input.dueAt),
    input.subjectId,
    Number(last?.sortOrder ?? -1) + 1,
    input.yearId,
    input.userId,
    now,
    now,
  ];
  await execute(transaction, {
    sql: `INSERT OR IGNORE INTO planning_tasks
      (id, title, notes, localNote, startsAt, scheduledAt, dueAt, status,
       completedAt, subjectId, sortOrder, revision, trashedAt, yearId, userId,
       sourceConnectionId, externalId, syncState, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'todo', NULL, ?, ?, 1, NULL, ?, ?, NULL,
              NULL, 'detached', ?, ?)`,
    args: values,
  });
  const row = await one(
    transaction,
    "SELECT * FROM planning_tasks WHERE id = ? AND userId = ? LIMIT 1",
    [input.resourceId, input.userId],
  );
  if (!row) {
    throw new PersonalTaskCommandError("conflict", "Task reservation failed");
  }
  const expected = [
    input.title,
    input.notes,
    input.localNote,
    unix(input.startsAt),
    unix(input.scheduledAt),
    unix(input.dueAt),
    input.subjectId,
    input.yearId,
  ];
  const actual: InValue[] = [
    row.title,
    row.notes,
    row.localNote,
    row.startsAt,
    row.scheduledAt,
    row.dueAt,
    row.subjectId,
    row.yearId,
  ];
  if (
    String(row.userId) !== input.userId ||
    row.syncState !== "detached" ||
    row.trashedAt !== null ||
    expected.some((value, index) => !sameNullable(value, actual[index]!))
  ) {
    throw new PersonalTaskCommandError(
      "conflict",
      "The reserved task ID belongs to different content",
    );
  }
  return taskFromRow(row);
}

export async function getPersonalTaskCommand(
  client: ActionSqlClient,
  input: { userId: string; taskId: string; includeTrashed?: boolean },
): Promise<PersonalTaskRecord> {
  const row = await one(
    client,
    `SELECT * FROM planning_tasks
     WHERE id = ? AND userId = ? ${input.includeTrashed ? "" : "AND trashedAt IS NULL"}
     LIMIT 1`,
    [input.taskId, input.userId],
  );
  if (!row) throw new PersonalTaskCommandError("not-found", "Task not found");
  return taskFromRow(row);
}

export async function trashPersonalTaskCommand(
  client: ActionSqlClient,
  input: { userId: string; taskId: string; expectedRevision: number },
): Promise<PersonalTaskRecord> {
  const transaction = await beginActionWriteTransaction(client);
  try {
    const before = await one(
      transaction,
      "SELECT * FROM planning_tasks WHERE id = ? AND userId = ? LIMIT 1",
      [input.taskId, input.userId],
    );
    if (!before)
      throw new PersonalTaskCommandError("not-found", "Task not found");
    if (before.sourceConnectionId !== null || before.syncState !== "detached") {
      throw new PersonalTaskCommandError(
        "forbidden",
        "Provider-managed tasks cannot be trashed through a personal action",
      );
    }
    if (before.trashedAt !== null) {
      if (Number(before.revision) === input.expectedRevision + 1) {
        await transaction.commit();
        return taskFromRow(before);
      }
      throw new PersonalTaskCommandError("conflict", "Task is already trashed");
    }
    const now = Math.floor(Date.now() / 1_000);
    const result = await execute(transaction, {
      sql: `UPDATE planning_tasks
            SET trashedAt = ?, revision = revision + 1, updatedAt = ?
            WHERE id = ? AND userId = ? AND revision = ? AND trashedAt IS NULL`,
      args: [now, now, input.taskId, input.userId, input.expectedRevision],
    });
    if (result.rowsAffected !== 1) {
      throw new PersonalTaskCommandError(
        "conflict",
        "Task revision changed before trash",
      );
    }
    const after = await one(
      transaction,
      "SELECT * FROM planning_tasks WHERE id = ? AND userId = ? LIMIT 1",
      [input.taskId, input.userId],
    );
    await transaction.commit();
    return taskFromRow(after!);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export async function restorePersonalTaskCommand(
  client: ActionSqlClient,
  input: { userId: string; taskId: string; expectedRevision: number },
): Promise<PersonalTaskRecord> {
  const transaction = await beginActionWriteTransaction(client);
  try {
    const before = await one(
      transaction,
      "SELECT * FROM planning_tasks WHERE id = ? AND userId = ? LIMIT 1",
      [input.taskId, input.userId],
    );
    if (!before)
      throw new PersonalTaskCommandError("not-found", "Task not found");
    if (before.sourceConnectionId !== null || before.syncState !== "detached") {
      throw new PersonalTaskCommandError(
        "forbidden",
        "Provider-managed tasks cannot be restored through a personal action",
      );
    }
    if (before.trashedAt === null) {
      throw new PersonalTaskCommandError("conflict", "Task is not in trash");
    }
    const now = Math.floor(Date.now() / 1_000);
    const result = await execute(transaction, {
      sql: `UPDATE planning_tasks
            SET trashedAt = NULL, revision = revision + 1, updatedAt = ?
            WHERE id = ? AND userId = ? AND revision = ? AND trashedAt IS NOT NULL`,
      args: [now, input.taskId, input.userId, input.expectedRevision],
    });
    if (result.rowsAffected !== 1) {
      throw new PersonalTaskCommandError(
        "conflict",
        "Task revision changed before restore",
      );
    }
    const after = await one(
      transaction,
      "SELECT * FROM planning_tasks WHERE id = ? AND userId = ? LIMIT 1",
      [input.taskId, input.userId],
    );
    await transaction.commit();
    return taskFromRow(after!);
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}

export function personalTaskRevision(
  task: Pick<PersonalTaskRecord, "revision">,
) {
  return String(task.revision);
}
