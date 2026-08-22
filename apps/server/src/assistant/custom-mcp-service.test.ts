import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createClient, type Client } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import * as schema from "../db/schema"
import type {
  RemoteMcpCallResult,
  RemoteMcpClient,
  RemoteMcpConnection,
  RemoteMcpTool,
} from "./remote-mcp-client"

process.env.DATABASE_URL ||= "file::memory:"
process.env.BETTER_AUTH_URL ||= "http://localhost:3000"
process.env.BETTER_AUTH_SECRET ||= "test-secret-at-least-thirty-two-characters"
process.env.CLIENT_URL ||= "http://localhost:3001"

const directory = mkdtempSync(join(tmpdir(), "avermate-custom-mcp-"))
let client: Client

class FakeRemoteMcpClient implements RemoteMcpClient {
  tools: RemoteMcpTool[] = [
    {
      remoteToolId: "library.search",
      title: "Search library",
      description: "Searches a remote read-only library",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    },
  ]
  unavailable = false
  connections: RemoteMcpConnection[] = []

  async inspect(connection: RemoteMcpConnection) {
    this.connections.push(connection)
    if (this.unavailable) throw new Error("remote offline with secret-token-value")
    return structuredClone(this.tools)
  }

  async invoke(
    connection: RemoteMcpConnection,
    input: { remoteToolId: string; arguments: Record<string, unknown> }
  ): Promise<RemoteMcpCallResult> {
    this.connections.push(connection)
    return {
      isError: false,
      text: `Untrusted result for ${input.remoteToolId}: ${String(input.arguments.query)}`,
    }
  }
}

beforeAll(async () => {
  client = createClient({
    url: `file:${join(directory, `${crypto.randomUUID()}.db`)}`,
  })
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      emailVerified INTEGER NOT NULL DEFAULT 0,
      role TEXT NOT NULL DEFAULT 'user',
      banned INTEGER NOT NULL DEFAULT 0,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL
    );
    CREATE TABLE assistant_tool_sources (
      id TEXT PRIMARY KEY NOT NULL,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      endpointUrl TEXT NOT NULL,
      endpointOrigin TEXT NOT NULL,
      placement TEXT NOT NULL,
      authKind TEXT NOT NULL,
      sealedCredential TEXT,
      credentialHint TEXT,
      status TEXT NOT NULL DEFAULT 'review-required',
      catalogJson TEXT NOT NULL,
      catalogDigest TEXT NOT NULL,
      catalogRevision INTEGER NOT NULL DEFAULT 1,
      lastCheckedAt INTEGER NOT NULL,
      lastError TEXT,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      UNIQUE(userId, endpointUrl)
    );
    CREATE TABLE assistant_tool_source_policies (
      sourceId TEXT NOT NULL REFERENCES assistant_tool_sources(id) ON DELETE CASCADE,
      remoteToolId TEXT NOT NULL,
      catalogDigest TEXT NOT NULL,
      classification TEXT NOT NULL DEFAULT 'unreviewed',
      enabled INTEGER NOT NULL DEFAULT 0,
      allowedDataCategoriesJson TEXT NOT NULL DEFAULT '[]',
      reviewedAt INTEGER,
      createdAt INTEGER NOT NULL,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY(sourceId, remoteToolId)
    );
    INSERT INTO users (id, name, email, createdAt, updatedAt)
      VALUES ('owner-a', 'A', 'a@example.test', 1, 1),
             ('owner-b', 'B', 'b@example.test', 1, 1);
  `)
})

afterAll(() => {
  client.close()
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch {
    // Windows can retain the SQLite handle briefly; the OS temp directory is
    // still the only location affected and will be reclaimed normally.
  }
})

describe("custom MCP connection lifecycle", () => {
  test("seals credentials, requires catalogue review, and enforces egress categories", async () => {
    const { CustomMcpService } = await import("./custom-mcp-service")
    const remote = new FakeRemoteMcpClient()
    const database = drizzle(client, { schema })
    const service = new CustomMcpService(remote, database)
    const created = await service.create({
      ownerId: "owner-a",
      name: "Remote library",
      endpointUrl: "https://mcp.example.test/mcp",
      placement: "hosted-core",
      authKind: "bearer",
      credential: "private-bearer-secret",
    })

    expect(created.status).toBe("review-required")
    expect(created.credentialHint).toBe("cret")
    expect(created.tools[0]?.enabled).toBe(false)
    expect(JSON.stringify(created)).not.toContain("private-bearer-secret")
    expect(remote.connections[0]?.credential).toBe("private-bearer-secret")

    const reviewed = await service.review({
      ownerId: "owner-a",
      sourceId: created.id,
      expectedCatalogDigest: created.catalogDigest,
      tools: [
        {
          remoteToolId: "library.search",
          classification: "read-only",
          enabled: true,
          allowedDataCategories: ["prompt"],
        },
      ],
    })
    expect(reviewed.status).toBe("enabled")
    expect(reviewed.tools[0]?.namespacedToolId).toMatch(
      /^external\.amcp_.*\.library\.search$/
    )

    const result = await service.invoke({
      ownerId: "owner-a",
      sourceId: created.id,
      remoteToolId: "library.search",
      arguments: { query: "fractions" },
      requiredDataCategories: ["prompt"],
    })
    expect(result).toMatchObject({
      untrusted: true,
      isError: false,
      remoteToolId: "library.search",
    })
    expect(result.text).toContain("fractions")

    await expect(
      service.invoke({
        ownerId: "owner-a",
        sourceId: created.id,
        remoteToolId: "library.search",
        arguments: { query: "copied course" },
        requiredDataCategories: ["retrieved-snippets"],
      })
    ).rejects.toThrow("not approved")
    await expect(
      service.remove("owner-b", created.id)
    ).rejects.toThrow("not found")
  })

  test("invalidates enablement when the remote catalogue changes", async () => {
    const { CustomMcpService } = await import("./custom-mcp-service")
    const remote = new FakeRemoteMcpClient()
    const database = drizzle(client, { schema })
    const service = new CustomMcpService(remote, database)
    const created = await service.create({
      ownerId: "owner-b",
      name: "Changing server",
      endpointUrl: "https://changing.example.test/mcp",
      placement: "hosted-core",
      authKind: "none",
    })
    await service.review({
      ownerId: "owner-b",
      sourceId: created.id,
      expectedCatalogDigest: created.catalogDigest,
      tools: [
        {
          remoteToolId: "library.search",
          classification: "read-only",
          enabled: true,
          allowedDataCategories: ["prompt"],
        },
      ],
    })
    remote.tools.push({
      remoteToolId: "library.new",
      title: "New tool",
      description: "Changed catalogue",
      inputSchema: { type: "object", properties: {} },
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: true,
    })

    await expect(
      service.invoke({
        ownerId: "owner-b",
        sourceId: created.id,
        remoteToolId: "library.search",
        arguments: { query: "x" },
        requiredDataCategories: ["prompt"],
      })
    ).rejects.toThrow("must be reviewed again")
    const [changed] = await service.list("owner-b")
    expect(changed?.status).toBe("review-required")
    expect(changed?.catalogRevision).toBe(2)
    expect(changed?.tools.every((tool) => !tool.enabled)).toBe(true)
  })
})
