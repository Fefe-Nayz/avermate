import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

process.env.DATABASE_URL = "file::memory:";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.BETTER_AUTH_SECRET = "mcp-protocol-test-secret-that-is-long-enough";
process.env.CLIENT_URL = "http://localhost:3001";
process.env.MCP_RESOURCE_URL = "http://localhost:3000/mcp";
process.env.MCP_REQUEST_STATE_SECRET =
  "mcp-request-state-test-secret-that-is-long-enough";
process.env.MCP_ENABLE_DCR = "false";
process.env.NODE_ENV = "test";
process.env.DISABLE_EMAIL = "true";
process.env.DISABLE_FEEDBACK = "true";
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
  ({ createAvermateMcpHandler } = await import("./http"));
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
}, 30_000);

afterAll(async () => {
  database.$client.close();
});

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

    expect(toolNames(legacy.json.result)).not.toContain("social.eligibility");
    expect(toolNames(socialRead.json.result)).toContain("social.eligibility");
    expect(toolNames(socialRead.json.result)).not.toContain(
      "social.profile.update",
    );
    expect(toolNames(socialManage.json.result)).toContain(
      "social.profile.update",
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
      "social.profile.update",
    );
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
        type: "native",
        scope:
          "openid profile offline_access avermate:read avermate:write avermate:delete",
      }),
    });
    jar.absorb(createClient);
    expect(createClient.status).toBe(200);
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
