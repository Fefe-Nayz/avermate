import { RPCHandler } from "@orpc/server/fetch";
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

const app = new Hono();

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
  const response = await auth.handler(c.req.raw);

  // OAuth token errors are JSON protocol responses, not authentication
  // challenges. RFC 6749 reserves HTTP 401 for `invalid_client`; Better Auth
  // 1.6.26 also uses it for invalid grants/verifiers, so normalize those to
  // the required 400 without changing the stable provider implementation.
  if (c.req.path === "/api/auth/oauth2/token" && response.status === 401) {
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
