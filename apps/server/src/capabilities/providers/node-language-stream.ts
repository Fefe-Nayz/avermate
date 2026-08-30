import {
  capabilityUsageSchema,
  type ModelGatewayEvent,
  type NodeCapabilityEventV1,
} from "@avermate/agent-contracts";
import { z } from "zod";

const identifier = z.string().min(1).max(512);
const text = z.string().max(256 * 1_024);
const chunkSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("content-delta"), delta: text }),
  z.strictObject({
    type: z.literal("tool-call-start"),
    callId: identifier,
    toolName: identifier,
  }),
  z.strictObject({
    type: z.literal("tool-arguments-delta"),
    callId: identifier,
    delta: text,
  }),
  z.strictObject({ type: z.literal("tool-call-end"), callId: identifier }),
  z.strictObject({
    type: z.literal("reasoning-summary"),
    summary: text,
    providerAuthorized: z.literal(true),
  }),
  z.strictObject({
    type: z.literal("opaque-reasoning-state"),
    continuationRef: identifier,
  }),
]);
const completionSchema = z.strictObject({
  finishReason: z.enum([
    "stop",
    "tool-calls",
    "length",
    "content-filter",
    "unknown",
  ]),
});

/** The Node wire protocol is not the application's ModelGateway event protocol. */
export function nodeLanguageEvent(
  event: NodeCapabilityEventV1,
): ModelGatewayEvent | null {
  switch (event.type) {
    case "acknowledged":
      return null;
    case "chunk":
      return chunkSchema.parse(event.payload);
    case "completed":
      return {
        type: "finish",
        reason: completionSchema.parse(event.payload).finishReason,
      };
    case "usage": {
      const usage = capabilityUsageSchema.parse(event.payload);
      const quantity = (unit: string) => {
        const items = usage.items.filter((item) => item.unit === unit);
        if (items.length !== 1) return "unknown" as const;
        const value = Number(items[0]!.quantity);
        return Number.isSafeInteger(value) && value >= 0
          ? value
          : ("unknown" as const);
      };
      return {
        type: "usage",
        usage: {
          inputTokens: quantity("input-token"),
          outputTokens: quantity("output-token"),
          reasoningTokens: quantity("reasoning-token"),
          cachedReadTokens: quantity("cached-input-token"),
          cachedWriteTokens: "unknown",
        },
      };
    }
  }
}
