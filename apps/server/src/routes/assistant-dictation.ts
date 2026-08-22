import { Hono } from "hono";
import { isSuspensionActive } from "../lib/access-policy";
import { auth } from "../lib/auth";
import {
  MAX_TRANSCRIPTION_AUDIO_BYTES,
  MISTRAL_TRANSCRIPTION_MODEL,
  resolveTranscriptionProvider,
} from "../lib/transcription";

const acceptedAudio = new Set([
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/m4a",
  "audio/mpeg",
  "audio/wav",
  "audio/x-wav",
]);
const activeByUser = new Map<string, number>();

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

export const assistantDictationRoutes = new Hono();

assistantDictationRoutes.post("/assistant/dictation", async (context) => {
  const user = await authenticatedUser(context.req.raw.headers);
  if (!user) return context.json({ error: "Authentication required" }, 401);
  const declared = Number(context.req.header("content-length"));
  if (
    Number.isFinite(declared) &&
    declared > MAX_TRANSCRIPTION_AUDIO_BYTES + 512 * 1024
  ) {
    return context.json({ error: "Audio exceeds 32 MiB" }, 413);
  }
  if ((activeByUser.get(user.id) ?? 0) >= 1) {
    return context.json(
      { error: "A dictation is already being transcribed" },
      429,
    );
  }
  const form = await context.req.formData().catch(() => null);
  const audio = form?.get("audio");
  if (!(audio instanceof File)) {
    return context.json({ error: "Multipart field 'audio' is required" }, 400);
  }
  if (audio.size <= 0 || audio.size > MAX_TRANSCRIPTION_AUDIO_BYTES) {
    return context.json(
      { error: "Audio must be between 1 byte and 32 MiB" },
      413,
    );
  }
  const mimeType = audio.type.split(";", 1)[0]!.trim().toLowerCase();
  if (!acceptedAudio.has(mimeType)) {
    return context.json({ error: "Unsupported audio format" }, 415);
  }
  activeByUser.set(user.id, 1);
  try {
    const provider = await resolveTranscriptionProvider(user.id, {
      signal: context.req.raw.signal,
    });
    const result = await provider.transcribeSegment({
      blob: audio,
      mimeType,
      signal: context.req.raw.signal,
    });
    context.header("Cache-Control", "private, no-store");
    return context.json({
      text: result.text,
      provider: provider.id,
      model: MISTRAL_TRANSCRIPTION_MODEL,
      language: result.language ?? null,
    });
  } catch (error) {
    return context.json(
      {
        error:
          error instanceof Error
            ? error.message.slice(0, 500)
            : "Dictation transcription failed",
      },
      502,
    );
  } finally {
    activeByUser.delete(user.id);
  }
});
