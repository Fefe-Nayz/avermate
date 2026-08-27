import { z } from "zod";
import type { ContextBlock } from "./context";

export const tokenCountSchema = z.union([
  z.number().int().nonnegative(),
  z.literal("unknown"),
]);
export type TokenCount = z.infer<typeof tokenCountSchema>;

export const normalizedUsageSchema = z.strictObject({
  inputTokens: tokenCountSchema,
  outputTokens: tokenCountSchema,
  reasoningTokens: tokenCountSchema,
  cachedReadTokens: tokenCountSchema,
  cachedWriteTokens: tokenCountSchema,
});
export type NormalizedUsage = z.infer<typeof normalizedUsageSchema>;

export const NORMALIZED_USAGE_VERSION = 1 as const;

/** Durable provider-neutral accounting attached to one immutable run. */
export const normalizedUsageSnapshotSchema = z.strictObject({
  version: z.literal(NORMALIZED_USAGE_VERSION),
  ownerId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256),
  providerKey: z.string().min(1).max(256),
  providerRevision: z.string().min(1).max(256),
  modelKey: z.string().min(1).max(256),
  modelRevision: z.string().min(1).max(256),
  source: z.enum(["provider", "estimated", "unknown"]),
  usage: normalizedUsageSchema,
  final: z.boolean(),
  observedAt: z.iso.datetime({ offset: true }),
});
export type NormalizedUsageSnapshot = z.infer<
  typeof normalizedUsageSnapshotSchema
>;

export const modelDescriptorSchema = z.strictObject({
  id: z.string().min(1).max(256),
  provider: z.string().min(1).max(128),
  displayName: z.string().min(1).max(256),
  modalities: z.array(
    z.enum(["text", "image", "file", "audio", "video", "embedding"]),
  ),
  capabilities: z.strictObject({
    tools: z.boolean(),
    reasoningSummary: z.boolean(),
    cachedUsage: z.boolean(),
    structuredOutput: z.boolean(),
  }),
  contextWindow: z.number().int().positive().or(z.literal("unknown")),
});
export type ModelDescriptor = z.infer<typeof modelDescriptorSchema>;

export const modelAccessContextSchema = z.strictObject({
  ownerId: z.string().min(1).max(256),
  placement: z.enum(["core", "managed", "node", "full-self-host"]),
  allowedOrigins: z.array(z.url()).max(100),
});
export type ModelAccessContext = z.infer<typeof modelAccessContextSchema>;

export type ModelRequest = {
  ownerId: string;
  runId: string;
  /** Stable provider key when the selected adapter explicitly supports it. */
  requestKey?: string;
  modelId: string;
  messages: readonly ContextBlock[];
  tools: readonly {
    name: string;
    description: string;
    inputSchema: unknown;
  }[];
  /** Frozen run policy output fence propagated to the exact provider call. */
  maximumOutputTokens?: number;
  abortSignal?: AbortSignal;
};

export type ModelGatewayEvent =
  | { type: "content-delta"; delta: string }
  | { type: "tool-call-start"; callId: string; toolName: string }
  | { type: "tool-arguments-delta"; callId: string; delta: string }
  | { type: "tool-call-end"; callId: string }
  | {
      type: "reasoning-summary";
      summary: string;
      providerAuthorized: true;
    }
  | { type: "opaque-reasoning-state"; continuationRef: string }
  | { type: "usage"; usage: NormalizedUsage }
  | {
      type: "finish";
      reason: "stop" | "tool-calls" | "length" | "content-filter" | "unknown";
    }
  | { type: "error"; code: string; retryable: boolean };

export type EmbedRequest = {
  ownerId: string;
  /** Required by managed placement to deduplicate provider retries. */
  operationId?: string;
  modelId: string;
  inputs: readonly string[];
  abortSignal?: AbortSignal;
};
export type EmbedResult = {
  vectors: readonly (readonly number[])[];
  usage: NormalizedUsage;
};

export type TranscriptionRequest = {
  ownerId: string;
  /** Required by managed placement to deduplicate provider retries. */
  operationId?: string;
  /** Conservative source-duration bound required before managed dispatch. */
  maximumSeconds?: number;
  modelId: string;
  media: Blob;
  language?: string;
  abortSignal?: AbortSignal;
};
export type TranscriptionResult = {
  text: string;
  language: string | "unknown";
  durationSeconds: number | "unknown";
  usage: NormalizedUsage;
};

export type UsageEstimate = {
  usage: NormalizedUsage;
  estimatedCostMinor: number | "unknown";
  currency: string | "unknown";
};

export interface ModelGateway {
  listModels(context: ModelAccessContext): Promise<ModelDescriptor[]>;
  stream(request: ModelRequest): AsyncIterable<ModelGatewayEvent>;
  embed(request: EmbedRequest): Promise<EmbedResult>;
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>;
  estimate(request: ModelRequest): Promise<UsageEstimate>;
}
