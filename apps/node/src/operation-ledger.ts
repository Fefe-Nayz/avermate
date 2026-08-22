import type { NodeControlFrame } from "@avermate/agent-contracts";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

export type StoredOperationResult = Omit<
  Extract<NodeControlFrame, { type: "operation-result" }>,
  "type" | "frameId" | "nodeId" | "connectionEpoch" | "operationId"
>;

type OperationRecord = {
  requestDigest: string;
  expiresAt: string;
  state: "running" | "terminal";
  results: StoredOperationResult[];
};

type OperationLedgerFile = {
  version: 1;
  operations: Record<string, OperationRecord>;
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

async function atomicWrite(path: string, state: OperationLedgerFile) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(state)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temporary, path);
}

/** Node-owned retained relay results used for bounded reconnect replay. */
export class NodeOperationResultLedger {
  readonly #path: string;
  readonly #maximumBytes: number;
  #state: OperationLedgerFile | null = null;
  #mutex: Promise<void> = Promise.resolve();

  constructor(input: { path: string; maximumBytes: number }) {
    if (
      !Number.isSafeInteger(input.maximumBytes) ||
      input.maximumBytes < 64 * 1024 ||
      input.maximumBytes > 1024 ** 3
    ) {
      throw new Error("NODE_OPERATION_LEDGER_QUOTA_INVALID");
    }
    this.#path = input.path;
    this.#maximumBytes = input.maximumBytes;
  }

  async initialize() {
    await this.#load();
  }

  async recoverInterrupted(now = new Date()) {
    return this.#exclusive((state) => {
      let recovered = 0;
      this.#prune(state, now);
      for (const operation of Object.values(state.operations)) {
        if (operation.state !== "running") continue;
        const sequence = operation.results.length + 1;
        operation.results.push({
          sequence,
          ok: false,
          safeErrorCode: "NODE_OPERATION_RESTARTED_RESYNC_REQUIRED",
          retryable: true,
          terminal: true,
        });
        operation.state = "terminal";
        recovered += 1;
      }
      return recovered;
    });
  }

  async offer(input: {
    operationId: string;
    requestDigest: string;
    expiresAt: string;
    now?: Date;
  }) {
    if (
      !input.operationId ||
      input.operationId.length > 256 ||
      !/^sha256:[a-f0-9]{64}$/u.test(input.requestDigest) ||
      !Number.isFinite(Date.parse(input.expiresAt))
    ) {
      throw new Error("NODE_OPERATION_LEDGER_OFFER_INVALID");
    }
    return this.#exclusive((state) => {
      this.#prune(state, input.now ?? new Date());
      const previous = state.operations[input.operationId];
      if (previous) {
        if (previous.requestDigest !== input.requestDigest) {
          throw new Error("NODE_OPERATION_ID_REPLAY_MISMATCH");
        }
        return { replayed: true, record: clone(previous) };
      }
      const record: OperationRecord = {
        requestDigest: input.requestDigest,
        expiresAt: input.expiresAt,
        state: "running",
        results: [],
      };
      state.operations[input.operationId] = record;
      return { replayed: false, record: clone(record) };
    });
  }

  async append(operationId: string, result: StoredOperationResult) {
    return this.#exclusive((state) => {
      const operation = state.operations[operationId];
      if (!operation) throw new Error("NODE_OPERATION_LEDGER_NOT_FOUND");
      const previous = operation.results[result.sequence - 1];
      if (previous) {
        if (JSON.stringify(previous) !== JSON.stringify(result)) {
          throw new Error("NODE_OPERATION_RESULT_REPLAY_MISMATCH");
        }
        return { replayed: true, result: clone(previous) };
      }
      if (
        operation.state === "terminal" ||
        result.sequence !== operation.results.length + 1 ||
        (!result.ok && !result.terminal)
      ) {
        throw new Error("NODE_OPERATION_RESULT_SEQUENCE_INVALID");
      }
      operation.results.push(clone(result));
      if (result.terminal) operation.state = "terminal";
      return { replayed: false, result: clone(result) };
    });
  }

  async get(operationId: string) {
    const state = await this.#load();
    const record = state.operations[operationId];
    return record ? clone(record) : null;
  }

  #prune(state: OperationLedgerFile, now: Date) {
    for (const [operationId, operation] of Object.entries(state.operations)) {
      if (Date.parse(operation.expiresAt) <= now.getTime()) {
        delete state.operations[operationId];
      }
    }
  }

  async #load() {
    if (this.#state) return this.#state;
    try {
      const state = JSON.parse(await readFile(this.#path, "utf8")) as
        | OperationLedgerFile
        | undefined;
      if (!state || state.version !== 1 || !state.operations) {
        throw new Error("NODE_OPERATION_LEDGER_VERSION_UNSUPPORTED");
      }
      this.#state = state;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      this.#state = { version: 1, operations: {} };
    }
    return this.#state;
  }

  async #exclusive<T>(
    operation: (state: OperationLedgerFile) => T | Promise<T>,
  ) {
    const previous = this.#mutex;
    let release!: () => void;
    this.#mutex = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      const state = await this.#load();
      const result = await operation(state);
      const byteSize = new TextEncoder().encode(JSON.stringify(state)).byteLength;
      if (byteSize > this.#maximumBytes) {
        this.#state = null;
        throw new Error("NODE_OPERATION_LEDGER_QUOTA_EXCEEDED");
      }
      await atomicWrite(this.#path, state);
      return result;
    } finally {
      release();
    }
  }
}
