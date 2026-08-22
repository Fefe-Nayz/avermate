import { Client } from "@modelcontextprotocol/sdk/client"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type {
  CustomMcpAuthKind,
  CustomMcpPlacement,
} from "@avermate/agent-contracts"
import {
  safeModelFetchResponse,
  validateModelEndpoint,
  type BoundModelCredential,
  type ModelEndpointPolicy,
  type ModelTransport,
} from "../agent/model-endpoint-policy"
import { enforceBudget } from "../tools/budgets"

const catalogBudget = {
  maxBytes: 1024 * 1024,
  maxDepth: 32,
  maxItems: 10_000,
} as const

const resultBudget = {
  maxBytes: 1024 * 1024,
  maxDepth: 32,
  maxItems: 10_000,
} as const

export type RemoteMcpConnection = {
  endpointUrl: string
  placement: CustomMcpPlacement
  authKind: CustomMcpAuthKind
  credential: string | null
}

export type RemoteMcpTool = {
  remoteToolId: string
  title: string
  description: string
  inputSchema: Record<string, unknown>
  readOnlyHint: boolean
  destructiveHint: boolean
  openWorldHint: boolean
}

export type RemoteMcpCallResult = {
  isError: boolean
  text: string
}

export interface RemoteMcpClient {
  inspect(
    connection: RemoteMcpConnection,
    signal?: AbortSignal
  ): Promise<readonly RemoteMcpTool[]>
  invoke(
    connection: RemoteMcpConnection,
    input: {
      remoteToolId: string
      arguments: Record<string, unknown>
      signal?: AbortSignal
    }
  ): Promise<RemoteMcpCallResult>
}

export type SdkRemoteMcpClientOptions = {
  transport?: ModelTransport
}

function endpointPolicy(connection: RemoteMcpConnection): ModelEndpointPolicy {
  const endpoint = normalizeRemoteMcpEndpoint(
    connection.endpointUrl,
    connection.placement
  )
  return {
    placement: connection.placement,
    allowedOrigins: [endpoint.origin],
  }
}

function boundCredential(
  connection: RemoteMcpConnection
): BoundModelCredential | undefined {
  if (connection.authKind === "none") return undefined
  if (!connection.credential) {
    throw new Error("The MCP connection credential is unavailable")
  }
  const origin = new URL(connection.endpointUrl).origin
  return {
    origin,
    headerName:
      connection.authKind === "bearer" ? "Authorization" : "X-API-Key",
    value:
      connection.authKind === "bearer"
        ? `Bearer ${connection.credential}`
        : connection.credential,
  }
}

export function normalizeRemoteMcpEndpoint(
  input: string,
  placement: CustomMcpPlacement
): URL {
  let url: URL
  try {
    url = new URL(input.trim())
  } catch {
    throw new Error("The MCP server URL is invalid")
  }
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    !url.hostname
  ) {
    throw new Error(
      "The MCP server URL cannot contain credentials, a query, or a fragment"
    )
  }
  if (
    url.protocol !== "https:" &&
    !(placement === "node" && url.protocol === "http:")
  ) {
    throw new Error(
      placement === "hosted-core"
        ? "Hosted Avermate accepts only public HTTPS MCP servers"
        : "A custom node accepts only HTTP or HTTPS MCP servers"
    )
  }
  url.pathname = url.pathname.replace(/\/{2,}/g, "/") || "/"
  return url
}

function cleanTool(input: {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
  }
}): RemoteMcpTool {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(input.name)) {
    throw new Error("The MCP catalogue contains an invalid tool ID")
  }
  enforceBudget(input.inputSchema, catalogBudget)
  return {
    remoteToolId: input.name,
    title: (input.title || input.name).slice(0, 200),
    description: (input.description || "External MCP tool").slice(0, 2_000),
    inputSchema: structuredClone(input.inputSchema),
    readOnlyHint: input.annotations?.readOnlyHint === true,
    destructiveHint: input.annotations?.destructiveHint !== false,
    openWorldHint: input.annotations?.openWorldHint !== false,
  }
}

export function normalizeRemoteMcpCatalogue(
  tools: readonly Parameters<typeof cleanTool>[0][]
): readonly RemoteMcpTool[] {
  if (tools.length > 500) throw new Error("The MCP catalogue is too large")
  const ids = new Set<string>()
  const normalized = tools.map(cleanTool)
  for (const tool of normalized) {
    if (ids.has(tool.remoteToolId)) {
      throw new Error("The MCP catalogue contains duplicate tool IDs")
    }
    ids.add(tool.remoteToolId)
  }
  enforceBudget(normalized, catalogBudget)
  return normalized.sort((left, right) =>
    left.remoteToolId.localeCompare(right.remoteToolId)
  )
}

function textResult(result: Awaited<ReturnType<Client["callTool"]>>) {
  if (!("content" in result) || !Array.isArray(result.content)) {
    return {
      isError: true,
      text: "The external MCP server returned an unsupported task result.",
    }
  }
  const text = result.content
    .filter(
      (part): part is Extract<(typeof result.content)[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n\n")
    .slice(0, 100_000)
  const output = {
    isError: result.isError === true,
    text: text || "The external MCP tool returned no text output.",
  }
  enforceBudget(output, resultBudget)
  return output
}

/**
 * MCP SDK client whose every HTTP hop is re-resolved, pinned, origin-bound and
 * byte/time bounded by Avermate's outbound endpoint policy.
 */
export class SdkRemoteMcpClient implements RemoteMcpClient {
  constructor(private readonly options: SdkRemoteMcpClientOptions = {}) {}

  private async withClient<T>(
    connection: RemoteMcpConnection,
    signal: AbortSignal | undefined,
    operation: (client: Client) => Promise<T>
  ): Promise<T> {
    if (connection.placement === "node") {
      throw new Error(
        "Node-hosted MCP requires the paired Avermate Node transport and is unavailable on hosted Core"
      )
    }
    const endpoint = normalizeRemoteMcpEndpoint(
      connection.endpointUrl,
      connection.placement
    )
    const policy = endpointPolicy(connection)
    // Probe once before constructing the SDK transport so malformed/private
    // destinations fail before any credential can be attached.
    await validateModelEndpoint(endpoint, policy)
    const credential = boundCredential(connection)
    const safeFetch = (url: string | URL, init?: RequestInit) =>
      safeModelFetchResponse(url, {
        policy,
        credential,
        signal: signal ?? init?.signal ?? undefined,
        method: init?.method,
        headers: init?.headers,
        body: init?.body,
        maxRedirects: 2,
        maxResponseBytes: 1024 * 1024,
        connectTimeoutMs: 5_000,
        readTimeoutMs: 10_000,
        totalTimeoutMs: 30_000,
        transport: this.options.transport,
      })
    const transport = new StreamableHTTPClientTransport(endpoint, {
      fetch: safeFetch,
      reconnectionOptions: {
        initialReconnectionDelay: 250,
        maxReconnectionDelay: 1_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0,
      },
    })
    const client = new Client(
      { name: "avermate-custom-mcp", version: "1.0.0" },
      { capabilities: {} }
    )
    try {
      await client.connect(transport, { signal, timeout: 15_000 })
      return await operation(client)
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  inspect(connection: RemoteMcpConnection, signal?: AbortSignal) {
    return this.withClient(connection, signal, async (client) => {
      const tools: Array<
        Parameters<typeof normalizeRemoteMcpCatalogue>[0][number]
      > = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page += 1) {
        const result = await client.listTools(
          cursor ? { cursor } : undefined,
          { signal, timeout: 15_000 }
        )
        tools.push(...result.tools)
        if (tools.length > 500) throw new Error("The MCP catalogue is too large")
        cursor = result.nextCursor
        if (!cursor) break
      }
      if (cursor) throw new Error("The MCP catalogue has too many pages")
      return normalizeRemoteMcpCatalogue(tools)
    })
  }

  invoke(
    connection: RemoteMcpConnection,
    input: {
      remoteToolId: string
      arguments: Record<string, unknown>
      signal?: AbortSignal
    }
  ) {
    enforceBudget(input.arguments, {
      maxBytes: 16 * 1024,
      maxDepth: 16,
      maxItems: 1_000,
    })
    return this.withClient(connection, input.signal, async (client) =>
      textResult(
        await client.callTool(
          { name: input.remoteToolId, arguments: input.arguments },
          undefined,
          { signal: input.signal, timeout: 30_000, maxTotalTimeout: 30_000 }
        )
      )
    )
  }
}
