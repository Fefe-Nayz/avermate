export type PersistedProjectionBundle = {
  model: unknown;
  ui: unknown;
  audit: unknown;
};

export type OperationReservation =
  | { state: "new"; reference: string }
  | { state: "replayed"; projections: PersistedProjectionBundle }
  | { state: "conflict" | "pending" | "inspect-required" };

export interface ToolOperationStore {
  reserve(input: {
    userId: string;
    toolId: string;
    toolVersion: number;
    branchId: string | null;
    idempotencyKey: string;
    argumentsHash: string;
  }): Promise<OperationReservation>;
  complete(
    reference: string,
    projections: PersistedProjectionBundle,
  ): Promise<void>;
  inspectRequired(reference: string): Promise<void>;
}

type MemoryRow = {
  reference: string;
  argumentsHash: string;
  status: "pending" | "completed" | "inspect-required";
  projections?: PersistedProjectionBundle;
};

export class MemoryToolOperationStore implements ToolOperationStore {
  readonly #rows = new Map<string, MemoryRow>();
  reserve(input: {
    userId: string;
    toolId: string;
    toolVersion: number;
    branchId: string | null;
    idempotencyKey: string;
    argumentsHash: string;
  }): Promise<OperationReservation> {
    const key = `${input.userId}\0${input.toolId}@${input.toolVersion}\0${input.branchId ?? ""}\0${input.idempotencyKey}`;
    const existing = this.#rows.get(key);
    if (existing) {
      if (existing.argumentsHash !== input.argumentsHash) {
        return Promise.resolve({ state: "conflict" });
      }
      if (existing.status === "completed" && existing.projections) {
        return Promise.resolve({
          state: "replayed",
          projections: existing.projections,
        });
      }
      return Promise.resolve({
        state:
          existing.status === "inspect-required"
            ? "inspect-required"
            : "pending",
      });
    }
    const reference = crypto.randomUUID();
    this.#rows.set(key, {
      reference,
      argumentsHash: input.argumentsHash,
      status: "pending",
    });
    return Promise.resolve({ state: "new", reference });
  }
  async complete(
    reference: string,
    projections: PersistedProjectionBundle,
  ): Promise<void> {
    for (const row of this.#rows.values()) {
      if (row.reference === reference) {
        row.status = "completed";
        row.projections = structuredClone(projections);
        return;
      }
    }
    throw new Error("Unknown tool operation reservation");
  }
  async inspectRequired(reference: string): Promise<void> {
    for (const row of this.#rows.values()) {
      if (row.reference === reference) {
        row.status = "inspect-required";
        return;
      }
    }
  }
}
