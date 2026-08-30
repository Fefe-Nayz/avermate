import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { isSuspensionActive } from "../lib/access-policy";
import { auth } from "../lib/auth";
import {
  MAX_TRANSCRIPTION_AUDIO_BYTES,
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
  // Bun's multipart parser can normalize an audio-only .webm File to the
  // container MIME type. The provider still receives the bounded bytes and
  // validates/decodes the actual media stream.
  "video/webm",
]);
const activeByUser = new Map<string, number>();
const MAX_DICTATION_MULTIPART_BYTES =
  MAX_TRANSCRIPTION_AUDIO_BYTES + 512 * 1024;

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

type DictationUser = { id: string };

export interface AssistantDictationRouteDependencies {
  authenticate?: (headers: Headers) => Promise<DictationUser | null>;
  resolveProvider?: typeof resolveTranscriptionProvider;
  maximumMultipartBytes?: number;
}

export function createAssistantDictationRoutes(
  dependencies: AssistantDictationRouteDependencies = {},
) {
  const routes = new Hono();
  const authenticate = dependencies.authenticate ?? authenticatedUser;
  const resolveProvider =
    dependencies.resolveProvider ?? resolveTranscriptionProvider;
  const maximumMultipartBytes =
    dependencies.maximumMultipartBytes ?? MAX_DICTATION_MULTIPART_BYTES;

  routes.use(
    "/assistant/dictation",
    bodyLimit({
      maxSize: maximumMultipartBytes,
      onError: (context) =>
        context.json({ error: "Audio exceeds 32 MiB" }, 413),
    }),
  );

  routes.post("/assistant/dictation", async (context) => {
    const user = await authenticate(context.req.raw.headers);
    if (!user) return context.json({ error: "Authentication required" }, 401);
    const declared = Number(context.req.header("content-length"));
    if (Number.isFinite(declared) && declared > maximumMultipartBytes) {
      return context.json({ error: "Audio exceeds 32 MiB" }, 413);
    }
    if ((activeByUser.get(user.id) ?? 0) >= 1) {
      return context.json(
        { error: "A dictation is already being transcribed" },
        429,
      );
    }
    activeByUser.set(user.id, 1);
    try {
      const form = await context.req.formData().catch(() => null);
      const audio = form?.get("audio");
      if (!(audio instanceof File)) {
        return context.json(
          { error: "Multipart field 'audio' is required" },
          400,
        );
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
      const provider = await resolveProvider(user.id, {
        signal: context.req.raw.signal,
        purpose: "assistant.dictation",
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
        model: provider.model,
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

  return routes;
}

export const assistantDictationRoutes = createAssistantDictationRoutes();
