import { afterAll, describe, expect, test } from "bun:test"
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js"
import { z } from "zod"
import { LocalNodeMcpTransport } from "./mcp-transport"

const endpoint = "http://127.0.0.1:9911/mcp"
const observedAuthorization: string[] = []
async function mcpFixture() {
  const server = new McpServer({ name: "local-node-test", version: "1.0.0" })
  const registerTool = server.registerTool.bind(server) as unknown as (
    name: string,
    config: Record<string, unknown>,
    handler: (input: { query: string }) => Promise<{
      content: Array<{ type: "text"; text: string }>
    }>
  ) => void
  registerTool(
    "library.search",
    {
      title: "Search library",
      description: "Searches the local library",
      inputSchema: { query: z.string() },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async ({ query }: { query: string }) => ({
      content: [{ type: "text", text: `result:${query}` }],
    })
  )
  const http = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: () => crypto.randomUUID(),
    enableJsonResponse: true,
  })
  await server.connect(http)
  return { server, http }
}
let fixture = await mcpFixture()

const localFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const request = new Request(input, init)
  observedAuthorization.push(request.headers.get("authorization") ?? "")
  return fixture.http.handleRequest(request)
}

function client(
  overrides: Partial<ConstructorParameters<typeof LocalNodeMcpTransport>[0]> = {}
) {
  return new LocalNodeMcpTransport({
    allowedEndpoints: [endpoint],
    maxCatalogueTools: 500,
    maxRequestBytes: 16 * 1024,
    maxResponseBytes: 1024 * 1024,
    connectTimeoutMs: 2_000,
    operationTimeoutMs: 2_000,
    fetch: localFetch,
    ...overrides,
  })
}

const connection = {
  endpointUrl: endpoint,
  authKind: "bearer" as const,
  credential: "private-node-bearer-value",
}

afterAll(async () => {
  await fixture.server.close()
})

describe("local Node MCP transport", () => {
  test("uses the real Streamable HTTP SDK for bounded inspect and invoke", async () => {
    const transport = client()
    const catalog = await transport.inspect({
      ownerId: "owner-a",
      request: { connection },
    })
    expect(catalog.tools).toEqual([
      expect.objectContaining({
        remoteToolId: "library.search",
        readOnlyHint: true,
        destructiveHint: false,
      }),
    ])
    await fixture.server.close()
    fixture = await mcpFixture()
    const result = await transport.invoke({
      ownerId: "owner-a",
      request: {
        connection,
        remoteToolId: "library.search",
        arguments: { query: "fractions" },
      },
    })
    expect(result).toEqual({ isError: false, text: "result:fractions" })
    expect(observedAuthorization).toContain(
      "Bearer private-node-bearer-value"
    )
    expect(JSON.stringify({ catalog, result })).not.toContain(
      "private-node-bearer-value"
    )
  })

  test("rejects an endpoint outside the reviewed Node allowlist", async () => {
    await expect(
      client().inspect({
        ownerId: "owner-a",
        request: {
          connection: {
            endpointUrl: "http://127.0.0.1:9912/mcp",
            authKind: "none",
            credential: null,
          },
        },
      })
    ).rejects.toThrow("NODE_MCP_ENDPOINT_NOT_APPROVED")
  })

  test("enforces the invocation argument budget before network access", async () => {
    await expect(
      client({ maxRequestBytes: 128 }).invoke({
        ownerId: "owner-a",
        request: {
          connection,
          remoteToolId: "library.search",
          arguments: { query: "x".repeat(1_000) },
        },
      })
    ).rejects.toThrow("NODE_MCP_VALUE_TOO_LARGE")
  })

  test("propagates caller cancellation without retrying through Core", async () => {
    const controller = new AbortController()
    const blocked = client({
      fetch: async (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true }
          )
        }),
    }).inspect({
      ownerId: "owner-a",
      request: { connection },
      signal: controller.signal,
    })
    controller.abort()
    await expect(blocked).rejects.toThrow("NODE_OPERATION_CANCELLED")
  })
})
