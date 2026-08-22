import { z } from "zod"
import {
  customMcpInvocationResultSchema,
  type AnyAvermateToolDescriptor,
  type CustomMcpDataCategory,
} from "@avermate/agent-contracts"
import { db } from "../db"
import { redactForToolBoundary } from "../tools/budgets"
import { customMcpService } from "./custom-mcp-service"

function boundedNumber(value: unknown, fallback: number, ceiling: number) {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(ceiling, Math.floor(value)))
    : fallback
}

/** Convert only structural JSON-Schema data; discard remote prose/prompt text. */
export function externalJsonSchemaToZod(
  schema: unknown,
  depth = 0
): z.ZodType {
  if (depth > 8 || !schema || typeof schema !== "object" || Array.isArray(schema)) {
    return z.unknown()
  }
  const value = schema as Record<string, unknown>
  if (Array.isArray(value.enum) && value.enum.length > 0 && value.enum.length <= 100) {
    const literals = value.enum
      .filter(
        (entry): entry is string | number | boolean | null =>
          entry === null || ["string", "number", "boolean"].includes(typeof entry)
      )
      .map((entry) => z.literal(entry))
    if (literals.length === 1) return literals[0]!
    if (literals.length > 1) {
      return z.union(
        literals as [z.ZodLiteral, z.ZodLiteral, ...z.ZodLiteral[]]
      )
    }
  }
  if ("const" in value) {
    const constant = value.const
    if (
      constant === null ||
      typeof constant === "string" ||
      typeof constant === "number" ||
      typeof constant === "boolean"
    ) {
      return z.literal(constant)
    }
  }
  switch (value.type) {
    case "string": {
      let result = z.string()
      const minimum = boundedNumber(value.minLength, 0, 100_000)
      const maximum = boundedNumber(value.maxLength, 100_000, 100_000)
      if (minimum) result = result.min(minimum)
      result = result.max(Math.max(minimum, maximum))
      return result
    }
    case "integer":
      return z.number().int()
    case "number":
      return z.number()
    case "boolean":
      return z.boolean()
    case "array":
      return z
        .array(externalJsonSchemaToZod(value.items, depth + 1))
        .max(boundedNumber(value.maxItems, 100, 1_000))
    case "object":
    default: {
      if (value.type !== "object" && !value.properties) return z.unknown()
      const properties =
        value.properties &&
        typeof value.properties === "object" &&
        !Array.isArray(value.properties)
          ? Object.entries(value.properties as Record<string, unknown>).slice(
              0,
              100
            )
          : []
      const required = new Set(
        Array.isArray(value.required)
          ? value.required.filter(
              (entry): entry is string => typeof entry === "string"
            )
          : []
      )
      const shape: Record<string, z.ZodType> = {}
      for (const [key, property] of properties) {
        if (!key || key.length > 128) continue
        const parsed = externalJsonSchemaToZod(property, depth + 1)
        shape[key] = required.has(key) ? parsed : parsed.optional()
      }
      return value.additionalProperties === false
        ? z.strictObject(shape)
        : z.looseObject(shape)
    }
  }
}

async function requiredEgressCategories(
  ownerId: string,
  runId: string | null
): Promise<CustomMcpDataCategory[]> {
  const required = new Set<CustomMcpDataCategory>(["prompt"])
  if (!runId) return [...required]
  const run = await db.$client.execute({
    sql: `SELECT runs.inputMessageId, manifests.itemsJson
      FROM assistant_runs AS runs
      LEFT JOIN assistant_context_manifests AS manifests
        ON manifests.id = runs.contextManifestId AND manifests.runId = runs.id
      WHERE runs.id = ? AND runs.userId = ? LIMIT 1`,
    args: [runId, ownerId],
  })
  const row = run.rows[0]
  if (!row) throw new Error("The assistant run is unavailable")
  const attachments = await db.$client.execute({
    sql: `SELECT 1 FROM assistant_attachments
      WHERE messageId = ? LIMIT 1`,
    args: [row.inputMessageId],
  })
  const hasAttachments = attachments.rows.length > 0
  if (hasAttachments) required.add("attachment-metadata")
  const items =
    typeof row.itemsJson === "string"
      ? (JSON.parse(row.itemsJson) as unknown[])
      : Array.isArray(row.itemsJson)
        ? row.itemsJson
        : []
  let retrieved = false
  for (const item of items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue
    const record = item as Record<string, unknown>
    if (record.trust === "retrieved-untrusted") {
      retrieved = true
      required.add("retrieved-snippets")
    }
    if (
      record.trust === "tool-result" ||
      record.kind === "application/vnd.avermate.reference+json"
    ) {
      required.add("academic-metadata")
    }
  }
  if (hasAttachments && retrieved) required.add("attachment-content")
  return [...required].sort()
}

export async function createCustomMcpDescriptors(
  ownerId: string
): Promise<AnyAvermateToolDescriptor[]> {
  const enabled = await customMcpService.enabledTools(ownerId)
  return enabled.map(({ source, tool }) => {
    const inputSchema = externalJsonSchemaToZod(tool.inputSchema)
    const projection = {
      schema: customMcpInvocationResultSchema,
      budget: { maxBytes: 128 * 1024, maxDepth: 16, maxItems: 1_000 },
      project: (output: z.infer<typeof customMcpInvocationResultSchema>) =>
        output,
    }
    return {
      id: tool.namespacedToolId,
      version: 1,
      title: "External read tool",
      description:
        "Calls one explicitly reviewed read-only tool on a user-configured MCP server. Arguments and returned text leave Avermate and are treated as untrusted data.",
      inputSchema,
      outputSchema: customMcpInvocationResultSchema,
      requiredScopes: ["avermate:read"],
      effect: "read",
      risk: "high",
      approval: "never",
      idempotency: "none",
      preview: "none",
      compensation: "none",
      crashRecovery: "inspect-required",
      inputBudget: { maxBytes: 16 * 1024, maxDepth: 16, maxItems: 1_000 },
      resultBudget: { maxBytes: 128 * 1024, maxDepth: 16, maxItems: 1_000 },
      redact: redactForToolBoundary,
      execute: async (context, input) =>
        customMcpService.invoke({
          ownerId: context.principal.userId,
          sourceId: source.id,
          remoteToolId: tool.remoteToolId,
          arguments: input as Record<string, unknown>,
          requiredDataCategories: await requiredEgressCategories(
            context.principal.userId,
            context.runId
          ),
          signal: context.signal,
        }),
      resultProjections: {
        model: projection,
        ui: projection,
        audit: projection,
      },
    } as AnyAvermateToolDescriptor
  })
}
