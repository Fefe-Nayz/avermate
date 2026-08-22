import type { ToolBudget } from "@avermate/agent-contracts";

const encoder = new TextEncoder();
const signedUrlPattern =
  /(?:[?&](?:x-amz-(?:signature|credential)|signature|token|access_token)=)|(?:^|\s)bearer\s+[a-z0-9._~-]+/i;
const storageKeyPattern = /^(?:private|public)\/[a-z0-9/_-]{8,}$/i;
const sensitiveKeyPattern =
  /(^|[-_])(authorization|cookie|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token|private[-_]?key|signed[-_]?url|storage[-_]?key|object[-_]?key)($|[-_])/i;

export class BudgetExceededError extends Error {
  constructor(
    readonly dimension: "bytes" | "depth" | "items",
    readonly actual: number,
    readonly limit: number,
  ) {
    super(`Structured value exceeds its ${dimension} budget`);
    this.name = "BudgetExceededError";
  }
}

export type StructureSize = { bytes: number; depth: number; items: number };

export function serializedSize(value: unknown): StructureSize {
  const seen = new WeakSet<object>();
  let depth = 0;
  let items = 0;

  function visit(current: unknown, level: number): void {
    depth = Math.max(depth, level);
    if (current === null || typeof current !== "object") return;
    if (seen.has(current)) throw new Error("Cyclic tool values are forbidden");
    seen.add(current);
    if (Array.isArray(current)) {
      items += current.length;
      for (const entry of current) visit(entry, level + 1);
    } else {
      const entries = Object.entries(current);
      items += entries.length;
      for (const [, entry] of entries) visit(entry, level + 1);
    }
    seen.delete(current);
  }

  visit(value, 1);
  const serialized = JSON.stringify(value);
  if (serialized === undefined)
    throw new Error("Tool values must be JSON serializable");
  return { bytes: encoder.encode(serialized).byteLength, depth, items };
}

export function enforceBudget(
  value: unknown,
  budget: ToolBudget,
): StructureSize {
  const size = serializedSize(value);
  if (size.bytes > budget.maxBytes) {
    throw new BudgetExceededError("bytes", size.bytes, budget.maxBytes);
  }
  if (size.depth > budget.maxDepth) {
    throw new BudgetExceededError("depth", size.depth, budget.maxDepth);
  }
  if (size.items > budget.maxItems) {
    throw new BudgetExceededError("items", size.items, budget.maxItems);
  }
  return size;
}

/** Persistable projections may contain opaque handles, never provider access. */
export function assertProjectionSafe(value: unknown): void {
  const seen = new WeakSet<object>();
  function visit(current: unknown): void {
    if (typeof current === "string") {
      if (signedUrlPattern.test(current) || storageKeyPattern.test(current)) {
        throw new Error(
          "A projection contains a credential, signed URL, or storage key",
        );
      }
      return;
    }
    if (current === null || typeof current !== "object") return;
    if (seen.has(current)) throw new Error("Cyclic projections are forbidden");
    seen.add(current);
    for (const [key, entry] of Object.entries(current)) {
      if (sensitiveKeyPattern.test(key)) {
        throw new Error(`Sensitive projection field is forbidden: ${key}`);
      }
      visit(entry);
    }
    seen.delete(current);
  }
  visit(value);
}

export function redactForToolBoundary(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactForToolBoundary);
  if (value === null || typeof value !== "object") {
    return typeof value === "string" && signedUrlPattern.test(value)
      ? "[REDACTED]"
      : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [
      key,
      sensitiveKeyPattern.test(key)
        ? "[REDACTED]"
        : redactForToolBoundary(entry),
    ]),
  );
}
