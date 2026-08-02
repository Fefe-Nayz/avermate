import { RPCHandler } from "@orpc/server/fetch";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { auth } from "./lib/auth";
import { createContext } from "./lib/context";
import { env, isProduction } from "./lib/env";
import { resolveOrigin } from "./lib/origins";
import { appRouter } from "./routers";

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
    allowHeaders: ["Content-Type", "Authorization", "x-orpc-batch"],
    allowMethods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true }));

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

const handler = new RPCHandler(appRouter);

app.use("/rpc/*", async (c, next) => {
  const { matched, response } = await handler.handle(c.req.raw, {
    prefix: "/rpc",
    context: await createContext(c),
  });
  if (matched) return c.newResponse(response.body, response);
  await next();
});

app.notFound((c) => c.json({ error: "Not found" }, 404));

export default {
  port: env.PORT,
  // Every interface, so a phone on the same network can reach the API. Bun
  // does this by default; saying so keeps it from depending on that default.
  hostname: "0.0.0.0",
  fetch: app.fetch,
};
