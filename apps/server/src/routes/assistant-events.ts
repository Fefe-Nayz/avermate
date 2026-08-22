import { z } from "zod";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { coreConversationStore } from "../assistant/services";
import { isSuspensionActive } from "../lib/access-policy";
import { auth } from "../lib/auth";

const MAX_STREAMS_PER_USER = 4;
const MAX_STREAMS_PER_RUN = 2;
const activeByUser = new Map<string, number>();
const activeByRun = new Map<string, number>();

function parseCursor(request: Request, explicit?: string) {
  const raw = explicit ?? request.headers.get("last-event-id") ?? "0";
  const parsed = z.coerce.number().int().nonnegative().safeParse(raw);
  return parsed.success ? parsed.data : null;
}

function reserveStream(userId: string, runId: string) {
  const user = activeByUser.get(userId) ?? 0;
  const run = activeByRun.get(runId) ?? 0;
  if (user >= MAX_STREAMS_PER_USER || run >= MAX_STREAMS_PER_RUN) return null;
  activeByUser.set(userId, user + 1);
  activeByRun.set(runId, run + 1);
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const nextUser = (activeByUser.get(userId) ?? 1) - 1;
    const nextRun = (activeByRun.get(runId) ?? 1) - 1;
    if (nextUser) activeByUser.set(userId, nextUser);
    else activeByUser.delete(userId);
    if (nextRun) activeByRun.set(runId, nextRun);
    else activeByRun.delete(runId);
  };
}

async function authenticatedUser(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (
    !session ||
    !session.user.emailVerified ||
    isSuspensionActive(session.user)
  ) {
    return null;
  }
  return session.user;
}

export const assistantEventRoutes = new Hono();

assistantEventRoutes.get("/assistant/runs/:runId/events", async (context) => {
  const user = await authenticatedUser(context.req.raw.headers);
  if (!user) return context.json({ error: "Authentication required" }, 401);
  const runId = context.req.param("runId");
  const cursor = parseCursor(context.req.raw, context.req.query("cursor"));
  if (cursor === null) return context.json({ error: "Invalid cursor" }, 400);
  const run = await coreConversationStore.run(user.id, runId).catch(() => null);
  if (!run) return context.json({ error: "Run not found" }, 404);
  const release = reserveStream(user.id, runId);
  if (!release)
    return context.json({ error: "Too many assistant streams" }, 429);

  context.header("Cache-Control", "private, no-store, no-transform");
  context.header("X-Accel-Buffering", "no");
  try {
    return streamSSE(
      context,
      async (stream) => {
        let afterSequence = cursor;
        let heartbeatAt = Date.now();
        try {
          while (!stream.aborted) {
            const events = await coreConversationStore.replayEvents({
              ownerId: user.id,
              runId,
              afterSequence,
              limit: 250,
            });
            for (const event of events) {
              afterSequence = event.sequence;
              await stream.writeSSE({
                event: "assistant-event",
                id: String(event.sequence),
                data: JSON.stringify(event),
              });
              if (event.terminal) return;
            }
            const latest = await coreConversationStore.run(user.id, runId);
            if (["complete", "failed", "cancelled"].includes(latest.status)) {
              return;
            }
            if (Date.now() - heartbeatAt >= 15_000) {
              await stream.write(": heartbeat\n\n");
              heartbeatAt = Date.now();
            }
            await new Promise((resolve) => setTimeout(resolve, 350));
          }
        } finally {
          release();
        }
      },
      async (_error, stream) => {
        release();
        await stream.writeSSE({
          event: "stream-error",
          data: JSON.stringify({ code: "assistant_stream_interrupted" }),
        });
      },
    );
  } catch (error) {
    release();
    throw error;
  }
});

export const assistantEventRouteInternals = { parseCursor, reserveStream };
