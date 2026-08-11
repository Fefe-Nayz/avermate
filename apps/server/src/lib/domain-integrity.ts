import { ORPCError } from "@orpc/server";

function invalid(message: string): never {
  throw new ORPCError("BAD_REQUEST", { message });
}

export type TargetKind = "general" | "subject" | "custom";

/**
 * Application references are user-owned *and* year-scoped. Ownership alone
 * is not enough: mixing two of a user's years produces a graph that cannot be
 * interpreted consistently by snapshots, goals or cards.
 */
export function assertSameYear(
  label: string,
  expectedYearId: string,
  actualYearId: string,
): void {
  if (actualYearId !== expectedYearId) {
    invalid(`${label} must belong to the same year`);
  }
}

/** A general target has no id; subject/custom targets always have one. */
export function normalizeTargetReference(
  kind: TargetKind,
  referenceId: string | null | undefined,
  label = "Target",
): string | null {
  if (kind === "general") return null;
  if (!referenceId) {
    invalid(`${label} requires a ${kind} reference`);
  }
  return referenceId;
}

export interface SubjectParentRow {
  id: string;
  parentId: string | null;
}

/** Stable, cycle-safe traversal used by delete previews and actual deletes. */
export function collectDescendantIds(
  rows: readonly SubjectParentRow[],
  rootId: string,
): string[] {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentId) continue;
    const children = childrenOf.get(row.parentId);
    if (children) children.push(row.id);
    else childrenOf.set(row.parentId, [row.id]);
  }

  const descendants: string[] = [];
  const seen = new Set<string>([rootId]);
  const stack = [...(childrenOf.get(rootId) ?? [])];
  while (stack.length > 0) {
    const id = stack.pop() as string;
    if (seen.has(id)) continue;
    seen.add(id);
    descendants.push(id);
    stack.push(...(childrenOf.get(id) ?? []));
  }
  return descendants;
}
