import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { createClient, type Client } from "@libsql/client"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const directory = mkdtempSync(join(tmpdir(), "avermate-migrate-0064-"))
let client: Client

beforeAll(async () => {
  client = createClient({ url: `file:${join(directory, "migration.db")}` })
  await client.executeMultiple(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (id TEXT PRIMARY KEY NOT NULL);
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
      updatedAt INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX assistant_tool_sources_user_url_unique
      ON assistant_tool_sources(userId, endpointUrl);
    CREATE INDEX assistant_tool_sources_user_status_idx
      ON assistant_tool_sources(userId, status);
    CREATE TABLE assistant_tool_source_policies (
      sourceId TEXT NOT NULL REFERENCES assistant_tool_sources(id) ON DELETE CASCADE,
      remoteToolId TEXT NOT NULL,
      PRIMARY KEY(sourceId, remoteToolId)
    );
    INSERT INTO users(id) VALUES ('owner-a');
    INSERT INTO assistant_tool_sources
      (id,userId,name,endpointUrl,endpointOrigin,placement,authKind,status,
       catalogJson,catalogDigest,catalogRevision,lastCheckedAt,createdAt,updatedAt)
    VALUES
      ('core-source','owner-a','Core','https://mcp.example/mcp','https://mcp.example',
       'hosted-core','none','enabled','[]','${"a".repeat(64)}',1,1,1,1),
      ('legacy-node','owner-a','Node','http://mcp.internal/mcp','http://mcp.internal',
       'node','none','enabled','[]','${"b".repeat(64)}',1,1,1,1);
    INSERT INTO assistant_tool_source_policies(sourceId,remoteToolId)
      VALUES ('core-source','read.core'),('legacy-node','read.node');
  `)
  const migration = readFileSync(
    join(import.meta.dir, "../drizzle/0064_numerous_the_phantom.sql"),
    "utf8"
  ).replaceAll("--> statement-breakpoint", "")
  await client.executeMultiple(migration)
})

afterAll(() => {
  client.close()
  try {
    rmSync(directory, { recursive: true, force: true })
  } catch {
    // libSQL can retain the Windows file handle for a few milliseconds; the
    // isolated OS temp directory remains the only affected path.
  }
})

describe("0064 immutable custom MCP Node binding", () => {
  test("preserves Core sources and fences legacy unbound Node sources", async () => {
    const result = await client.execute({
      sql: `SELECT id, placement, placementRef, status, lastError
        FROM assistant_tool_sources ORDER BY id`,
      args: [],
    })
    expect(result.rows).toEqual([
      expect.objectContaining({
        id: "core-source",
        placement: "hosted-core",
        placementRef: null,
        status: "enabled",
      }),
      expect.objectContaining({
        id: "legacy-node",
        placement: "node",
        placementRef: "legacy-unbound:legacy-node",
        status: "unavailable",
        lastError: "NODE_MCP_BINDING_MIGRATION_REQUIRED",
      }),
    ])
    const policies = await client.execute(
      "SELECT sourceId, remoteToolId FROM assistant_tool_source_policies ORDER BY sourceId"
    )
    expect(policies.rows).toHaveLength(2)
    const foreignKeys = await client.execute("PRAGMA foreign_key_check")
    expect(foreignKeys.rows).toEqual([])
  })
})
