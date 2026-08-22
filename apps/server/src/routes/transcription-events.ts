import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { isSuspensionActive } from "../lib/access-policy";
import { auth } from "../lib/auth";
import { getTranscriptionBatchProgress } from "../routers/materials/documents";

const STREAM_INTERVAL_MS = 1_000;
const MAX_STREAMS_PER_USER = 3;
const activeStreamsByUser = new Map<string, number>();

function isActive(status: string) {
  return status === "running";
}

function reserveStream(userId: string) {
  const active = activeStreamsByUser.get(userId) ?? 0;
  if (active >= MAX_STREAMS_PER_USER) return null;
  activeStreamsByUser.set(userId, active + 1);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const remaining = (activeStreamsByUser.get(userId) ?? 1) - 1;
    if (remaining > 0) activeStreamsByUser.set(userId, remaining);
    else activeStreamsByUser.delete(userId);
  };
}

export const transcriptionEventRoutes = new Hono();

transcriptionEventRoutes.get(
  "/materials/transcription-batches/:batchId/events",
  async (context) => {
    const session = await auth.api.getSession({
      headers: context.req.raw.headers,
    });
    if (!session || !session.user.emailVerified) {
      return context.json({ error: "Authentication required" }, 401);
    }
    if (isSuspensionActive(session.user)) {
      return context.json({ error: "This account is suspended" }, 403);
    }

    const batchId = context.req.param("batchId");
    const releaseStream = reserveStream(session.user.id);
    if (!releaseStream) {
      return context.json({ error: "Too many progress streams" }, 429);
    }
    let initial;
    try {
      initial = await getTranscriptionBatchProgress(session.user.id, batchId);
    } catch (error) {
      releaseStream();
      throw error;
    }
    if (!initial) {
      releaseStream();
      return context.json({ error: "Batch not found" }, 404);
    }

    context.header("X-Accel-Buffering", "no");
    try {
      return streamSSE(
        context,
        async (stream) => {
          try {
            let progress = initial;
            while (!stream.aborted) {
              await stream.writeSSE({
                event: "progress",
                id: `${batchId}:${progress.processed}:${progress.running}:${progress.queued}`,
                data: JSON.stringify(progress),
              });
              if (!isActive(progress.status)) return;
              await stream.sleep(STREAM_INTERVAL_MS);
              const next = await getTranscriptionBatchProgress(
                session.user.id,
                batchId,
              );
              if (!next) return;
              progress = next;
            }
          } finally {
            releaseStream();
          }
        },
        async (error, stream) => {
          releaseStream();
          console.error("[ocr.batch] SSE stream failed", error);
          await stream.writeSSE({
            event: "stream-error",
            data: JSON.stringify({ message: "Progress stream interrupted" }),
          });
        },
      );
    } catch (error) {
      releaseStream();
      throw error;
    }
  },
);
