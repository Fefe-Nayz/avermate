import { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import {
  nodeMcpInspectRequestSchema,
  nodeMcpInspectResultSchema,
  nodeMcpInvokeRequestSchema,
  nodeMcpInvokeResultSchema,
  nodeMcpRemoteToolSchema,
  type NodeMcpConnection,
  type NodeMcpRemoteTool,
} from "@avermate/agent-contracts"

type FetchLike = (
  input: RequestInfo | URL,
  init?: RequestInit
) => Promise<Response>

export type LocalNodeMcpTransportOptions = {
  allowedEndpoints: readonly string[]
  maxCatalogueTools: number
  maxRequestBytes: number
  maxResponseBytes: number
  connectTimeoutMs: number
  operationTimeoutMs: number
  fetch?: FetchLike
}

const allowedRequestHeaders = new Set([
  "accept",
  "content-type",
  "last-event-id",
  "mcp-protocol-version",
  "mcp-session-id",
])

function endpoint(input: string) {
  let url: URL
  try {
    url = new URL(input)
  } catch {
    throw new Error("NODE_MCP_ENDPOINT_INVALID")
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error("NODE_MCP_ENDPOINT_INVALID")
  }
  url.pathname = url.pathname.replace(/\/{2,}/gu, "/") || "/"
  return url
}

function jsonBytes(value: unknown) {
  const encoded = JSON.stringify(value)
  if (encoded === undefined) throw new Error("NODE_MCP_VALUE_INVALID")
  return new TextEncoder().encode(encoded).byteLength
}

function enforceValueBudget(
  value: unknown,
  budget: { maxBytes: number; maxDepth: number; maxItems: number }
) {
  if (jsonBytes(value) > budget.maxBytes) {
    throw new Error("NODE_MCP_VALUE_TOO_LARGE")
  }
  const stack: Array<{ value: unknown; depth: number }> = [
    { value, depth: 0 },
  ]
  const seen = new Set<object>()
  let items = 0
  while (stack.length) {
    const current = stack.pop()!
    if (current.depth > budget.maxDepth) {
      throw new Error("NODE_MCP_VALUE_TOO_DEEP")
    }
    if (!current.value || typeof current.value !== "object") continue
    if (seen.has(current.value)) throw new Error("NODE_MCP_VALUE_INVALID")
    seen.add(current.value)
    const children = Array.isArray(current.value)
      ? current.value
      : Object.values(current.value as Record<string, unknown>)
    items += children.length
    if (items > budget.maxItems) throw new Error("NODE_MCP_VALUE_TOO_LARGE")
    for (const child of children) {
      stack.push({ value: child, depth: current.depth + 1 })
    }
  }
}

function requestBodyBytes(body: BodyInit | null | undefined) {
  if (body == null) return 0
  if (typeof body === "string") return new TextEncoder().encode(body).byteLength
  if (body instanceof Uint8Array) return body.byteLength
  if (body instanceof ArrayBuffer) return body.byteLength
  if (ArrayBuffer.isView(body)) return body.byteLength
  throw new Error("NODE_MCP_REQUEST_BODY_DENIED")
}

function boundedResponse(
  response: Response,
  input: {
    maxBytes: number
    abort: AbortController
    finish(): void
  }
) {
  const declared = Number(response.headers.get("content-length"))
  if (Number.isFinite(declared) && declared > input.maxBytes) {
    input.abort.abort("response-limit")
    input.finish()
    throw new Error("NODE_MCP_RESPONSE_TOO_LARGE")
  }
  const headers = new Headers()
  let count = 0
  for (const [name, value] of response.headers) {
    if (name.toLowerCase() === "set-cookie") continue
    count += 1
    if (count > 64 || name.length > 128 || value.length > 8_192) {
      input.abort.abort("response-headers")
      input.finish()
      throw new Error("NODE_MCP_RESPONSE_HEADERS_INVALID")
    }
    headers.set(name, value)
  }
  if (!response.body) {
    input.finish()
    return new Response(null, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
  const reader = response.body.getReader()
  let observed = 0
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read()
        if (next.done) {
          input.finish()
          controller.close()
          return
        }
        observed += next.value.byteLength
        if (observed > input.maxBytes) {
          input.abort.abort("response-limit")
          await reader.cancel().catch(() => undefined)
          input.finish()
          controller.error(new Error("NODE_MCP_RESPONSE_TOO_LARGE"))
          return
        }
        controller.enqueue(next.value)
      } catch (error) {
        input.finish()
        controller.error(error)
      }
    },
    async cancel(reason) {
      input.abort.abort(reason)
      await reader.cancel(reason).catch(() => undefined)
      input.finish()
    },
  })
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function normalizeTool(input: {
  name: string
  title?: string
  description?: string
  inputSchema: Record<string, unknown>
  annotations?: {
    readOnlyHint?: boolean
    destructiveHint?: boolean
    openWorldHint?: boolean
  }
}): NodeMcpRemoteTool {
  enforceValueBudget(input.inputSchema, {
    maxBytes: 1024 * 1024,
    maxDepth: 32,
    maxItems: 10_000,
  })
  return nodeMcpRemoteToolSchema.parse({
    remoteToolId: input.name,
    title: (input.title || input.name).slice(0, 200),
    description: (input.description || "External MCP tool").slice(0, 2_000),
    inputSchema: structuredClone(input.inputSchema),
    readOnlyHint: input.annotations?.readOnlyHint === true,
    destructiveHint: input.annotations?.destructiveHint !== false,
    openWorldHint: input.annotations?.openWorldHint !== false,
  })
}

function toolText(result: Awaited<ReturnType<Client["callTool"]>>) {
  if (!("content" in result) || !Array.isArray(result.content)) {
    return nodeMcpInvokeResultSchema.parse({
      isError: true,
      text: "The external MCP server returned an unsupported task result.",
    })
  }
  const text = result.content
    .filter(
      (part): part is Extract<(typeof result.content)[number], { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n\n")
    .slice(0, 100_000)
  return nodeMcpInvokeResultSchema.parse({
    isError: result.isError === true,
    text: text || "The external MCP tool returned no text output.",
  })
}

/**
 * Purpose-built Streamable HTTP MCP transport. It can only perform MCP
 * inspect/invoke against an endpoint present in the Node's reviewed config.
 */
export class LocalNodeMcpTransport {
  readonly #allowedEndpoints: ReadonlySet<string>
  readonly #options: LocalNodeMcpTransportOptions
  readonly #fetch: FetchLike

  constructor(options: LocalNodeMcpTransportOptions) {
    this.#options = options
    this.#allowedEndpoints = new Set(
      options.allowedEndpoints.map((candidate) => endpoint(candidate).href)
    )
    this.#fetch = options.fetch ?? fetch
  }

  #approvedEndpoint(input: string) {
    const candidate = endpoint(input)
    if (!this.#allowedEndpoints.has(candidate.href)) {
      throw new Error("NODE_MCP_ENDPOINT_NOT_APPROVED")
    }
    return candidate
  }

  #safeFetch(connection: NodeMcpConnection, outerSignal?: AbortSignal): FetchLike {
    const approved = this.#approvedEndpoint(connection.endpointUrl)
    return async (rawUrl, init = {}) => {
      const target = endpoint(
        rawUrl instanceof Request ? rawUrl.url : rawUrl.toString()
      )
      if (target.href !== approved.href) {
        throw new Error("NODE_MCP_ENDPOINT_CHANGED")
      }
      const method = (init.method ?? "GET").toUpperCase()
      if (!new Set(["GET", "POST", "DELETE"]).has(method)) {
        throw new Error("NODE_MCP_METHOD_DENIED")
      }
      if (requestBodyBytes(init.body) > this.#options.maxRequestBytes) {
        throw new Error("NODE_MCP_REQUEST_TOO_LARGE")
      }
      const headers = new Headers()
      for (const [name, value] of new Headers(init.headers)) {
        const normalized = name.toLowerCase()
        if (!allowedRequestHeaders.has(normalized)) {
          throw new Error("NODE_MCP_REQUEST_HEADER_DENIED")
        }
        if (name.length > 128 || value.length > 8_192) {
          throw new Error("NODE_MCP_REQUEST_HEADER_INVALID")
        }
        headers.set(normalized, value)
      }
      if (connection.authKind === "bearer") {
        headers.set("authorization", `Bearer ${connection.credential}`)
      } else if (connection.authKind === "api-key") {
        headers.set("x-api-key", connection.credential!)
      }
      const abort = new AbortController()
      const abortFromCaller = () => abort.abort("caller")
      const sourceSignal = outerSignal ?? init.signal ?? undefined
      if (sourceSignal?.aborted) abortFromCaller()
      else sourceSignal?.addEventListener("abort", abortFromCaller, { once: true })
      const timer = setTimeout(
        () => abort.abort("timeout"),
        this.#options.operationTimeoutMs
      )
      const finish = () => {
        clearTimeout(timer)
        sourceSignal?.removeEventListener("abort", abortFromCaller)
      }
      try {
        const response = await this.#fetch(target, {
          method,
          headers,
          body: init.body,
          redirect: "manual",
          signal: abort.signal,
        })
        if (response.status >= 300 && response.status < 400) {
          abort.abort("redirect")
          finish()
          throw new Error("NODE_MCP_REDIRECT_DENIED")
        }
        return boundedResponse(response, {
          maxBytes: this.#options.maxResponseBytes,
          abort,
          finish,
        })
      } catch (error) {
        finish()
        if (outerSignal?.aborted) throw new Error("NODE_OPERATION_CANCELLED")
        if (abort.signal.reason === "timeout") {
          throw new Error("NODE_MCP_TIMEOUT")
        }
        throw error
      }
    }
  }

  async #withClient<T>(
    connection: NodeMcpConnection,
    signal: AbortSignal | undefined,
    operation: (client: Client) => Promise<T>
  ) {
    const approved = this.#approvedEndpoint(connection.endpointUrl)
    const transport = new StreamableHTTPClientTransport(approved, {
      fetch: this.#safeFetch(connection, signal),
      reconnectionOptions: {
        initialReconnectionDelay: 250,
        maxReconnectionDelay: 1_000,
        reconnectionDelayGrowFactor: 1.5,
        maxRetries: 0,
      },
    })
    const client = new Client(
      { name: "avermate-node-custom-mcp", version: "1.0.0" },
      { capabilities: {} }
    )
    try {
      await client.connect(transport, {
        signal,
        timeout: this.#options.connectTimeoutMs,
      })
      return await operation(client)
    } catch (error) {
      if (signal?.aborted) throw new Error("NODE_OPERATION_CANCELLED")
      throw error
    } finally {
      await client.close().catch(() => undefined)
    }
  }

  async inspect(input: {
    ownerId: string
    request: unknown
    signal?: AbortSignal
  }) {
    if (!input.ownerId) throw new Error("NODE_OPERATION_OWNER_MISMATCH")
    const request = nodeMcpInspectRequestSchema.parse(input.request)
    return this.#withClient(request.connection, input.signal, async (client) => {
      const tools: NodeMcpRemoteTool[] = []
      let cursor: string | undefined
      for (let page = 0; page < 10; page += 1) {
        const result = await client.listTools(
          cursor ? { cursor } : undefined,
          { signal: input.signal, timeout: this.#options.operationTimeoutMs }
        )
        tools.push(...result.tools.map(normalizeTool))
        if (tools.length > this.#options.maxCatalogueTools) {
          throw new Error("NODE_MCP_CATALOGUE_TOO_LARGE")
        }
        cursor = result.nextCursor
        if (!cursor) break
      }
      if (cursor) throw new Error("NODE_MCP_CATALOGUE_TOO_LARGE")
      tools.sort((left, right) => left.remoteToolId.localeCompare(right.remoteToolId))
      enforceValueBudget(tools, {
        maxBytes: this.#options.maxResponseBytes,
        maxDepth: 32,
        maxItems: 10_000,
      })
      return nodeMcpInspectResultSchema.parse({ tools })
    })
  }

  async invoke(input: {
    ownerId: string
    request: unknown
    signal?: AbortSignal
  }) {
    if (!input.ownerId) throw new Error("NODE_OPERATION_OWNER_MISMATCH")
    const request = nodeMcpInvokeRequestSchema.parse(input.request)
    enforceValueBudget(request.arguments, {
      maxBytes: this.#options.maxRequestBytes,
      maxDepth: 16,
      maxItems: 1_000,
    })
    return this.#withClient(request.connection, input.signal, async (client) =>
      toolText(
        await client.callTool(
          { name: request.remoteToolId, arguments: request.arguments },
          undefined,
          {
            signal: input.signal,
            timeout: this.#options.operationTimeoutMs,
            maxTotalTimeout: this.#options.operationTimeoutMs,
          }
        )
      )
    )
  }
}
