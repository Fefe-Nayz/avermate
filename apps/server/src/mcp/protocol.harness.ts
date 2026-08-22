import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import {
  cardSemanticsFromDefinition,
  createWidgetDefinition,
  WIDGET_DEFINITION_VERSION,
} from "@avermate/core";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// libSQL may use more than one connection for background job runners and
// transactions. A private file keeps the protocol harness isolated while
// ensuring every connection observes the migrated schema.
const protocolDatabaseDirectory = mkdtempSync(
  join(tmpdir(), "avermate-mcp-protocol-"),
);
process.env.DATABASE_URL = `file:${join(protocolDatabaseDirectory, "protocol.db")}`;
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "mcp-protocol-test-secret-that-is-long-enough";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.MCP_RESOURCE_URL = "http://localhost:3000/mcp";
process.env.MCP_REQUEST_STATE_SECRET =
  "mcp-request-state-test-secret-that-is-long-enough";
process.env.MCP_ENABLE_DCR = "false";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_UPLOADS = "true";

const PROTOCOL_VERSION = "2026-07-28";
const TEST_PASSWORD = "Correct Horse Battery Staple 42!";

const migration = readdirSync(join(import.meta.dir, "../../drizzle"))
  .filter((file) => /^\d{4}_.+\.sql$/.test(file))
  .sort()
  .map((file) =>
    readFileSync(join(import.meta.dir, "../../drizzle", file), "utf8"),
  )
  .join("\n");

const databaseHookTimeout = 120_000;

type JsonObject = Record<string, unknown>;
type JsonRpcResponse = {
  jsonrpc: "2.0";
  id?: string | number | null;
  result?: JsonObject;
  error?: { code: number; message: string; data?: unknown };
};
type McpPrincipal = import("./auth").McpPrincipal;
type McpHandler = ReturnType<typeof import("./http").createAvermateMcpHandler>;

let database: typeof import("../db").db;
let schema: typeof import("../db/schema");
let createAvermateMcpHandler: typeof import("./http").createAvermateMcpHandler;
let app: typeof import("../index").default;

function principal(
  userId: string,
  scopes: string[],
  role = "user",
): McpPrincipal {
  const now = new Date("2026-08-11T12:00:00.000Z");
  return {
    userId,
    clientId: `client-${userId}`,
    scopes: new Set(scopes),
    context: {
      headers: new Headers(),
      session: {
        user: {
          id: userId,
          name: userId === "admin-a" ? "Admin" : "MCP User",
          email: userId === "admin-a" ? "admin@example.com" : "mcp@example.com",
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
          expiresAt: new Date("2027-08-11T12:00:00.000Z"),
          createdAt: now,
          updatedAt: now,
          ipAddress: null,
          userAgent: "mcp-protocol-test",
          impersonatedBy: null,
        },
      },
    },
  } as McpPrincipal;
}

function requestMeta(version = PROTOCOL_VERSION): JsonObject {
  return {
    "io.modelcontextprotocol/protocolVersion": version,
    "io.modelcontextprotocol/clientInfo": {
      name: "avermate-protocol-test",
      version: "1.0.0",
    },
    "io.modelcontextprotocol/clientCapabilities": {
      elicitation: { form: {} },
    },
  };
}

function requestName(method: string, params: JsonObject): string | undefined {
  if (method === "tools/call" || method === "prompts/get") {
    return typeof params.name === "string" ? params.name : undefined;
  }
  if (method === "resources/read") {
    return typeof params.uri === "string" ? params.uri : undefined;
  }
  return undefined;
}

async function callMcp(
  handler: McpHandler,
  method: string,
  params: JsonObject = {},
  options: {
    id?: number;
    protocolVersion?: string;
    methodHeader?: string | null;
    nameHeader?: string | null;
  } = {},
): Promise<{ response: Response; json: JsonRpcResponse }> {
  const version = options.protocolVersion ?? PROTOCOL_VERSION;
  const completeParams = { ...params, _meta: requestMeta(version) };
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": version,
  });
  if (options.methodHeader !== null) {
    headers.set("mcp-method", options.methodHeader ?? method);
  }
  const name = requestName(method, params);
  if (options.nameHeader !== null && (options.nameHeader ?? name)) {
    headers.set("mcp-name", options.nameHeader ?? name ?? "");
  }

  const response = await handler.fetch(
    new Request("http://localhost:3000/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: options.id ?? 1,
        method,
        params: completeParams,
      }),
    }),
  );
  return {
    response,
    json: (await response.json()) as JsonRpcResponse,
  };
}

function toolNames(result: JsonObject | undefined): string[] {
  const tools = result?.tools;
  if (!Array.isArray(tools)) return [];
  return tools
    .map((tool) =>
      tool && typeof tool === "object" && "name" in tool
        ? String(tool.name)
        : "",
    )
    .filter(Boolean);
}

function toolDefinition(
  result: JsonObject | undefined,
  name: string,
): JsonObject | null {
  const tools = result?.tools;
  if (!Array.isArray(tools)) return null;
  const found = tools.find(
    (tool) =>
      tool && typeof tool === "object" && "name" in tool && tool.name === name,
  );
  return found && typeof found === "object" ? (found as JsonObject) : null;
}

function cookieJar() {
  const values = new Map<string, string>();
  return {
    absorb(response: Response) {
      const headers = response.headers as Headers & {
        getSetCookie?: () => string[];
      };
      const setCookies =
        headers.getSetCookie?.() ??
        (response.headers.get("set-cookie")
          ? [response.headers.get("set-cookie") as string]
          : []);
      for (const setCookie of setCookies) {
        const pair = setCookie.split(";", 1)[0];
        const separator = pair?.indexOf("=") ?? -1;
        if (!pair || separator < 1) continue;
        values.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
    },
    header() {
      return [...values.entries()]
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    },
  };
}

async function appRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("host", "localhost:3000");
  return app.fetch(
    new Request(`http://localhost:3000${path}`, { ...init, headers }),
  );
}

beforeAll(async () => {
  ({ db: database, schema } = await import("../db"));
  await database.$client.executeMultiple(migration);
  const mcpHttp = await import("./http");
  createAvermateMcpHandler = (principal) =>
    mcpHttp.createAvermateMcpHandler(principal, {
      testOnlyAllowLegacyMutations: true,
    });
  ({ default: app } = await import("../index"));

  const now = new Date("2026-08-11T12:00:00.000Z");
  const password = await Bun.password.hash(TEST_PASSWORD, "argon2id");
  await database.insert(schema.users).values([
    {
      id: "mcp-user",
      name: "MCP User",
      email: "mcp@example.com",
      emailVerified: true,
      role: "user",
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "other-user",
      name: "Other User",
      email: "other@example.com",
      emailVerified: true,
      role: "user",
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
    {
      id: "admin-a",
      name: "Admin",
      email: "admin@example.com",
      emailVerified: true,
      role: "admin",
      banned: false,
      createdAt: now,
      updatedAt: now,
    },
  ]);
  await database.insert(schema.accounts).values({
    id: "account-mcp-user",
    accountId: "mcp-user",
    providerId: "credential",
    issuer: "local:credential",
    userId: "mcp-user",
    password,
    createdAt: now,
    updatedAt: now,
  });
  await database.insert(schema.years).values([
    {
      id: "year-owned",
      name: "Owned year",
      startsAt: new Date("2025-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-01T00:00:00.000Z"),
      userId: "mcp-user",
    },
    {
      id: "year-foreign",
      name: "Foreign year",
      startsAt: new Date("2025-09-01T00:00:00.000Z"),
      endsAt: new Date("2026-07-01T00:00:00.000Z"),
      userId: "other-user",
    },
  ]);
  await database.insert(schema.subjects).values({
    id: "subject-owned",
    name: "Mathematics",
    yearId: "year-owned",
    userId: "mcp-user",
  });
  await database.insert(schema.grades).values({
    id: "grade-to-delete",
    name: "Algebra",
    value: 17,
    outOf: 20,
    passedAt: new Date("2026-03-01T00:00:00.000Z"),
    subjectId: "subject-owned",
    yearId: "year-owned",
    userId: "mcp-user",
  });
}, databaseHookTimeout);

afterAll(async () => {
  database.$client.close();
  try {
    rmSync(protocolDatabaseDirectory, { recursive: true, force: true });
  } catch {
    // Windows can retain a SQLite handle briefly; the OS temp directory will
    // reclaim it after the worker exits.
  }
}, databaseHookTimeout);

describe("MCP 2026-07-28 transport and discovery", () => {
  test("is stateless, self-described and cache-hinted", async () => {
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read"]),
    );
    const first = await callMcp(handler, "server/discover");
    const second = await callMcp(handler, "server/discover", {}, { id: 2 });

    expect(first.response.status).toBe(200);
    expect(first.response.headers.get("mcp-session-id")).toBeNull();
    expect(first.json.error).toBeUndefined();
    expect(first.json.result).toMatchObject({
      resultType: "complete",
      ttlMs: 300_000,
      cacheScope: "private",
    });
    expect(first.json.result).toEqual(second.json.result);
    expect(first.json.result?._meta).toMatchObject({
      "io.modelcontextprotocol/serverInfo": {
        name: "avermate",
        version: "2.0.0",
      },
    });
  });

  test("rejects missing or inconsistent modern headers and unsupported versions", async () => {
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read"]),
    );
    const missing = await callMcp(
      handler,
      "tools/list",
      {},
      {
        methodHeader: null,
      },
    );
    expect(missing.response.status).toBe(400);
    expect(missing.json.error?.code).toBe(-32020);

    const mismatch = await callMcp(
      handler,
      "tools/call",
      {
        name: "years.list",
        arguments: {},
      },
      {
        nameHeader: "grades.get",
      },
    );
    expect(mismatch.response.status).toBe(400);
    expect(mismatch.json.error?.code).toBe(-32020);

    const unsupported = await callMcp(
      handler,
      "tools/list",
      {},
      {
        protocolVersion: "2027-01-01",
      },
    );
    expect(unsupported.response.status).toBe(400);
    expect(unsupported.json.error?.code).toBe(-32022);
  });

  test("publishes deterministic tools, resources, templates and prompts", async () => {
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read"]),
    );
    const toolsOne = await callMcp(handler, "tools/list");
    const toolsTwo = await callMcp(handler, "tools/list", {}, { id: 2 });
    expect(toolsOne.json.result).toEqual(toolsTwo.json.result);
    expect(toolsOne.json.result).toMatchObject({
      resultType: "complete",
      ttlMs: 300_000,
      cacheScope: "private",
    });
    expect(toolNames(toolsOne.json.result)).toContain("analytics.snapshot");
    expect(toolNames(toolsOne.json.result)).toContain("grades.attachments");
    expect(toolNames(toolsOne.json.result)).toContain("jobs.get");

    const resources = await callMcp(handler, "resources/list");
    expect(resources.json.result?.resources).toBeArrayOfSize(5);
    const templates = await callMcp(handler, "resources/templates/list");
    expect(JSON.stringify(templates.json.result?.resourceTemplates)).toContain(
      "avermate://years/{yearId}/snapshot",
    );
    expect(JSON.stringify(templates.json.result?.resourceTemplates)).toContain(
      "avermate://subjects/{subjectId}",
    );
    expect(JSON.stringify(templates.json.result?.resourceTemplates)).toContain(
      "avermate://grades/{gradeId}",
    );

    const prompts = await callMcp(handler, "prompts/list");
    expect(JSON.stringify(prompts.json.result?.prompts)).toContain(
      "academic-check-in",
    );
    expect(JSON.stringify(prompts.json.result?.prompts)).toContain(
      "year-recap",
    );
    expect(JSON.stringify(prompts.json.result?.prompts)).toContain(
      "fiche-methodology",
    );
    expect(JSON.stringify(prompts.json.result?.prompts)).toContain(
      "fiche-from-chapter",
    );
    expect(JSON.stringify(prompts.json.result?.prompts)).toContain(
      "mindmap-from-chapter",
    );
    for (const name of ["fiche-from-chapter", "mindmap-from-chapter"]) {
      const generated = await callMcp(handler, "prompts/get", {
        name,
        arguments: { folderId: "folder-owned" },
      });
      const instructions = JSON.stringify(generated.json.result);
      expect(instructions).toContain("documents.create");
      expect(instructions).toContain("documents.update");
      expect(instructions).toContain("revision returned by create");
    }

    const plannerHandler = createAvermateMcpHandler(
      principal("mcp-user", [
        "avermate:read",
        "avermate:planner.read",
        "avermate:planner.write",
      ]),
    );
    const plannerOne = await callMcp(plannerHandler, "tools/list");
    const plannerTwo = await callMcp(
      plannerHandler,
      "tools/list",
      {},
      { id: 3 },
    );
    expect(plannerOne.json.result).toEqual(plannerTwo.json.result);
    expect(
      toolNames(plannerOne.json.result).filter((name) =>
        name.startsWith("planner."),
      ),
    ).toEqual(["planner.agenda", "planner.list"]);
    expect(toolNames(plannerOne.json.result)).toContain(
      "planning.tasks.create",
    );
    expect(toolNames(plannerOne.json.result)).toContain(
      "actions.resolve_approval",
    );
    expect(toolNames(plannerOne.json.result)).toContain("actions.undo_execute");

    const materialsHandler = createAvermateMcpHandler(
      principal("mcp-user", [
        "avermate:read",
        "avermate:materials.read",
        "avermate:materials.write",
      ]),
    );
    const materialsOne = await callMcp(materialsHandler, "tools/list");
    const materialsTwo = await callMcp(
      materialsHandler,
      "tools/list",
      {},
      { id: 4 },
    );
    expect(materialsOne.json.result).toEqual(materialsTwo.json.result);
    expect(
      toolNames(materialsOne.json.result).filter((name) =>
        name.startsWith("materials."),
      ),
    ).toEqual([
      "materials.folders.list",
      "materials.documents.list",
      "materials.documents.get",
      "materials.documents.transcript",
      "materials.folders.create",
      "materials.documents.transcribe",
      "materials.documents.rename",
      "materials.documents.move",
      "materials.documents.delete",
      "materials.folders.delete",
    ]);
    expect(
      toolNames(materialsOne.json.result).filter((name) =>
        name.startsWith("recordings."),
      ),
    ).toEqual(["recordings.list", "recordings.transcript"]);
    expect(toolNames(materialsOne.json.result)).toContain("sync.status");
    expect(toolNames(materialsOne.json.result)).toContain("sync.trigger");

    const documentsHandler = createAvermateMcpHandler(
      principal("mcp-user", [
        "avermate:read",
        "avermate:documents.read",
        "avermate:documents.write",
      ]),
    );
    const documentsOne = await callMcp(documentsHandler, "tools/list");
    const documentsTwo = await callMcp(
      documentsHandler,
      "tools/list",
      {},
      { id: 5 },
    );
    expect(documentsOne.json.result).toEqual(documentsTwo.json.result);
    expect(
      toolNames(documentsOne.json.result).filter((name) =>
        name.startsWith("documents."),
      ),
    ).toEqual([
      "documents.list",
      "documents.get",
      "documents.downloadPptx",
      "documents.create",
      "documents.update",
      "documents.exportPptx",
      "documents.delete",
    ]);
  });
});

describe("MCP authorization, scopes and ownership", () => {
  test("keeps mutation and administration surfaces out of read-only catalogs", async () => {
    const read = await callMcp(
      createAvermateMcpHandler(principal("mcp-user", ["avermate:read"])),
      "tools/list",
    );
    const write = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:write"]),
      ),
      "tools/list",
    );
    const destructive = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:delete"]),
      ),
      "tools/list",
    );
    const scopedNonAdmin = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:admin"]),
      ),
      "tools/list",
    );
    const admin = await callMcp(
      createAvermateMcpHandler(
        principal("admin-a", ["avermate:read", "avermate:admin"], "admin"),
      ),
      "tools/list",
    );

    expect(toolNames(read.json.result)).not.toContain("years.create");
    expect(toolNames(read.json.result)).not.toContain("grades.delete");
    expect(toolNames(read.json.result)).not.toContain("admin.overview");
    expect(toolNames(write.json.result)).toContain("years.create");
    expect(toolNames(write.json.result)).not.toContain("grades.delete");
    expect(toolNames(destructive.json.result)).toContain("grades.delete");
    expect(toolNames(scopedNonAdmin.json.result)).not.toContain(
      "admin.overview",
    );
    expect(toolNames(admin.json.result)).toContain("admin.overview");
    expect(toolNames(admin.json.result)).toContain("admin.presets");

    const createAverage = JSON.stringify(
      toolDefinition(write.json.result, "averages.create")?.inputSchema,
    );
    const updateAverage = JSON.stringify(
      toolDefinition(write.json.result, "averages.update")?.inputSchema,
    );
    expect(createAverage).toContain("addDashboardCard");
    expect(createAverage).not.toContain("isMain");
    expect(updateAverage).not.toContain("addDashboardCard");
    expect(updateAverage).not.toContain("isMain");

    const cardsList = JSON.stringify(
      toolDefinition(read.json.result, "cards.list")?.inputSchema,
    );
    const cardsCreate = JSON.stringify(
      toolDefinition(write.json.result, "cards.create")?.inputSchema,
    );
    const cardsUpdate = JSON.stringify(
      toolDefinition(write.json.result, "cards.update")?.inputSchema,
    );
    const cardsReset = JSON.stringify(
      toolDefinition(destructive.json.result, "cards.reset")?.inputSchema,
    );
    expect(cardsList).toContain("insights");
    expect(cardsCreate).toContain("insights");
    expect(cardsCreate).toContain("definitionVersion");
    expect(cardsCreate).toContain("definitionJson");
    expect(cardsUpdate).toContain("definitionVersion");
    expect(cardsUpdate).toContain("visualization");
    expect(cardsReset).toContain("insights");
  });

  test("keeps grade-copy reads scoped and hides provider credentials", async () => {
    await database.insert(schema.files).values({
      id: "mcp-grade-copy-file",
      provider: "private-provider",
      storageKey: "mcp-provider-secret-grade-copy",
      url: "https://cdn.example.test/grade-copy.pdf",
      mimeType: "application/pdf",
      byteSize: 2_048,
      purpose: "grade-copy",
      userId: "mcp-user",
    });
    await database.insert(schema.gradeAttachments).values({
      id: "mcp-grade-copy-attachment",
      gradeId: "grade-to-delete",
      fileId: "mcp-grade-copy-file",
      label: "Scanned algebra copy",
      sortOrder: 0,
      userId: "mcp-user",
    });

    const readHandler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read"]),
    );
    const readCatalog = await callMcp(readHandler, "tools/list");
    const writeOnlyCatalog = await callMcp(
      createAvermateMcpHandler(principal("mcp-user", ["avermate:write"])),
      "tools/list",
    );
    expect(toolNames(readCatalog.json.result)).toContain("grades.attachments");
    expect(toolNames(writeOnlyCatalog.json.result)).not.toContain(
      "grades.attachments",
    );

    const response = await callMcp(readHandler, "tools/call", {
      name: "grades.attachments",
      arguments: { gradeId: "grade-to-delete" },
    });
    expect(response.json.result?.isError).not.toBe(true);
    expect(response.json.result?.structuredContent).toMatchObject({
      ok: true,
      data: [
        {
          id: "mcp-grade-copy-attachment",
          label: "Scanned algebra copy",
          sortOrder: 0,
          file: {
            id: "mcp-grade-copy-file",
            mimeType: "application/pdf",
            byteSize: 2_048,
            handles: {
              preview: {
                handle: expect.any(String),
                audience: "preview",
                mimeType: "application/pdf",
                byteSize: 2_048,
              },
              download: {
                handle: expect.any(String),
                audience: "download",
                mimeType: "application/pdf",
                byteSize: 2_048,
              },
            },
          },
        },
      ],
    });
    const serialized = JSON.stringify(response.json.result?.structuredContent);
    expect(serialized).not.toContain("https://cdn.example.test");
    expect(serialized).not.toContain("mcp-provider-secret-grade-copy");
    expect(serialized).not.toContain('"storageKey"');
    expect(serialized).not.toContain('"provider"');
  });

  test("keeps planner read and write scopes isolated", async () => {
    const legacy = await callMcp(
      createAvermateMcpHandler(principal("mcp-user", ["avermate:read"])),
      "tools/list",
    );
    const plannerRead = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:planner.read"]),
      ),
      "tools/list",
    );
    const plannerWrite = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:planner.write"]),
      ),
      "tools/list",
    );

    const plannerNames = (result: JsonObject | undefined) =>
      toolNames(result).filter((name) => name.startsWith("planner."));
    expect(plannerNames(legacy.json.result)).toEqual([]);
    expect(plannerNames(plannerRead.json.result)).toEqual([
      "planner.agenda",
      "planner.list",
    ]);
    expect(plannerNames(plannerWrite.json.result)).toEqual([]);
    expect(toolNames(legacy.json.result)).not.toContain(
      "planning.tasks.create",
    );
    expect(toolNames(plannerRead.json.result)).not.toContain(
      "planning.tasks.create",
    );
    expect(toolNames(plannerWrite.json.result)).toContain(
      "planning.tasks.create",
    );
    expect(toolNames(plannerWrite.json.result)).toContain(
      "actions.resolve_approval",
    );
    expect(toolNames(plannerWrite.json.result)).toContain(
      "actions.undo_execute",
    );
    expect(
      JSON.stringify(
        toolDefinition(plannerWrite.json.result, "planning.tasks.create")
          ?.inputSchema,
      ),
    ).toContain("idempotencyKey");
  });

  test("keeps materials read and write scopes isolated", async () => {
    const legacy = await callMcp(
      createAvermateMcpHandler(principal("mcp-user", ["avermate:read"])),
      "tools/list",
    );
    const materialsRead = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:materials.read"]),
      ),
      "tools/list",
    );
    const materialsWrite = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:materials.write"]),
      ),
      "tools/list",
    );

    const materialNames = (result: JsonObject | undefined) =>
      toolNames(result).filter((name) => name.startsWith("materials."));
    const recordingNames = (result: JsonObject | undefined) =>
      toolNames(result).filter((name) => name.startsWith("recordings."));
    expect(materialNames(legacy.json.result)).toEqual([]);
    expect(materialNames(materialsRead.json.result)).toEqual([
      "materials.folders.list",
      "materials.documents.list",
      "materials.documents.get",
      "materials.documents.transcript",
    ]);
    expect(materialNames(materialsWrite.json.result)).toEqual([
      "materials.folders.create",
      "materials.documents.transcribe",
      "materials.documents.rename",
      "materials.documents.move",
      "materials.documents.delete",
      "materials.folders.delete",
    ]);
    expect(recordingNames(legacy.json.result)).toEqual([]);
    expect(recordingNames(materialsRead.json.result)).toEqual([
      "recordings.list",
      "recordings.transcript",
    ]);
    expect(recordingNames(materialsWrite.json.result)).toEqual([]);
    expect(materialNames(materialsWrite.json.result)).not.toContain(
      "materials.documents.upload",
    );
    expect(toolNames(legacy.json.result)).not.toContain("sync.status");
    expect(toolNames(legacy.json.result)).not.toContain("sync.trigger");
    expect(toolNames(materialsRead.json.result)).toContain("sync.status");
    expect(toolNames(materialsRead.json.result)).not.toContain("sync.trigger");
    expect(toolNames(materialsWrite.json.result)).not.toContain("sync.status");
    expect(toolNames(materialsWrite.json.result)).toContain("sync.trigger");
    expect(
      JSON.stringify(
        toolDefinition(materialsWrite.json.result, "materials.documents.delete")
          ?.inputSchema,
      ),
    ).toContain("idempotencyKey");
    expect(
      JSON.stringify(
        toolDefinition(materialsWrite.json.result, "materials.folders.delete")
          ?.inputSchema,
      ),
    ).toContain("idempotencyKey");
  });

  test("projects only an owned lecture transcript through materials read", async () => {
    const now = new Date("2026-08-20T14:00:00.000Z");
    await database.insert(schema.lectureRecordings).values([
      {
        id: "recording-mcp-owned",
        title: "Owned lecture",
        status: "ready",
        recordedAt: now,
        durationMs: 90_000,
        yearId: "year-owned",
        userId: "mcp-user",
      },
      {
        id: "recording-mcp-foreign",
        title: "Foreign lecture",
        status: "ready",
        recordedAt: now,
        durationMs: 45_000,
        yearId: "year-foreign",
        userId: "other-user",
      },
    ]);
    await database.insert(schema.recordingTranscripts).values([
      {
        recordingId: "recording-mcp-owned",
        text: "Owned transcript content",
        segmentsVersion: 1,
        segmentsJson: [{ startMs: 0, endMs: 12_000, text: "Owned window" }],
        language: "fr",
        provider: "mistral",
        userId: "mcp-user",
      },
      {
        recordingId: "recording-mcp-foreign",
        text: "FOREIGN_PRIVATE_TRANSCRIPT",
        segmentsVersion: 1,
        segmentsJson: [
          { startMs: 0, endMs: 8_000, text: "FOREIGN_PRIVATE_WINDOW" },
        ],
        language: "en",
        provider: "mistral",
        userId: "other-user",
      },
    ]);

    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read", "avermate:materials.read"]),
    );
    const owned = await callMcp(handler, "tools/call", {
      name: "recordings.transcript",
      arguments: { recordingId: "recording-mcp-owned" },
    });
    expect(owned.json.result?.isError).not.toBe(true);
    expect(owned.json.result?.structuredContent).toMatchObject({
      ok: true,
      data: {
        recording: {
          id: "recording-mcp-owned",
          title: "Owned lecture",
          status: "ready",
        },
        transcript: {
          text: "Owned transcript content",
          segmentsVersion: 1,
          segments: [{ startMs: 0, endMs: 12_000, text: "Owned window" }],
          language: "fr",
          provider: "mistral",
        },
      },
    });
    const serializedOwned = JSON.stringify(
      owned.json.result?.structuredContent,
    );
    expect(serializedOwned).not.toContain("userId");
    expect(serializedOwned).not.toContain("fileId");
    expect(serializedOwned).not.toContain("storageKey");

    const foreign = await callMcp(handler, "tools/call", {
      name: "recordings.transcript",
      arguments: { recordingId: "recording-mcp-foreign" },
    });
    expect(foreign.json.result?.isError).toBe(true);
    expect(JSON.stringify(foreign.json.result)).not.toContain(
      "FOREIGN_PRIVATE_TRANSCRIPT",
    );
    expect(JSON.stringify(foreign.json.result)).not.toContain(
      "FOREIGN_PRIVATE_WINDOW",
    );
  });

  test("keeps document read and write scopes isolated", async () => {
    const legacy = await callMcp(
      createAvermateMcpHandler(principal("mcp-user", ["avermate:read"])),
      "tools/list",
    );
    const documentsRead = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:documents.read"]),
      ),
      "tools/list",
    );
    const documentsWrite = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:documents.write"]),
      ),
      "tools/list",
    );

    const documentNames = (result: JsonObject | undefined) =>
      toolNames(result).filter((name) => name.startsWith("documents."));
    expect(documentNames(legacy.json.result)).toEqual([]);
    expect(documentNames(documentsRead.json.result)).toEqual([
      "documents.list",
      "documents.get",
      "documents.downloadPptx",
    ]);
    expect(documentNames(documentsWrite.json.result)).toEqual([
      "documents.create",
      "documents.update",
      "documents.exportPptx",
      "documents.delete",
    ]);
    expect(
      JSON.stringify(
        toolDefinition(documentsWrite.json.result, "documents.delete")
          ?.inputSchema,
      ),
    ).toContain("idempotencyKey");
  });

  test("keeps provider credentials and custom CA material out of sync status", async () => {
    await database.insert(schema.syncConnections).values([
      {
        id: "sync-owned",
        provider: "moodle",
        label: "Owned Moodle",
        baseUrl: "https://moodle.example.test",
        sealedCredentials: "mcp-sealed-provider-secret",
        caCertPem: "mcp-private-ca-secret",
        capabilities: ["files"],
        yearId: "year-owned",
        userId: "mcp-user",
      },
      {
        id: "sync-foreign",
        provider: "moodle",
        label: "Foreign Moodle",
        baseUrl: "https://foreign.example.test",
        sealedCredentials: "mcp-foreign-provider-secret",
        caCertPem: "mcp-foreign-ca-secret",
        capabilities: ["files"],
        yearId: "year-foreign",
        userId: "other-user",
      },
    ]);
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read", "avermate:materials.read"]),
    );
    const owned = await callMcp(handler, "tools/call", {
      name: "sync.status",
      arguments: { connectionId: "sync-owned" },
    });
    expect(owned.json.result?.isError).not.toBe(true);
    expect(owned.json.result?.structuredContent).toMatchObject({
      ok: true,
      data: {
        connection: {
          id: "sync-owned",
          label: "Owned Moodle",
          hasCustomCa: true,
        },
        lastJob: null,
      },
    });
    const serialized = JSON.stringify(owned.json.result?.structuredContent);
    expect(serialized).not.toContain("mcp-sealed-provider-secret");
    expect(serialized).not.toContain("mcp-private-ca-secret");
    expect(serialized).not.toContain("sealedCredentials");
    expect(serialized).not.toContain("caCertPem");

    const foreign = await callMcp(handler, "tools/call", {
      name: "sync.status",
      arguments: { connectionId: "sync-foreign" },
    });
    expect(foreign.json.result?.isError).toBe(true);
    expect(JSON.stringify(foreign.json.result)).not.toContain(
      "mcp-foreign-provider-secret",
    );
    expect(JSON.stringify(foreign.json.result)).not.toContain(
      "mcp-foreign-ca-secret",
    );
  });

  test("cannot invoke an unregistered mutation through a read-only handler", async () => {
    const before = await database.select().from(schema.years);
    const response = await callMcp(
      createAvermateMcpHandler(principal("mcp-user", ["avermate:read"])),
      "tools/call",
      {
        name: "years.create",
        arguments: {
          name: "Must not exist",
          startsAt: "2026-09-01T00:00:00.000Z",
          endsAt: "2027-07-01T00:00:00.000Z",
        },
      },
    );
    expect(JSON.stringify(response.json)).not.toContain('"ok":true');
    expect(await database.select().from(schema.years)).toHaveLength(
      before.length,
    );
  });

  test("surfaces the document revision fence through the MCP tool", async () => {
    const handler = createAvermateMcpHandler(
      principal("mcp-user", [
        "avermate:read",
        "avermate:documents.read",
        "avermate:documents.write",
      ]),
    );
    const createdResponse = await callMcp(handler, "tools/call", {
      name: "documents.create",
      arguments: {
        yearId: "year-owned",
        title: "MCP revision fiche",
        bodyMarkdown: "Initial source-grounded body",
        subjectId: "subject-owned",
      },
    });
    expect(createdResponse.json.result?.isError).not.toBe(true);
    const [created] = await database
      .select()
      .from(schema.studyDocuments)
      .where(eq(schema.studyDocuments.title, "MCP revision fiche"));
    expect(created).toMatchObject({
      bodyMarkdown: "Initial source-grounded body",
      revision: 1,
      userId: "mcp-user",
    });

    const readResponse = await callMcp(handler, "tools/call", {
      name: "documents.get",
      arguments: { documentId: created!.id },
    });
    expect(readResponse.json.result?.structuredContent).toMatchObject({
      ok: true,
      data: { document: { id: created!.id, revision: 1 } },
    });

    const updatedResponse = await callMcp(handler, "tools/call", {
      name: "documents.update",
      arguments: {
        documentId: created!.id,
        revision: 1,
        bodyMarkdown: "Accepted MCP body",
      },
    });
    expect(updatedResponse.json.result?.isError).not.toBe(true);

    const staleResponse = await callMcp(handler, "tools/call", {
      name: "documents.update",
      arguments: {
        documentId: created!.id,
        revision: 1,
        bodyMarkdown: "Stale MCP body",
      },
    });
    expect(staleResponse.json.result?.isError).toBe(true);
    expect(JSON.stringify(staleResponse.json.result)).toContain(
      "This fiche changed elsewhere — reload",
    );
    const [preserved] = await database
      .select()
      .from(schema.studyDocuments)
      .where(eq(schema.studyDocuments.id, created!.id));
    expect(preserved).toMatchObject({
      bodyMarkdown: "Accepted MCP body",
      revision: 2,
    });
    await database
      .delete(schema.studyDocuments)
      .where(eq(schema.studyDocuments.id, created!.id));
  });

  test("polls only owned jobs without exposing queue internals", async () => {
    await database.insert(schema.jobs).values([
      {
        id: "job-mcp-owned",
        kind: "export.documentPptx",
        payload: { documentId: "private-document-input" },
        status: "succeeded",
        idempotencyKey: "private-idempotency-key",
        result: {
          fileId: "file-mcp-owned",
          byteSize: 42,
          revision: 1,
          url: "https://example.invalid/export.pptx",
        },
        userId: "mcp-user",
      },
      {
        id: "job-mcp-foreign",
        kind: "export.documentPptx",
        result: {
          fileId: "file-mcp-foreign",
          url: "https://example.invalid/foreign.pptx",
        },
        userId: "other-user",
      },
    ]);
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read"]),
    );
    const owned = await callMcp(handler, "tools/call", {
      name: "jobs.get",
      arguments: { jobId: "job-mcp-owned" },
    });
    expect(owned.json.result?.structuredContent).toMatchObject({
      ok: true,
      data: {
        id: "job-mcp-owned",
        kind: "export.documentPptx",
        status: "succeeded",
        result: {
          fileId: "file-mcp-owned",
          byteSize: 42,
          revision: 1,
        },
      },
    });
    const serialized = JSON.stringify(owned.json.result?.structuredContent);
    expect(serialized).not.toContain("private-document-input");
    expect(serialized).not.toContain("private-idempotency-key");
    expect(serialized).not.toContain("lockedBy");
    expect(serialized).not.toContain("lockedUntil");
    expect(serialized).not.toContain("example.invalid");
    expect(serialized).not.toContain("mcp-user");

    const foreign = await callMcp(handler, "tools/call", {
      name: "jobs.get",
      arguments: { jobId: "job-mcp-foreign" },
    });
    expect(foreign.json.result?.isError).toBe(true);

    await database
      .delete(schema.jobs)
      .where(eq(schema.jobs.id, "job-mcp-owned"));
    await database
      .delete(schema.jobs)
      .where(eq(schema.jobs.id, "job-mcp-foreign"));
  });

  test("keeps the signed-URL PPTX compatibility name fail-closed", async () => {
    const mimeType =
      "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    await database.insert(schema.studyDocuments).values([
      {
        id: "slides-mcp-owned",
        kind: "slides",
        title: "Owned MCP slides",
        bodyMarkdown: "# Owned",
        revision: 1,
        metaJson: { version: 1 },
        yearId: "year-owned",
        userId: "mcp-user",
      },
      {
        id: "slides-mcp-foreign",
        kind: "slides",
        title: "Foreign MCP slides",
        bodyMarkdown: "# Foreign",
        revision: 1,
        metaJson: { version: 1 },
        yearId: "year-foreign",
        userId: "other-user",
      },
    ]);
    await database.insert(schema.files).values([
      {
        id: "pptx-mcp-owned",
        provider: "protocol-test",
        storageKey: "private-owned-pptx-key",
        url: "https://downloads.example.test/owned.pptx?signature=short-lived",
        mimeType,
        byteSize: 4_096,
        purpose: "document-export",
        userId: "mcp-user",
      },
      {
        id: "pptx-mcp-foreign",
        provider: "protocol-test",
        storageKey: "private-foreign-pptx-key",
        url: "https://downloads.example.test/foreign.pptx?signature=private",
        mimeType,
        byteSize: 8_192,
        purpose: "document-export",
        userId: "other-user",
      },
    ]);
    await database.insert(schema.studyDocumentExports).values([
      {
        documentId: "slides-mcp-owned",
        revision: 1,
        fileId: "pptx-mcp-owned",
        userId: "mcp-user",
      },
      {
        documentId: "slides-mcp-foreign",
        revision: 1,
        fileId: "pptx-mcp-foreign",
        userId: "other-user",
      },
    ]);

    try {
      const handler = createAvermateMcpHandler(
        principal("mcp-user", ["avermate:read", "avermate:documents.read"]),
      );
      const owned = await callMcp(handler, "tools/call", {
        name: "documents.downloadPptx",
        arguments: { documentId: "slides-mcp-owned", revision: 1 },
      });
      expect(owned.json.result?.structuredContent).toEqual({
        ok: false,
        error: {
          code: "AGENT_TOOL_NOT_AVAILABLE",
          message:
            "documents.downloadPptx is discoverable for compatibility but unavailable to agents until it has a bounded descriptor and safe transport.",
          retryable: false,
        },
      });
      const serialized = JSON.stringify(owned.json.result?.structuredContent);
      expect(serialized).not.toContain("downloads.example.test");
      expect(serialized).not.toContain("pptx-mcp-owned");
      expect(serialized).not.toContain("private-owned-pptx-key");
      expect(serialized).not.toContain("mcp-user");

      const foreign = await callMcp(handler, "tools/call", {
        name: "documents.downloadPptx",
        arguments: { documentId: "slides-mcp-foreign", revision: 1 },
      });
      expect(foreign.json.result?.isError).toBe(true);
      expect(foreign.json.result?.structuredContent).toEqual(
        owned.json.result?.structuredContent,
      );
      const serializedForeign = JSON.stringify(foreign.json.result);
      expect(serializedForeign).not.toContain("foreign.pptx");
      expect(serializedForeign).not.toContain("private-foreign-pptx-key");

      const unavailableRevision = await callMcp(handler, "tools/call", {
        name: "documents.downloadPptx",
        arguments: { documentId: "slides-mcp-owned", revision: 2 },
      });
      expect(unavailableRevision.json.result?.isError).toBe(true);
      expect(unavailableRevision.json.result?.structuredContent).toEqual(
        owned.json.result?.structuredContent,
      );
    } finally {
      await database
        .delete(schema.studyDocumentExports)
        .where(eq(schema.studyDocumentExports.documentId, "slides-mcp-owned"));
      await database
        .delete(schema.studyDocumentExports)
        .where(
          eq(schema.studyDocumentExports.documentId, "slides-mcp-foreign"),
        );
      await database
        .delete(schema.studyDocuments)
        .where(eq(schema.studyDocuments.id, "slides-mcp-owned"));
      await database
        .delete(schema.studyDocuments)
        .where(eq(schema.studyDocuments.id, "slides-mcp-foreign"));
      await database
        .delete(schema.files)
        .where(eq(schema.files.id, "pptx-mcp-owned"));
      await database
        .delete(schema.files)
        .where(eq(schema.files.id, "pptx-mcp-foreign"));
    }
  });

  test("round-trips canonical analytical widgets through MCP", async () => {
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read", "avermate:write"]),
    );
    const definition = createWidgetDefinition("insights");
    definition.query.scope = {
      kind: "subjects",
      subjectIds: ["subject-owned"],
      includeDescendants: true,
    };
    const createdResponse = await callMcp(handler, "tools/call", {
      name: "cards.create",
      arguments: {
        yearId: "year-owned",
        surface: "insights",
        definitionVersion: WIDGET_DEFINITION_VERSION,
        definitionJson: definition,
        title: "MCP analytical widget",
      },
    });
    expect(createdResponse.json.result?.isError).not.toBe(true);

    const [created] = await database
      .select()
      .from(schema.dashboardCards)
      .where(eq(schema.dashboardCards.title, "MCP analytical widget"));
    expect(created).toMatchObject({
      surface: "insights",
      definitionVersion: WIDGET_DEFINITION_VERSION,
    });
    // The target is read off the definition; the row keeps no copy of it.
    expect(cardSemanticsFromDefinition(created!.definitionJson)).toMatchObject({
      targetKind: "subject",
      targetId: "subject-owned",
    });
    expect(
      await database
        .select()
        .from(schema.dashboardCardReferences)
        .where(eq(schema.dashboardCardReferences.cardId, created?.id ?? "")),
    ).toEqual([
      expect.objectContaining({
        kind: "subject",
        referenceId: "subject-owned",
      }),
    ]);

    const updatedResponse = await callMcp(handler, "tools/call", {
      name: "cards.update",
      arguments: {
        cardId: created?.id,
        title: "MCP analytical widget renamed",
      },
    });
    expect(updatedResponse.json.result?.isError).not.toBe(true);
    const listedResponse = await callMcp(handler, "tools/call", {
      name: "cards.list",
      arguments: { yearId: "year-owned", surface: "insights" },
    });
    expect(JSON.stringify(listedResponse.json.result)).toContain(
      `"definitionVersion":${WIDGET_DEFINITION_VERSION}`,
    );
    expect(JSON.stringify(listedResponse.json.result)).toContain(
      "MCP analytical widget renamed",
    );

    await database
      .delete(schema.dashboardCards)
      .where(eq(schema.dashboardCards.id, created?.id ?? ""));
  });

  test("keeps an omitted assessment type on partial MCP grade updates", async () => {
    await database.insert(schema.gradeTypes).values({
      id: "mcp-update-type",
      name: "Written exam",
      titlePrefix: "DS ",
      coefficient: 3,
      outOf: 40,
      accent: "primary",
      yearId: "year-owned",
      userId: "mcp-user",
    });
    await database.insert(schema.grades).values({
      id: "mcp-grade-update",
      name: "Original typed grade",
      value: 16,
      outOf: 20,
      coefficient: 2,
      note: "Preserve through MCP",
      passedAt: new Date("2026-03-10T12:00:00.000Z"),
      subjectId: "subject-owned",
      typeId: "mcp-update-type",
      yearId: "year-owned",
      userId: "mcp-user",
    });
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read", "avermate:write"]),
    );

    const response = await callMcp(handler, "tools/call", {
      name: "grades.update",
      arguments: {
        gradeId: "mcp-grade-update",
        name: "Renamed typed grade",
      },
    });
    expect(response.json.result?.isError).not.toBe(true);
    const [stored] = await database
      .select()
      .from(schema.grades)
      .where(eq(schema.grades.id, "mcp-grade-update"));
    expect(stored).toMatchObject({
      name: "Renamed typed grade",
      coefficient: 2,
      note: "Preserve through MCP",
      typeId: "mcp-update-type",
    });

    await database
      .delete(schema.grades)
      .where(eq(schema.grades.id, "mcp-grade-update"));
    await database
      .delete(schema.gradeTypes)
      .where(eq(schema.gradeTypes.id, "mcp-update-type"));
  });

  test("keeps preset targeting when MCP applies an unrelated partial patch", async () => {
    await database.insert(schema.presetDefinitions).values({
      id: "mcp-announcement-preset",
      name: "MCP announcement preset",
      createdByUserId: "admin-a",
    });
    const handler = createAvermateMcpHandler(
      principal(
        "admin-a",
        ["avermate:read", "avermate:write", "avermate:admin"],
        "admin",
      ),
    );
    const createdResponse = await callMcp(handler, "tools/call", {
      name: "admin.announcements.create",
      arguments: {
        title: "MCP targeted original",
        message: "Targeted through MCP",
        audience: "preset",
        presetIds: ["mcp-announcement-preset"],
      },
    });
    expect(createdResponse.json.result?.isError).not.toBe(true);

    const [created] = await database
      .select()
      .from(schema.announcements)
      .where(eq(schema.announcements.title, "MCP targeted original"))
      .limit(1);
    expect(created).toMatchObject({ audience: "preset", active: true });

    const updatedResponse = await callMcp(handler, "tools/call", {
      name: "admin.announcements.update",
      arguments: {
        announcementId: created?.id,
        title: "MCP targeted renamed",
      },
    });
    expect(updatedResponse.json.result?.isError).not.toBe(true);

    const [updated] = await database
      .select()
      .from(schema.announcements)
      .where(eq(schema.announcements.id, created?.id ?? ""))
      .limit(1);
    const targets = await database
      .select({ presetId: schema.announcementPresetTargets.presetId })
      .from(schema.announcementPresetTargets)
      .where(
        eq(schema.announcementPresetTargets.announcementId, created?.id ?? ""),
      );
    expect(updated).toMatchObject({
      title: "MCP targeted renamed",
      audience: "preset",
      active: true,
    });
    expect(targets).toEqual([{ presetId: "mcp-announcement-preset" }]);

    await database
      .delete(schema.announcements)
      .where(eq(schema.announcements.id, created?.id ?? ""));
    await database
      .delete(schema.presetDefinitions)
      .where(eq(schema.presetDefinitions.id, "mcp-announcement-preset"));
  });

  test("keeps social read, manage and moderation scopes isolated", async () => {
    const legacy = await callMcp(
      createAvermateMcpHandler(principal("mcp-user", ["avermate:read"])),
      "tools/list",
    );
    const socialRead = await callMcp(
      createAvermateMcpHandler(principal("mcp-user", ["avermate:social.read"])),
      "tools/list",
    );
    const socialManage = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:social.manage"]),
      ),
      "tools/list",
    );
    const nonAdminModerate = await callMcp(
      createAvermateMcpHandler(
        principal("mcp-user", ["avermate:social.moderate"]),
      ),
      "tools/list",
    );
    const adminModerate = await callMcp(
      createAvermateMcpHandler(
        principal("admin-a", ["avermate:social.moderate"], "admin"),
      ),
      "tools/list",
    );

    expect(toolNames(legacy.json.result)).not.toContain("social.sharing");
    expect(toolNames(socialRead.json.result)).toContain("social.sharing");
    expect(toolNames(socialRead.json.result)).not.toContain(
      "social.sharing.update",
    );
    expect(toolNames(socialManage.json.result)).toContain(
      "social.sharing.update",
    );
    expect(toolNames(socialManage.json.result)).not.toContain(
      "social.moderation.overview",
    );
    expect(toolNames(nonAdminModerate.json.result)).not.toContain(
      "social.moderation.overview",
    );
    expect(toolNames(adminModerate.json.result)).toContain(
      "social.moderation.overview",
    );
    expect(toolNames(adminModerate.json.result)).not.toContain(
      "social.sharing.update",
    );
  });

  test("publishes and persists the history-sharing lock", async () => {
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:social.manage"]),
    );
    const listed = await callMcp(handler, "tools/list");
    expect(
      JSON.stringify(
        toolDefinition(listed.json.result, "social.sharing.update")
          ?.inputSchema,
      ),
    ).toContain("shareHistory");

    const enabled = await callMcp(handler, "tools/call", {
      name: "social.sharing.update",
      arguments: { shareHistory: true },
    });
    expect(enabled.json.result?.isError).not.toBe(true);
    const [profile] = await database
      .select({ shareHistory: schema.socialProfiles.shareHistory })
      .from(schema.socialProfiles)
      .where(eq(schema.socialProfiles.userId, "mcp-user"));
    expect(profile?.shareHistory).toBe(true);

    const disabled = await callMcp(handler, "tools/call", {
      name: "social.sharing.update",
      arguments: { shareHistory: false },
    });
    expect(disabled.json.result?.isError).not.toBe(true);
  });

  test("oRPC remains authoritative for user ownership", async () => {
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read"]),
    );
    const listed = await callMcp(handler, "tools/call", {
      name: "years.list",
      arguments: {},
    });
    expect(JSON.stringify(listed.json.result)).toContain("year-owned");
    expect(JSON.stringify(listed.json.result)).not.toContain("year-foreign");

    const foreign = await callMcp(handler, "tools/call", {
      name: "years.get",
      arguments: { yearId: "year-foreign" },
    });
    expect(foreign.json.result?.isError).toBe(true);
    expect(JSON.stringify(foreign.json.result)).not.toContain("Foreign year");
  });
});

describe("durable task mutation round trip", () => {
  test("approves, executes once, replays and compensates through MCP", async () => {
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read", "avermate:planner.write"]),
    );
    const taskArguments = {
      yearId: "year-owned",
      subjectId: "subject-owned",
      title: "Revise the durable ledger",
      idempotencyKey: "mcp-durable-task-round-trip",
    };

    const reservation = await callMcp(handler, "tools/call", {
      name: "planning.tasks.create",
      arguments: taskArguments,
    });
    expect(reservation.json.result?.structuredContent).toMatchObject({
      ok: false,
      error: { code: "APPROVAL_REQUIRED" },
    });
    const reservationEnvelope = reservation.json.result?.structuredContent as {
      error?: {
        actionId?: unknown;
        approvalId?: unknown;
        previewHash?: unknown;
      };
    };
    const actionId = reservationEnvelope.error?.actionId;
    const approvalId = reservationEnvelope.error?.approvalId;
    const previewHash = reservationEnvelope.error?.previewHash;
    expect(typeof actionId).toBe("string");
    expect(typeof approvalId).toBe("string");
    expect(typeof previewHash).toBe("string");
    const approvalArguments = { actionId, approvalId, previewHash };

    const approvalPrompt = await callMcp(handler, "tools/call", {
      name: "actions.resolve_approval",
      arguments: approvalArguments,
    });
    expect(approvalPrompt.json.result?.resultType).toBe("input_required");
    const approved = await callMcp(handler, "tools/call", {
      name: "actions.resolve_approval",
      arguments: approvalArguments,
      requestState: approvalPrompt.json.result?.requestState,
      inputResponses: {
        confirmation: { action: "accept", content: { confirm: true } },
      },
    });
    expect(approved.json.result?.structuredContent).toMatchObject({
      ok: true,
      data: { status: "completed" },
    });
    const taskId = (
      approved.json.result?.structuredContent as {
        data?: { resources?: Array<{ resourceId?: unknown }> };
      }
    ).data?.resources?.find(
      (resource) => typeof resource.resourceId === "string",
    )?.resourceId;
    expect(typeof taskId).toBe("string");

    const executed = await callMcp(handler, "tools/call", {
      name: "planning.tasks.create",
      arguments: taskArguments,
    });
    expect(executed.json.result?.structuredContent).toMatchObject({
      ok: true,
      data: { title: taskArguments.title, revision: 1 },
      replayed: true,
    });
    expect(
      await database
        .select()
        .from(schema.planningTasks)
        .where(eq(schema.planningTasks.id, String(taskId))),
    ).toHaveLength(1);

    const replay = await callMcp(handler, "tools/call", {
      name: "planning.tasks.create",
      arguments: taskArguments,
    });
    expect(replay.json.result?.structuredContent).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(
      await database
        .select()
        .from(schema.planningTasks)
        .where(eq(schema.planningTasks.id, String(taskId))),
    ).toHaveLength(1);

    const undoPrompt = await callMcp(handler, "tools/call", {
      name: "actions.undo_execute",
      arguments: { actionIds: [actionId] },
    });
    expect(undoPrompt.json.result?.resultType).toBe("input_required");
    const undone = await callMcp(handler, "tools/call", {
      name: "actions.undo_execute",
      arguments: { actionIds: [actionId] },
      requestState: undoPrompt.json.result?.requestState,
      inputResponses: {
        confirmation: { action: "accept", content: { confirm: true } },
      },
    });
    expect(undone.json.result?.structuredContent).toMatchObject({
      ok: true,
      data: { complete: true, partial: false },
    });
    const [trashed] = await database
      .select({ trashedAt: schema.planningTasks.trashedAt })
      .from(schema.planningTasks)
      .where(eq(schema.planningTasks.id, String(taskId)));
    expect(trashed?.trashedAt).toBeInstanceOf(Date);
  }, 30_000);
});

describe("destructive MCP multi-round trips", () => {
  test("requires signed confirmation and replays an idempotent result", async () => {
    const handler = createAvermateMcpHandler(
      principal("mcp-user", ["avermate:read", "avermate:delete"]),
    );
    const argumentsValue = {
      gradeId: "grade-to-delete",
      idempotencyKey: "cc347ecf-a506-4ef0-9548-064be64b3cce",
    };
    const first = await callMcp(handler, "tools/call", {
      name: "grades.delete",
      arguments: argumentsValue,
    });
    expect(first.json.result?.resultType).toBe("input_required");
    expect(typeof first.json.result?.requestState).toBe("string");
    expect(JSON.stringify(first.json.result?.inputRequests)).toContain(
      "irreversible",
    );
    expect(
      await database
        .select()
        .from(schema.grades)
        .where(eq(schema.grades.id, "grade-to-delete")),
    ).toHaveLength(1);

    const retryParams = {
      name: "grades.delete",
      arguments: argumentsValue,
      requestState: first.json.result?.requestState,
      inputResponses: {
        confirmation: { action: "accept", content: { confirm: true } },
      },
    };
    const confirmed = await callMcp(handler, "tools/call", retryParams);
    expect(confirmed.json.result?.resultType).toBe("complete");
    expect(confirmed.json.result?.structuredContent).toMatchObject({
      ok: true,
    });
    expect(
      await database
        .select()
        .from(schema.grades)
        .where(eq(schema.grades.id, "grade-to-delete")),
    ).toHaveLength(0);

    const replay = await callMcp(handler, "tools/call", retryParams, { id: 3 });
    expect(replay.json.result?.structuredContent).toMatchObject({
      ok: true,
      replayed: true,
    });
    expect(
      await database
        .select()
        .from(schema.mcpOperations)
        .where(
          eq(
            schema.mcpOperations.idempotencyKey,
            argumentsValue.idempotencyKey,
          ),
        ),
    ).toHaveLength(1);
  });
});

describe("OAuth 2.1 authorization-code + PKCE", () => {
  test("discovers OAuth safely and leaves deprecated DCR disabled", async () => {
    const protectedResource = await appRequest(
      "/.well-known/oauth-protected-resource/mcp",
    );
    expect(protectedResource.status).toBe(200);
    expect(await protectedResource.json()).toMatchObject({
      resource: "http://localhost:3000/mcp",
      authorization_servers: ["http://localhost:3000/api/auth"],
      bearer_methods_supported: ["header"],
    });

    const authorizationServer = await appRequest(
      "/.well-known/oauth-authorization-server/api/auth",
    );
    expect(authorizationServer.status).toBe(200);
    const metadata = (await authorizationServer.json()) as JsonObject;
    expect(metadata.issuer).toBe("http://localhost:3000/api/auth");
    expect(metadata.code_challenge_methods_supported).toContain("S256");
    expect(metadata.registration_endpoint).toBeUndefined();

    const unauthenticatedMcp = await appRequest("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        "content-type": "application/json",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "mcp-method": "server/discover",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "server/discover",
        params: { _meta: requestMeta() },
      }),
    });
    expect(unauthenticatedMcp.status).toBe(401);
    expect(unauthenticatedMcp.headers.get("www-authenticate")).toContain(
      "/.well-known/oauth-protected-resource/mcp",
    );
  });

  test("exchanges a PKCE code for a scoped JWT and calls the real MCP route", async () => {
    const jar = cookieJar();
    const signIn = await appRequest("/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://localhost:3001",
      },
      body: JSON.stringify({
        email: "mcp@example.com",
        password: TEST_PASSWORD,
      }),
    });
    jar.absorb(signIn);
    expect(signIn.status).toBe(200);
    expect(jar.header()).toContain("avermate.session_token=");

    const createClient = await appRequest("/api/auth/oauth2/create-client", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: jar.header(),
        origin: "http://localhost:3001",
      },
      body: JSON.stringify({
        client_name: "Protocol test assistant",
        redirect_uris: ["http://127.0.0.1:8787/callback"],
        token_endpoint_auth_method: "none",
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        application_type: "native",
        resources: ["http://localhost:3000/mcp"],
        scope:
          "openid profile offline_access avermate:read avermate:write avermate:delete",
      }),
    });
    jar.absorb(createClient);
    expect(createClient.status).toBe(201);
    const client = (await createClient.json()) as { client_id: string };
    expect(client.client_id).toBeString();

    const verifier =
      "pkce-verifier-with-more-than-forty-three-characters-123456";
    const challengeBytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier),
    );
    const challenge = Buffer.from(challengeBytes).toString("base64url");
    async function authorizeCode(state: string): Promise<string> {
      const authorizeQuery = new URLSearchParams({
        response_type: "code",
        client_id: client.client_id,
        redirect_uri: "http://127.0.0.1:8787/callback",
        scope:
          "openid profile offline_access avermate:read avermate:write avermate:delete",
        state,
        nonce: `nonce-${state}`,
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: "http://localhost:3000/mcp",
        prompt: "consent",
      });
      const authorize = await appRequest(
        `/api/auth/oauth2/authorize?${authorizeQuery}`,
        {
          headers: {
            accept: "text/html",
            cookie: jar.header(),
            origin: "http://localhost:3001",
          },
        },
      );
      jar.absorb(authorize);
      expect(authorize.status).toBeGreaterThanOrEqual(300);
      expect(authorize.status).toBeLessThan(400);
      const consentLocation = authorize.headers.get("location");
      expect(consentLocation).toStartWith(
        "http://localhost:3001/auth/consent?",
      );
      const oauthQuery = new URL(consentLocation as string).search.slice(1);

      const consent = await appRequest("/api/auth/oauth2/consent", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          cookie: jar.header(),
          origin: "http://localhost:3001",
        },
        body: JSON.stringify({ accept: true, oauth_query: oauthQuery }),
      });
      jar.absorb(consent);
      expect(consent.status).toBe(200);
      const consentBody = (await consent.json()) as {
        redirect: boolean;
        url: string;
      };
      expect(consentBody.redirect).toBe(true);
      const authorizationResult = new URL(consentBody.url);
      expect(authorizationResult.origin).toBe("http://127.0.0.1:8787");
      expect(authorizationResult.searchParams.get("state")).toBe(state);
      const code = authorizationResult.searchParams.get("code");
      expect(code).toBeString();
      return code as string;
    }

    const wrongCode = await authorizeCode("wrong-verifier-state");

    const wrongVerifier = await appRequest("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: wrongCode,
        code_verifier: `${verifier}-wrong`,
        redirect_uri: "http://127.0.0.1:8787/callback",
        resource: "http://localhost:3000/mcp",
      }),
    });
    expect(wrongVerifier.status).toBe(400);
    expect(await wrongVerifier.json()).toMatchObject({
      error: "invalid_request",
    });

    const code = await authorizeCode("opaque-test-state");
    const tokenResponse = await appRequest("/api/auth/oauth2/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: client.client_id,
        code: code as string,
        code_verifier: verifier,
        redirect_uri: "http://127.0.0.1:8787/callback",
        resource: "http://localhost:3000/mcp",
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as {
      access_token: string;
      refresh_token?: string;
      scope: string;
      token_type: string;
    };
    expect(tokens.token_type.toLowerCase()).toBe("bearer");
    expect(tokens.access_token.split(".")).toHaveLength(3);
    expect(tokens.refresh_token).toBeString();
    expect(tokens.scope.split(" ")).toContain("avermate:read");

    const mcp = await appRequest("/mcp", {
      method: "POST",
      headers: {
        accept: "application/json, text/event-stream",
        authorization: `Bearer ${tokens.access_token}`,
        "content-type": "application/json",
        "mcp-protocol-version": PROTOCOL_VERSION,
        "mcp-method": "server/discover",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 99,
        method: "server/discover",
        params: { _meta: requestMeta() },
      }),
    });
    expect(mcp.status).toBe(200);
    const mcpBody = (await mcp.json()) as JsonRpcResponse;
    expect(mcpBody.error).toBeUndefined();
    expect(mcpBody.result?.resultType).toBe("complete");
  });
});
