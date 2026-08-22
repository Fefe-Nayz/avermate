import { and, eq, inArray } from "drizzle-orm"
import {
  customMcpInvocationResultSchema,
  customMcpSourceSummarySchema,
  customMcpToolPreviewSchema,
  customMcpDataCategorySchema,
  namespacedExternalToolId,
  type CustomMcpAuthKind,
  type CustomMcpDataCategory,
  type CustomMcpPlacement,
  type CustomMcpSourceSummary,
  type CustomMcpToolPreview,
} from "@avermate/agent-contracts"
import { db } from "../db"
import {
  assistantToolSourcePolicies,
  assistantToolSources,
} from "../db/schema"
import { open, seal } from "../lib/crypto"
import { canonicalJson, sha256 } from "../search/values"
import {
  assertProjectionSafe,
  redactForToolBoundary,
} from "../tools/budgets"
import {
  normalizeRemoteMcpEndpoint,
  SdkRemoteMcpClient,
  type RemoteMcpClient,
  type RemoteMcpConnection,
  type RemoteMcpTool,
} from "./remote-mcp-client"
import { relayNodeProviderTransport } from "../node/services"

type SourceRow = typeof assistantToolSources.$inferSelect
type PolicyRow = typeof assistantToolSourcePolicies.$inferSelect

export type ReviewCustomMcpTool = {
  remoteToolId: string
  classification: "read-only" | "blocked"
  enabled: boolean
  allowedDataCategories: readonly CustomMcpDataCategory[]
}

function safeError(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/(?:bearer\s+)?[A-Za-z0-9._~-]{32,}/gi, "[redacted]").slice(0, 500)
    : "The external MCP server is unavailable"
}

function toolCatalogDigest(tools: readonly RemoteMcpTool[]) {
  return sha256(canonicalJson({ protocolVersion: 1, tools }))
}

function parseCatalog(source: SourceRow): RemoteMcpTool[] {
  const parsed = JSON.parse(source.catalogJson) as unknown
  if (!Array.isArray(parsed)) throw new Error("Stored MCP catalogue is invalid")
  return parsed as RemoteMcpTool[]
}

function categories(value: string): CustomMcpDataCategory[] {
  const parsed = JSON.parse(value) as unknown
  return customMcpDataCategorySchema.array().max(5).parse(parsed)
}

function connection(source: SourceRow): RemoteMcpConnection {
  return {
    endpointUrl: source.endpointUrl,
    placement: source.placement,
    ownerId: source.userId,
    placementRef: source.placementRef,
    authKind: source.authKind,
    credential: source.sealedCredential ? open(source.sealedCredential) : null,
  }
}

function toolPreview(
  source: SourceRow,
  tool: RemoteMcpTool,
  policy: PolicyRow | undefined
): CustomMcpToolPreview {
  return customMcpToolPreviewSchema.parse({
    ...tool,
    namespacedToolId: namespacedExternalToolId(source.id, tool.remoteToolId),
    enabled: policy?.enabled === true,
    classification: policy?.classification ?? "unreviewed",
    allowedDataCategories: policy
      ? categories(policy.allowedDataCategoriesJson)
      : [],
  })
}

function sourceSummary(
  source: SourceRow,
  policies: readonly PolicyRow[]
): CustomMcpSourceSummary {
  const policyByTool = new Map(
    policies.map((policy) => [policy.remoteToolId, policy])
  )
  return customMcpSourceSummarySchema.parse({
    id: source.id,
    name: source.name,
    endpointUrl: source.endpointUrl,
    endpointOrigin: source.endpointOrigin,
    placement: source.placement,
    placementRef: source.placementRef,
    authKind: source.authKind,
    credentialHint: source.credentialHint,
    status: source.status,
    catalogDigest: source.catalogDigest,
    catalogRevision: source.catalogRevision,
    tools: parseCatalog(source).map((tool) =>
      toolPreview(source, tool, policyByTool.get(tool.remoteToolId))
    ),
    lastCheckedAt: source.lastCheckedAt.toISOString(),
    lastError: source.lastError,
    createdAt: source.createdAt.toISOString(),
    updatedAt: source.updatedAt.toISOString(),
  })
}

async function ownedSource(
  database: typeof db,
  ownerId: string,
  sourceId: string
) {
  const [source] = await database
    .select()
    .from(assistantToolSources)
    .where(
      and(
        eq(assistantToolSources.id, sourceId),
        eq(assistantToolSources.userId, ownerId)
      )
    )
    .limit(1)
  if (!source) throw new Error("The MCP connection was not found")
  return source
}

async function policiesForSources(
  database: typeof db,
  sourceIds: readonly string[]
) {
  if (!sourceIds.length) return []
  return database
    .select()
    .from(assistantToolSourcePolicies)
    .where(inArray(assistantToolSourcePolicies.sourceId, [...sourceIds]))
}

async function invalidateChangedCatalog(
  database: typeof db,
  ownerId: string,
  source: SourceRow,
  tools: readonly RemoteMcpTool[],
  now: Date
) {
  const digest = toolCatalogDigest(tools)
  if (digest === source.catalogDigest) {
    await database
      .update(assistantToolSources)
      .set({ lastCheckedAt: now, lastError: null, updatedAt: now })
      .where(
        and(
          eq(assistantToolSources.id, source.id),
          eq(assistantToolSources.userId, ownerId),
          eq(assistantToolSources.catalogDigest, source.catalogDigest)
        )
      )
    return false
  }

  await database.transaction(async (transaction) => {
    const changed = await transaction
      .update(assistantToolSources)
      .set({
        catalogJson: canonicalJson(tools),
        catalogDigest: digest,
        catalogRevision: source.catalogRevision + 1,
        status: "review-required",
        lastCheckedAt: now,
        lastError: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(assistantToolSources.id, source.id),
          eq(assistantToolSources.userId, ownerId),
          eq(assistantToolSources.catalogDigest, source.catalogDigest)
        )
      )
      .returning({ id: assistantToolSources.id })
    if (!changed.length) throw new Error("The MCP catalogue changed concurrently")
    await transaction
      .delete(assistantToolSourcePolicies)
      .where(eq(assistantToolSourcePolicies.sourceId, source.id))
    if (tools.length) {
      await transaction.insert(assistantToolSourcePolicies).values(
        tools.map((tool) => ({
          sourceId: source.id,
          remoteToolId: tool.remoteToolId,
          catalogDigest: digest,
          classification: "unreviewed" as const,
          enabled: false,
          allowedDataCategoriesJson: "[]",
          updatedAt: now,
        }))
      )
    }
  })
  return true
}

export class CustomMcpService {
  constructor(
    private readonly remote: RemoteMcpClient = new SdkRemoteMcpClient({
      nodeTransport: relayNodeProviderTransport,
    }),
    private readonly database: typeof db = db
  ) {}

  async list(ownerId: string) {
    const sources = await this.database
      .select()
      .from(assistantToolSources)
      .where(eq(assistantToolSources.userId, ownerId))
      .orderBy(assistantToolSources.createdAt, assistantToolSources.id)
    const policies = await policiesForSources(
      this.database,
      sources.map((source) => source.id)
    )
    const bySource = new Map<string, PolicyRow[]>()
    for (const policy of policies) {
      const current = bySource.get(policy.sourceId) ?? []
      current.push(policy)
      bySource.set(policy.sourceId, current)
    }
    return sources.map((source) =>
      sourceSummary(source, bySource.get(source.id) ?? [])
    )
  }

  async create(input: {
    ownerId: string
    name: string
    endpointUrl: string
    placement: CustomMcpPlacement
    nodeId?: string | null
    authKind: CustomMcpAuthKind
    credential?: string | null
    signal?: AbortSignal
  }) {
    const name = input.name.trim()
    if (!name || name.length > 120) throw new Error("A connection name is required")
    const endpoint = normalizeRemoteMcpEndpoint(
      input.endpointUrl,
      input.placement
    )
    const placementRef = input.nodeId?.trim() || null
    if ((input.placement === "node") !== (placementRef !== null)) {
      throw new Error(
        input.placement === "node"
          ? "A paired Node must be selected for a Node-hosted MCP connection"
          : "A hosted-Core MCP connection cannot be bound to a Node"
      )
    }
    const credential = input.credential?.trim() || null
    if ((input.authKind === "none") !== (credential === null)) {
      throw new Error(
        input.authKind === "none"
          ? "A credential cannot be stored for an unauthenticated MCP server"
          : "This MCP authentication mode requires a credential"
      )
    }
    const remoteConnection: RemoteMcpConnection = {
      endpointUrl: endpoint.href,
      placement: input.placement,
      ownerId: input.ownerId,
      placementRef,
      authKind: input.authKind,
      credential,
    }
    let tools: readonly RemoteMcpTool[]
    try {
      tools = await this.remote.inspect(remoteConnection, input.signal)
    } catch (error) {
      if (
        error instanceof Error &&
        /^NODE_MCP_[A-Z0-9_:-]+$/u.test(error.message)
      ) {
        throw error
      }
      throw new Error("The external MCP server could not be inspected")
    }
    const digest = toolCatalogDigest(tools)
    const now = new Date()
    const created = await this.database.transaction(async (transaction) => {
      const [source] = await transaction
        .insert(assistantToolSources)
        .values({
          userId: input.ownerId,
          name,
          endpointUrl: endpoint.href,
          endpointOrigin: endpoint.origin,
          placement: input.placement,
          placementRef,
          authKind: input.authKind,
          sealedCredential: credential ? seal(credential) : null,
          credentialHint: credential ? credential.slice(-4) : null,
          status: "review-required",
          catalogJson: canonicalJson(tools),
          catalogDigest: digest,
          catalogRevision: 1,
          lastCheckedAt: now,
          updatedAt: now,
        })
        .returning()
      if (!source) throw new Error("The MCP connection was not saved")
      if (tools.length) {
        await transaction.insert(assistantToolSourcePolicies).values(
          tools.map((tool) => ({
            sourceId: source.id,
            remoteToolId: tool.remoteToolId,
            catalogDigest: digest,
            classification: "unreviewed" as const,
            enabled: false,
            allowedDataCategoriesJson: "[]",
            updatedAt: now,
          }))
        )
      }
      return source
    })
    return sourceSummary(
      created,
      await policiesForSources(this.database, [created.id])
    )
  }

  async refresh(input: {
    ownerId: string
    sourceId: string
    signal?: AbortSignal
  }) {
    const source = await ownedSource(
      this.database,
      input.ownerId,
      input.sourceId
    )
    try {
      const tools = await this.remote.inspect(connection(source), input.signal)
      await invalidateChangedCatalog(
        this.database,
        input.ownerId,
        source,
        tools,
        new Date()
      )
    } catch (error) {
      const now = new Date()
      await this.database
        .update(assistantToolSources)
        .set({
          status: "unavailable",
          lastError: safeError(error),
          lastCheckedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(assistantToolSources.id, source.id),
            eq(assistantToolSources.userId, input.ownerId)
          )
        )
      if (
        error instanceof Error &&
        /^NODE_MCP_[A-Z0-9_:-]+$/u.test(error.message)
      ) {
        throw error
      }
      throw new Error("The external MCP server could not be inspected")
    }
    const current = await ownedSource(
      this.database,
      input.ownerId,
      input.sourceId
    )
    return sourceSummary(
      current,
      await policiesForSources(this.database, [current.id])
    )
  }

  async review(input: {
    ownerId: string
    sourceId: string
    expectedCatalogDigest: string
    tools: readonly ReviewCustomMcpTool[]
  }) {
    const source = await ownedSource(
      this.database,
      input.ownerId,
      input.sourceId
    )
    if (source.catalogDigest !== input.expectedCatalogDigest) {
      throw new Error("The MCP catalogue changed and must be reviewed again")
    }
    const catalog = parseCatalog(source)
    const catalogById = new Map(
      catalog.map((tool) => [tool.remoteToolId, tool] as const)
    )
    const reviewed = new Map<string, ReviewCustomMcpTool>()
    for (const decision of input.tools) {
      if (reviewed.has(decision.remoteToolId)) {
        throw new Error("A tool review was submitted more than once")
      }
      const tool = catalogById.get(decision.remoteToolId)
      if (!tool) throw new Error("The reviewed MCP tool is no longer present")
      const allowedDataCategories = [
        ...new Set(
          decision.allowedDataCategories.map((category) =>
            customMcpDataCategorySchema.parse(category)
          )
        ),
      ].sort()
      if (
        decision.enabled &&
        (decision.classification !== "read-only" ||
          !tool.readOnlyHint ||
          tool.destructiveHint ||
          allowedDataCategories.length === 0)
      ) {
        throw new Error(
          "Only explicitly annotated, non-destructive read tools with an egress allowlist can be enabled"
        )
      }
      reviewed.set(decision.remoteToolId, {
        ...decision,
        allowedDataCategories,
      })
    }
    const now = new Date()
    const enabled = [...reviewed.values()].some((decision) => decision.enabled)
    await this.database.transaction(async (transaction) => {
      const current = await transaction
        .select({ digest: assistantToolSources.catalogDigest })
        .from(assistantToolSources)
        .where(
          and(
            eq(assistantToolSources.id, source.id),
            eq(assistantToolSources.userId, input.ownerId)
          )
        )
        .limit(1)
      if (current[0]?.digest !== input.expectedCatalogDigest) {
        throw new Error("The MCP catalogue changed and must be reviewed again")
      }
      await transaction
        .delete(assistantToolSourcePolicies)
        .where(eq(assistantToolSourcePolicies.sourceId, source.id))
      if (catalog.length) {
        await transaction.insert(assistantToolSourcePolicies).values(
          catalog.map((tool) => {
            const decision = reviewed.get(tool.remoteToolId)
            return {
              sourceId: source.id,
              remoteToolId: tool.remoteToolId,
              catalogDigest: source.catalogDigest,
              classification: decision?.classification ?? "blocked",
              enabled: decision?.enabled ?? false,
              allowedDataCategoriesJson: canonicalJson(
                decision?.allowedDataCategories ?? []
              ),
              reviewedAt: now,
              updatedAt: now,
            }
          })
        )
      }
      await transaction
        .update(assistantToolSources)
        .set({
          status: enabled ? "enabled" : "disabled",
          lastError: null,
          updatedAt: now,
        })
        .where(
          and(
            eq(assistantToolSources.id, source.id),
            eq(assistantToolSources.userId, input.ownerId),
            eq(assistantToolSources.catalogDigest, input.expectedCatalogDigest)
          )
        )
    })
    const current = await ownedSource(
      this.database,
      input.ownerId,
      input.sourceId
    )
    return sourceSummary(
      current,
      await policiesForSources(this.database, [current.id])
    )
  }

  async remove(ownerId: string, sourceId: string) {
    const deleted = await this.database
      .delete(assistantToolSources)
      .where(
        and(
          eq(assistantToolSources.id, sourceId),
          eq(assistantToolSources.userId, ownerId)
        )
      )
      .returning({ id: assistantToolSources.id })
    if (!deleted.length) throw new Error("The MCP connection was not found")
    return { ok: true as const }
  }

  async enabledTools(ownerId: string) {
    return (await this.list(ownerId)).flatMap((source) =>
      source.status === "enabled"
        ? source.tools
            .filter(
              (tool) =>
                tool.enabled &&
                tool.classification === "read-only" &&
                tool.readOnlyHint &&
                !tool.destructiveHint
            )
            .map((tool) => ({ source, tool }))
        : []
    )
  }

  async invoke(input: {
    ownerId: string
    sourceId: string
    remoteToolId: string
    arguments: Record<string, unknown>
    requiredDataCategories: readonly CustomMcpDataCategory[]
    signal?: AbortSignal
  }) {
    const source = await ownedSource(
      this.database,
      input.ownerId,
      input.sourceId
    )
    if (source.status !== "enabled") {
      throw new Error("The MCP connection is not enabled")
    }
    const [policy] = await this.database
      .select()
      .from(assistantToolSourcePolicies)
      .where(
        and(
          eq(assistantToolSourcePolicies.sourceId, source.id),
          eq(assistantToolSourcePolicies.remoteToolId, input.remoteToolId)
        )
      )
      .limit(1)
    if (
      !policy?.enabled ||
      policy.classification !== "read-only" ||
      policy.catalogDigest !== source.catalogDigest
    ) {
      throw new Error("The MCP tool is not enabled for this catalogue")
    }
    const allowed = new Set(categories(policy.allowedDataCategoriesJson))
    const required = [
      ...new Set(
        input.requiredDataCategories.map((category) =>
          customMcpDataCategorySchema.parse(category)
        )
      ),
    ]
    if (required.some((category) => !allowed.has(category))) {
      throw new Error("The MCP tool is not approved for this data category")
    }

    const currentTools = await this.remote.inspect(connection(source), input.signal)
    if (
      await invalidateChangedCatalog(
        this.database,
        input.ownerId,
        source,
        currentTools,
        new Date()
      )
    ) {
      throw new Error("The MCP catalogue changed and must be reviewed again")
    }
    const current = currentTools.find(
      (tool) => tool.remoteToolId === input.remoteToolId
    )
    if (!current?.readOnlyHint || current.destructiveHint) {
      throw new Error("The MCP tool is no longer classified as read-only")
    }
    const result = await this.remote.invoke(connection(source), {
      remoteToolId: input.remoteToolId,
      arguments: input.arguments,
      signal: input.signal,
    })
    const redacted = redactForToolBoundary(result.text)
    let text = typeof redacted === "string" ? redacted : "[REDACTED]"
    try {
      assertProjectionSafe(text)
    } catch {
      text = "[External MCP result redacted by the Avermate data boundary.]"
    }
    return customMcpInvocationResultSchema.parse({
      sourceId: source.id,
      remoteToolId: input.remoteToolId,
      untrusted: true,
      isError: result.isError,
      text,
    })
  }
}

export const customMcpService = new CustomMcpService()
export { sourceSummary as projectCustomMcpSource, toolCatalogDigest }
