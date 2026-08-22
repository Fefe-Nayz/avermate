import { z } from "zod";

export const toolActionContinuationSchema = z.strictObject({
  version: z.literal(1),
  actionId: z.string().min(1).max(256),
  userId: z.string().min(1).max(256),
  actorKind: z.enum(["embedded-agent", "mcp", "user-undo", "system"]),
  actorClientId: z.string().min(1).max(256).nullable(),
  scopes: z.array(z.string().min(1).max(256)).max(128),
  approvalMode: z.enum([
    "confirm-writes",
    "auto-reversible",
    "auto",
    "confirm",
  ]),
  threadId: z.string().min(1).max(256).nullable(),
  branchId: z.string().min(1).max(256).nullable(),
  runId: z.string().min(1).max(256).nullable(),
  toolCallId: z.string().min(1).max(256),
  toolId: z.string().min(1).max(256),
  toolVersion: z.number().int().positive(),
  idempotencyKey: z.string().min(1).max(256),
  argumentsHash: z.string().regex(/^[a-f0-9]{64}$/),
  previewHash: z.string().regex(/^[a-f0-9]{64}$/),
  expiresAt: z.iso.datetime({ offset: true }),
  input: z.unknown(),
});

export type ToolActionContinuation = z.infer<
  typeof toolActionContinuationSchema
>;

export interface ToolActionContinuationStore {
  stage(value: ToolActionContinuation): Promise<void>;
  load(userId: string, actionId: string): Promise<ToolActionContinuation | null>;
  discard(userId: string, actionId: string): Promise<void>;
}

export function canonicalToolContinuation(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalToolContinuation).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(
        ([key, child]) =>
          `${JSON.stringify(key)}:${canonicalToolContinuation(child)}`,
      )
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export class InMemoryToolActionContinuationStore
  implements ToolActionContinuationStore
{
  readonly values = new Map<string, ToolActionContinuation>();

  async stage(value: ToolActionContinuation): Promise<void> {
    const parsed = toolActionContinuationSchema.parse(value);
    const key = `${parsed.userId}:${parsed.actionId}`;
    const existing = this.values.get(key);
    if (
      existing &&
      canonicalToolContinuation(existing) !== canonicalToolContinuation(parsed)
    ) {
      throw new Error("Action continuation replay diverged");
    }
    this.values.set(key, structuredClone(parsed));
  }

  async load(userId: string, actionId: string) {
    const value = this.values.get(`${userId}:${actionId}`);
    return value ? structuredClone(value) : null;
  }

  async discard(userId: string, actionId: string) {
    this.values.delete(`${userId}:${actionId}`);
  }
}
