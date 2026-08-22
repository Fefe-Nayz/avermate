import { z } from "zod";
import { toolBudgetSchema, toolRiskSchema } from "./tool";
import type { ToolBudget, ToolExecutionContext, ToolRisk } from "./tool";

export const toolSourceTrustSchema = z.enum([
  "first-party",
  "user-configured",
  "node",
]);
export type ToolSourceTrust = z.infer<typeof toolSourceTrustSchema>;

export const toolSourceRequestSchema = z.strictObject({
  method: z.enum(["list", "invoke"]),
  operation: z.string().min(1).max(256),
  body: z.instanceof(Uint8Array),
  headers: z
    .record(z.string().min(1).max(128), z.string().max(4_096))
    .default({}),
});
export type ToolSourceRequest = z.infer<typeof toolSourceRequestSchema>;

export const externalToolCallSchema = z.strictObject({
  remoteToolId: z.string().min(1).max(256),
  arguments: z.unknown(),
  capabilitySnapshot: z.string().regex(/^[a-f0-9]{64}$/),
});
export type ExternalToolCall = z.infer<typeof externalToolCallSchema>;

export const externalToolDescriptorSchema = z.strictObject({
  id: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
  version: z.number().int().positive(),
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(2_000),
  advertisedRisk: toolRiskSchema,
});
export type ExternalToolDescriptor = z.infer<
  typeof externalToolDescriptorSchema
>;

export const externalToolCatalogSchema = z.strictObject({
  protocolVersion: z.literal(1),
  tools: z.array(externalToolDescriptorSchema).max(500),
});
export type ExternalToolCatalog = z.infer<typeof externalToolCatalogSchema>;

export interface ToolCatalogContext {
  principal: { userId: string; clientId: string };
  signal: AbortSignal;
}

export interface ToolSource {
  sourceId: string;
  trust: ToolSourceTrust;
  listRequest(context: ToolCatalogContext): ToolSourceRequest;
  invokeRequest(
    context: ToolExecutionContext,
    call: ExternalToolCall,
  ): ToolSourceRequest;
}

export const toolSourceTransportLimitsSchema = toolBudgetSchema.extend({
  connectDeadlineMs: z.number().int().positive().max(120_000),
  totalDeadlineMs: z.number().int().positive().max(600_000),
});
export type ToolSourceTransportLimits = z.infer<
  typeof toolSourceTransportLimitsSchema
>;

export interface ToolSourceResponse {
  declaredBytes?: number;
  contentType: string;
  body: AsyncIterable<Uint8Array>;
}

export interface ToolSourceTransport {
  exchange(
    source: ToolSource,
    request: ToolSourceRequest,
    limits: ToolSourceTransportLimits,
    signal: AbortSignal,
  ): Promise<ToolSourceResponse>;
}

const riskOrder: Record<ToolRisk, number> = {
  low: 0,
  medium: 1,
  high: 2,
  irreversible: 3,
};

export function federatedRiskFloor(trust: ToolSourceTrust): ToolRisk {
  return trust === "first-party" ? "medium" : "high";
}

export function enforceFederatedRiskFloor(
  advertised: ToolRisk,
  trust: ToolSourceTrust,
): ToolRisk {
  const floor = federatedRiskFloor(trust);
  return riskOrder[advertised] >= riskOrder[floor] ? advertised : floor;
}

export function namespacedExternalToolId(
  sourceId: string,
  remoteToolId: string,
): string {
  const source = sourceId.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  const remote = remoteToolId.toLowerCase().replace(/[^a-z0-9._-]/g, "-");
  if (!source || !remote) throw new Error("External tool IDs cannot be empty");
  return `external.${source}.${remote}`;
}

export const defaultFederatedBudget = {
  maxBytes: 1024 * 1024,
  maxDepth: 32,
  maxItems: 10_000,
} as const satisfies ToolBudget;
