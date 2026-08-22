import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

const IS_HARNESS = process.env.MCP_ADMIN_GATE_HARNESS === "true";
const PROTOCOL_VERSION = "2026-07-28";
// Applying the complete migration history through 0060 can take about 90s on
// slower Windows/libSQL runners.
const databaseHookTimeout = 120_000;

type McpPrincipal = import("./auth").McpPrincipal;

function principal(userId: string, role: string): McpPrincipal {
  const now = new Date("2026-08-20T12:00:00.000Z");
  return {
    userId,
    clientId: `client-${userId}`,
    scopes: new Set(["avermate:read", "avermate:admin"]),
    context: {
      headers: new Headers(),
      session: {
        user: {
          id: userId,
          name: userId,
          email: `${userId}@example.com`,
          emailVerified: true,
          image: null,
          role,
          banned: false,
          banReason: null,
          banExpires: null,
          createdAt: now,
          updatedAt: now,
        },
        session: {
          id: `session-${userId}`,
          token: `token-${userId}`,
          userId,
          expiresAt: new Date("2027-08-20T12:00:00.000Z"),
          createdAt: now,
          updatedAt: now,
          ipAddress: null,
          userAgent: "mcp-admin-gate-test",
          impersonatedBy: null,
        },
      },
    },
  } as McpPrincipal;
}

async function toolNamesFor(userId: string, role: string): Promise<string[]> {
  const { createAvermateMcpHandler } = await import("./http");
  const response = await createAvermateMcpHandler(
    principal(userId, role),
  ).fetch(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-method": "tools/list",
        "mcp-protocol-version": PROTOCOL_VERSION,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/list",
        params: {
          _meta: {
            "io.modelcontextprotocol/protocolVersion": PROTOCOL_VERSION,
            "io.modelcontextprotocol/clientInfo": {
              name: "admin-gate-test",
              version: "1.0.0",
            },
            "io.modelcontextprotocol/clientCapabilities": {},
          },
        },
      }),
    }),
  );
  const json = (await response.json()) as {
    result?: { tools?: Array<{ name?: string }> };
  };
  return (
    json.result?.tools?.flatMap((tool) =>
      typeof tool.name === "string" ? [tool.name] : [],
    ) ?? []
  );
}

if (IS_HARNESS) {
  beforeAll(async () => {
    // Importing the MCP handler initializes Better Auth's OAuth provider. Its
    // resource registration is asynchronous, so the database must have the
    // complete plugin schema before `./http` (and therefore `../lib/auth`) is
    // evaluated. Use the same migration and resource bootstrap as the server
    // entrypoint instead of maintaining a second test-only schema here.
    const [{ db }, { bootstrapOAuthResource, migrateClient }] =
      await Promise.all([import("../db"), import("../../scripts/migrate")]);
    await migrateClient(db.$client);
    await bootstrapOAuthResource(db.$client, process.env.MCP_RESOURCE_URL!);

    // Better Auth exposes its initialization context as a promise. Awaiting it
    // makes a late plugin failure part of the test setup instead of an
    // unhandled rejection after the assertions have passed.
    const { auth } = await import("../lib/auth");
    await auth.$context;
  }, databaseHookTimeout);

  describe("MCP administrator surface gate", () => {
    test("uses the authoritative bootstrap and exact-role admin check", async () => {
      expect(await toolNamesFor("bootstrap-admin", "user")).toContain(
        "admin.overview",
      );
      expect(await toolNamesFor("comma-role", "admin,moderator")).not.toContain(
        "admin.overview",
      );
    });
  });
} else {
  test("MCP administrator surface uses the authoritative admin gate", async () => {
    const child = Bun.spawn(["bun", "test", "./src/mcp/admin-gate.test.ts"], {
      cwd: join(import.meta.dir, "../.."),
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        ADMIN_USER_IDS: "bootstrap-admin",
        BETTER_AUTH_SECRET: "mcp-admin-gate-secret-that-is-long-enough",
        BETTER_AUTH_URL: "http://localhost:3000",
        CLIENT_URL: "http://localhost:3001",
        DATABASE_URL: "file::memory:",
        DISABLE_EMAIL: "true",
        DISABLE_UPLOADS: "true",
        MCP_ADMIN_GATE_HARNESS: "true",
        MCP_ENABLE_DCR: "false",
        MCP_REQUEST_STATE_SECRET:
          "mcp-admin-gate-request-secret-that-is-long-enough",
        MCP_RESOURCE_URL: "http://localhost:3000/mcp",
        NODE_ENV: "test",
      },
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    if (exitCode !== 0) {
      console.error([stdout, stderr].filter(Boolean).join("\n"));
    }
    expect(exitCode).toBe(0);
  }, 30_000);
}
