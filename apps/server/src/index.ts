import { RPCHandler } from "@orpc/server/fetch";
import { createRouterClient } from "@orpc/server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { auth } from "./lib/auth";
import {
  oauthProviderAuthServerMetadata,
  oauthProviderOpenIdConfigMetadata,
} from "@better-auth/oauth-provider";
import { createContext } from "./lib/context";
import { compressRpcJson } from "./lib/compression";
import { env, isProduction } from "./lib/env";
import { resolveOrigin } from "./lib/origins";
import { appRouter } from "./routers";
import { handleMcp, protectedResourceMetadataResponse } from "./mcp/http";
import {
  registerAllJobHandlers,
  scheduleDailyMaintenanceJobs,
} from "./jobs/handlers";
import { startJobRunner } from "./lib/jobs";
import { uploadRoutes } from "./routes/uploads";
import { transcriptionEventRoutes } from "./routes/transcription-events";
import { graphWebhookRoutes } from "./routes/graph-webhooks";
import { googleDriveWebhookRoutes } from "./routes/google-drive-webhooks";
import { agentEventRoutes } from "./routes/agent-events";
import { fileHandleRoutes } from "./routes/file-handles";
import { assistantEventRoutes } from "./routes/assistant-events";
import { assistantDictationRoutes } from "./routes/assistant-dictation";
import { db } from "./db";
import { guardMicrosoftIdentityWrite } from "./lib/microsoft-identity-guard";
import {
  actionLedgerService,
  startActionApprovalSweeper,
} from "./actions/services";
import { recoverInterruptedActions } from "./actions/action-recovery";
import { assistantRunService } from "./assistant/services";
import { createFirstPartyToolBroker } from "./tools/first-party";
import { fileHandleService } from "./routes/file-handles";
import type { Api } from "./mcp/shared";
import type { Context, Session } from "./lib/context";
import { createCustomMcpDescriptors } from "./assistant/custom-mcp-tools";
import { managedReadiness } from "./operations/readiness";
import { managedToolActionContinuationStore } from "./tools/managed-action-continuation";

const app = new Hono();

async function createOwnerRecoveryApi(
  ownerId: string,
  purpose: "assistant" | "action",
): Promise<Api> {
  const user = (
    await db.$client.execute({
      sql: "SELECT * FROM users WHERE id = ? LIMIT 1",
      args: [ownerId],
    })
  ).rows[0];
  if (!user) throw new Error("Interrupted operation owner no longer exists");
  const now = new Date();
  const context: Context = {
    headers: new Headers({
      "x-avermate-internal": `${purpose}-recovery`,
    }),
    session: {
      // Recovery is an in-process, owner-bound path. It never mints a reusable
      // cookie or bearer token and cannot be reached over HTTP.
      user: {
        ...user,
        id: ownerId,
        emailVerified: Boolean(user.emailVerified),
        createdAt: new Date(Number(user.createdAt) * 1_000),
        updatedAt: new Date(Number(user.updatedAt) * 1_000),
      },
      session: {
        id: `recovery:${crypto.randomUUID()}`,
        userId: ownerId,
        token: `internal:${crypto.randomUUID()}`,
        expiresAt: new Date(now.getTime() + 5 * 60_000),
        createdAt: now,
        updatedAt: now,
        ipAddress: null,
        userAgent: `avermate-${purpose}-recovery`,
      },
    } as unknown as Session,
  };
  return createRouterClient(appRouter, { context }) as Api;
}

if (!isProduction) app.use(logger());

app.use(
  "*",
  cors({
    // A function rather than a fixed string: in development the app is also
    // reachable at the machine's LAN address, and the echoed origin has to
    // match the one the browser sent for credentialed requests to work.
    origin: (origin) => resolveOrigin(origin),
    credentials: true,
    allowHeaders: [
      "Content-Type",
      "Authorization",
      "Last-Event-ID",
      "x-orpc-batch",
      "MCP-Protocol-Version",
      "Mcp-Method",
      "Mcp-Name",
    ],
    allowMethods: ["GET", "HEAD", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));
app.get("/ready", async (c) => {
  const result = await managedReadiness(db.$client);
  return c.json(result, result.ready ? 200 : 503);
});

const authorizationServerMetadata = oauthProviderAuthServerMetadata(auth);
const openIdMetadata = oauthProviderOpenIdConfigMetadata(auth);

// RFC 8414's path-insertion form is canonical for the /api/auth issuer. The
// root aliases help OAuth clients that still probe the resource origin first.
app.get("/.well-known/oauth-authorization-server/api/auth", (c) =>
  authorizationServerMetadata(c.req.raw),
);
app.get("/.well-known/oauth-authorization-server", (c) =>
  authorizationServerMetadata(c.req.raw),
);
app.get("/.well-known/openid-configuration/api/auth", (c) =>
  openIdMetadata(c.req.raw),
);
app.get("/.well-known/openid-configuration", (c) => openIdMetadata(c.req.raw));
app.get("/.well-known/oauth-protected-resource/mcp", () =>
  protectedResourceMetadataResponse(),
);

app.post("/mcp", (c) => handleMcp(c.req.raw));
app.on(["GET", "PUT", "PATCH", "DELETE"], "/mcp", (c) => {
  c.header("Allow", "POST, OPTIONS");
  return c.json({ error: "method_not_allowed" }, 405);
});

app.on(["GET", "POST"], "/api/auth/*", async (c) => {
  const identityGuard = await guardMicrosoftIdentityWrite(
    c.req.raw,
    db.$client,
  );
  if (identityGuard) return identityGuard;

  const response = await auth.handler(c.req.raw);

  // OAuth token errors are JSON protocol responses, not authentication
  // challenges. RFC 6749 reserves HTTP 401 for `invalid_client`; Better Auth
  // 1.6.26 also uses it for invalid grants/verifiers, so normalize those to
  // the required 400 without changing the stable provider implementation.
  if (c.req.path === "/api/auth/oauth2/token" && response.status === 401) {
    // SAFETY: this optional protocol field is only used after a successful
    // JSON parse and is never treated as a complete OAuth error envelope.
    const body = (await response
      .clone()
      .json()
      .catch(() => null)) as {
      error?: string;
    } | null;
    if (body?.error && body.error !== "invalid_client") {
      const headers = new Headers(response.headers);
      headers.delete("www-authenticate");
      return new Response(response.body, { status: 400, headers });
    }
  }

  return response;
});

app.route("/api", uploadRoutes);
app.route("/api", transcriptionEventRoutes);
app.route("/api", graphWebhookRoutes);
app.route("/api", googleDriveWebhookRoutes);
app.route("/api", agentEventRoutes);
app.route("/api", fileHandleRoutes);
app.route("/api", assistantEventRoutes);
app.route("/api", assistantDictationRoutes);

const handler = new RPCHandler(appRouter);

app.use("/rpc/*", compressRpcJson());

app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: "/rpc",
    context: await createContext(c),
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

registerAllJobHandlers();
startActionApprovalSweeper();
void recoverInterruptedActions({
  ledger: actionLedgerService(),
  continuations: managedToolActionContinuationStore,
  brokerForOwner: async (ownerId) =>
    createFirstPartyToolBroker(
      await createOwnerRecoveryApi(ownerId, "action"),
      {
        fileHandles: fileHandleService,
        ownerId,
        includeMutations: true,
        continuations: managedToolActionContinuationStore,
      },
    ),
})
  .then((result) => {
    const count =
      result.resumed.length +
      result.inspectRequired.length +
      result.failed.length +
      result.deferred.length;
    if (count > 0) {
      console.info("[actions] interrupted executions reconciled", result);
    }
  })
  .catch((error) =>
    console.error("[actions] interrupted execution reconciliation failed", error),
  );
void assistantRunService
  .recoverInterrupted(async (ownerId) => {
    const api = await createOwnerRecoveryApi(ownerId, "assistant");
    const broker = createFirstPartyToolBroker(api, {
      fileHandles: fileHandleService,
      ownerId,
      includeMutations: false,
    });
    for (const descriptor of await createCustomMcpDescriptors(ownerId)) {
      broker.registry.register(descriptor);
    }
    return broker;
  })
  .then((result) => {
    const count =
      result.resumed.length +
      result.finalizedFromCheckpoint.length +
      result.failedClosed.length;
    if (count > 0) {
      console.info("[assistant] interrupted runs reconciled", {
        resumed: result.resumed.length,
        finalizedFromCheckpoint: result.finalizedFromCheckpoint.length,
        failedClosed: result.failedClosed.length,
      });
    }
  })
  .catch((error) =>
    console.error("[assistant] interrupted run reconciliation failed", error),
  );
if (!env.DISABLE_JOBS) {
  void scheduleDailyMaintenanceJobs().catch((error) =>
    console.error("[jobs] maintenance scheduling failed", error),
  );
  startJobRunner({ instanceId: crypto.randomUUID() });
}

export default {
  port: env.PORT,
  // Every interface, so a phone on the same network can reach the API. Bun
  // does this by default; saying so keeps it from depending on that default.
  hostname: "0.0.0.0",
  fetch: app.fetch,
};
