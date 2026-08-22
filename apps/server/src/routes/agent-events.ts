import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { z } from "zod";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { isSuspensionActive } from "../lib/access-policy";
import { auth } from "../lib/auth";
import { isProduction } from "../lib/env";
import { SqliteConversationStore } from "../agent/conversation-store";
import { ScriptedAgentRunService } from "../agent/scripted-run";

const MAX_STREAMS_PER_USER = 3;
const MAX_STREAMS_PER_RUN = 2;
const activeStreamsByUser = new Map<string, number>();
const activeStreamsByRun = new Map<string, number>();

const startRunSchema = z.strictObject({
  threadId: z.string().min(1).max(256),
  branchId: z.string().min(1).max(256),
  runId: z.string().min(1).max(256).optional(),
});

let singleton:
  | { store: SqliteConversationStore; service: ScriptedAgentRunService }
  | undefined;

function services() {
  if (singleton) return singleton;
  const path = resolve(
    process.env.AGENT_SPIKE_DB_PATH ?? ".data/agent-spike.sqlite",
  );
  mkdirSync(dirname(path), { recursive: true });
  const store = new SqliteConversationStore(path);
  singleton = { store, service: new ScriptedAgentRunService(store) };
  return singleton;
}

function parseCursor(
  request: Request,
  explicit: string | undefined,
): number | null {
  const raw = explicit ?? request.headers.get("last-event-id") ?? "0";
  if (!/^\d+$/.test(raw)) return null;
  const cursor = Number(raw);
  return Number.isSafeInteger(cursor) && cursor >= 0 ? cursor : null;
}

function reserveStream(userId: string, runId: string): (() => void) | null {
  const userCount = activeStreamsByUser.get(userId) ?? 0;
  const runCount = activeStreamsByRun.get(runId) ?? 0;
  if (userCount >= MAX_STREAMS_PER_USER || runCount >= MAX_STREAMS_PER_RUN) {
    return null;
  }
  activeStreamsByUser.set(userId, userCount + 1);
  activeStreamsByRun.set(runId, runCount + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const nextUser = (activeStreamsByUser.get(userId) ?? 1) - 1;
    const nextRun = (activeStreamsByRun.get(runId) ?? 1) - 1;
    if (nextUser > 0) activeStreamsByUser.set(userId, nextUser);
    else activeStreamsByUser.delete(userId);
    if (nextRun > 0) activeStreamsByRun.set(runId, nextRun);
    else activeStreamsByRun.delete(runId);
  };
}

async function authenticatedUser(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session || !session.user.emailVerified) return null;
  if (isSuspensionActive(session.user)) return null;
  return session.user;
}

export const agentEventRoutes = new Hono();

agentEventRoutes.use("/agent-spike/*", async (context, next) => {
  if (isProduction) return context.notFound();
  await next();
});

agentEventRoutes.post("/agent-spike/scripted-runs", async (context) => {
  const user = await authenticatedUser(context.req.raw.headers);
  if (!user) return context.json({ error: "Authentication required" }, 401);
  const parsed = startRunSchema.safeParse(
    await context.req.json().catch(() => null),
  );
  if (!parsed.success) return context.json({ error: "Invalid run input" }, 400);

  const runId = parsed.data.runId ?? crypto.randomUUID();
  const { service } = services();
  const run = service.start({
    ownerId: user.id,
    threadId: parsed.data.threadId,
    branchId: parsed.data.branchId,
    runId,
  });
  return context.json({ run }, 202);
});

agentEventRoutes.get(
  "/agent-spike/runs/:runId/events/poll",
  async (context) => {
    const user = await authenticatedUser(context.req.raw.headers);
    if (!user) return context.json({ error: "Authentication required" }, 401);
    const cursor = parseCursor(context.req.raw, context.req.query("cursor"));
    if (cursor === null) return context.json({ error: "Invalid cursor" }, 400);

    const { store } = services();
    const run = store.getRunForOwner(user.id, context.req.param("runId"));
    if (!run) return context.json({ error: "Run not found" }, 404);
    const events = [];
    for await (const event of store.replayEvents({
      ownerId: user.id,
      threadId: run.threadId,
      branchId: run.branchId,
      runId: run.runId,
      afterSequence: cursor,
      limit: 250,
    })) {
      events.push(event);
    }
    const nextCursor = events.at(-1)?.sequence ?? cursor;
    return context.json({
      events,
      nextCursor,
      terminal: Boolean(run.terminalEventId) && nextCursor >= run.lastSequence,
    });
  },
);

agentEventRoutes.get("/agent-spike/runs/:runId/events", async (context) => {
  const user = await authenticatedUser(context.req.raw.headers);
  if (!user) return context.json({ error: "Authentication required" }, 401);
  const cursor = parseCursor(context.req.raw, context.req.query("cursor"));
  if (cursor === null) return context.json({ error: "Invalid cursor" }, 400);

  const { store } = services();
  const run = store.getRunForOwner(user.id, context.req.param("runId"));
  if (!run) return context.json({ error: "Run not found" }, 404);
  const release = reserveStream(user.id, run.runId);
  if (!release) return context.json({ error: "Too many agent streams" }, 429);

  context.header("Cache-Control", "no-store, no-transform");
  context.header("X-Accel-Buffering", "no");
  try {
    return streamSSE(
      context,
      async (stream) => {
        let afterSequence = cursor;
        try {
          while (!stream.aborted) {
            let wroteEvent = false;
            for await (const event of store.replayEvents({
              ownerId: user.id,
              threadId: run.threadId,
              branchId: run.branchId,
              runId: run.runId,
              afterSequence,
              limit: 250,
            })) {
              wroteEvent = true;
              afterSequence = event.sequence;
              await stream.writeSSE({
                // One transport event name keeps the SSE reader forward
                // compatible. The durable semantic type lives in the
                // versioned envelope and can therefore be ignored safely.
                event: "agent-event",
                id: String(event.sequence),
                data: JSON.stringify(event),
              });
              if (event.terminal) return;
            }

            const latest = store.getRunForOwner(user.id, run.runId);
            if (
              !latest ||
              (latest.terminalEventId && afterSequence >= latest.lastSequence)
            ) {
              return;
            }
            if (!wroteEvent) {
              const outcome = await store.waitForChange(run.runId, {
                signal: context.req.raw.signal,
                timeoutMs: 15_000,
              });
              if (outcome === "timeout") await stream.write(": heartbeat\n\n");
            }
          }
        } finally {
          release();
        }
      },
      async (_error, stream) => {
        release();
        await stream.writeSSE({
          event: "stream-error",
          data: JSON.stringify({ code: "agent_stream_interrupted" }),
        });
      },
    );
  } catch (error) {
    release();
    throw error;
  }
});

export const agentEventRouteInternals = {
  parseCursor,
  reserveStream,
};
