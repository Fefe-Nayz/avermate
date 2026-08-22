import { z } from "zod"

const boundedId = z.string().min(1).max(256)
const digest = z.string().regex(/^[a-f0-9]{64}$/)

export const customMcpAuthKindSchema = z.enum(["none", "bearer", "api-key"])
export type CustomMcpAuthKind = z.infer<typeof customMcpAuthKindSchema>

export const customMcpPlacementSchema = z.enum(["hosted-core", "node"])
export type CustomMcpPlacement = z.infer<typeof customMcpPlacementSchema>

export const customMcpDataCategorySchema = z.enum([
  "prompt",
  "academic-metadata",
  "retrieved-snippets",
  "attachment-metadata",
  "attachment-content",
])
export type CustomMcpDataCategory = z.infer<
  typeof customMcpDataCategorySchema
>

export const customMcpToolPreviewSchema = z.strictObject({
  remoteToolId: z
    .string()
    .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
  namespacedToolId: z.string().min(1).max(256),
  title: z.string().min(1).max(200),
  description: z.string().max(2_000),
  inputSchema: z.record(z.string(), z.unknown()),
  readOnlyHint: z.boolean(),
  destructiveHint: z.boolean(),
  openWorldHint: z.boolean(),
  enabled: z.boolean(),
  classification: z.enum(["unreviewed", "read-only", "blocked"]),
  allowedDataCategories: z.array(customMcpDataCategorySchema).max(5),
})
export type CustomMcpToolPreview = z.infer<
  typeof customMcpToolPreviewSchema
>

export const customMcpSourceSummarySchema = z.strictObject({
  id: boundedId,
  name: z.string().min(1).max(120),
  endpointUrl: z.url().max(2_048),
  endpointOrigin: z.url().max(512),
  placement: customMcpPlacementSchema,
  authKind: customMcpAuthKindSchema,
  credentialHint: z.string().max(8).nullable(),
  status: z.enum([
    "review-required",
    "enabled",
    "disabled",
    "unavailable",
  ]),
  catalogDigest: digest,
  catalogRevision: z.number().int().positive(),
  tools: z.array(customMcpToolPreviewSchema).max(500),
  lastCheckedAt: z.iso.datetime({ offset: true }),
  lastError: z.string().max(500).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
})
export type CustomMcpSourceSummary = z.infer<
  typeof customMcpSourceSummarySchema
>

export const customMcpInvocationResultSchema = z.strictObject({
  sourceId: boundedId,
  remoteToolId: boundedId,
  untrusted: z.literal(true),
  isError: z.boolean(),
  text: z.string().max(100_000),
})
export type CustomMcpInvocationResult = z.infer<
  typeof customMcpInvocationResultSchema
>
