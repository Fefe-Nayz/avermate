import { env } from "./env";
import {
  markServiceKeyInvalid,
  resolveServiceKey,
  type ResolvedServiceKey,
} from "./service-keys";

/** Official Mistral Voxtral TTS request contract. */
export const MISTRAL_SPEECH_URL = "https://api.mistral.ai/v1/audio/speech";
export const DEFAULT_MISTRAL_SPEECH_MODEL = "voxtral-mini-tts-2603";
export const SPEECH_CHUNK_MAX_CHARS = 3_500;
export const SPEECH_MAX_CHUNKS = 32;
export const SPEECH_MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const MAX_PROVIDER_RESPONSE_BYTES = 20 * 1024 * 1024;
const ATTEMPT_TIMEOUT_MS = 2 * 60 * 1_000;
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 4;

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface MistralSpeechResult {
  audio: Uint8Array;
  mimeType: "audio/mpeg";
  model: string;
  voiceId: string | null;
  chunkCount: number;
  characterCount: number;
}

export interface MistralSpeechOptions {
  fetch?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Test seam. Production resolves the sealed user key, then operator key. */
  key?: string;
  model?: string;
  voiceId?: string | null;
  signal?: AbortSignal;
  attemptTimeoutMs?: number;
}

function ttsDisabled() {
  const runtime = process.env.DISABLE_TTS;
  return env.DISABLE_TTS || runtime === "true" || runtime === "1";
}

export async function textToSpeechEnabled(userId?: string) {
  if (ttsDisabled() || env.TTS_PROVIDER !== "mistral") return false;
  if (!userId) return Boolean(env.MISTRAL_API_KEY?.trim());
  return Boolean(await resolveServiceKey(userId, "mistral"));
}

function abortReason(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Podcast generation was cancelled");
}

function attemptSignal(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutError = new Error("Mistral speech request timed out");
  const abortFromParent = () => controller.abort(abortReason(parent));
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

async function boundedText(response: Response, signal?: AbortSignal) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_PROVIDER_RESPONSE_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Mistral speech response is larger than 20 MiB");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let output = "";
  try {
    while (true) {
      if (signal?.aborted) throw abortReason(signal);
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_PROVIDER_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Mistral speech response is larger than 20 MiB");
      }
      output += decoder.decode(part.value, { stream: true });
    }
    return output + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function providerMessage(status: number, body: string, secret: string) {
  let detail = "";
  try {
    const parsed = JSON.parse(body) as {
      detail?: unknown;
      message?: unknown;
      error?: { message?: unknown };
    };
    const candidate = parsed.detail ?? parsed.message ?? parsed.error?.message;
    detail = typeof candidate === "string" ? candidate : "";
  } catch {
    detail = body;
  }
  const safe = detail.replaceAll(secret, "[redacted]").trim().slice(0, 300);
  return safe
    ? `Mistral speech returned ${status}: ${safe}`
    : `Mistral speech returned ${status}`;
}

function credentialForTests(key: string): ResolvedServiceKey {
  return { key, source: "operator" };
}

function hardChunks(value: string, maxChars: number) {
  const points = Array.from(value);
  const output: string[] = [];
  for (let offset = 0; offset < points.length; offset += maxChars) {
    output.push(points.slice(offset, offset + maxChars).join(""));
  }
  return output;
}

/** Sentence-aware chunks keep speech natural while bounding provider cost. */
export function splitSpeechText(
  rawText: string,
  maxChars = SPEECH_CHUNK_MAX_CHARS,
) {
  const text = rawText.replace(/\s+/g, " ").trim();
  if (!text) return [];
  if (!Number.isInteger(maxChars) || maxChars < 100) {
    throw new Error("Speech chunks must be at least 100 characters");
  }
  const sentences = text.split(/(?<=[.!?…])\s+/u);
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };
  for (const sentence of sentences) {
    if (Array.from(sentence).length > maxChars) {
      flush();
      chunks.push(...hardChunks(sentence, maxChars));
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (Array.from(candidate).length <= maxChars) current = candidate;
    else {
      flush();
      current = sentence;
    }
  }
  flush();
  return chunks;
}

function decodeAudioData(value: unknown) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > Math.ceil((MAX_PROVIDER_RESPONSE_BYTES * 4) / 3) + 8 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(value)
  ) {
    throw new Error("Mistral speech returned malformed audio data");
  }
  const decoded = Uint8Array.from(Buffer.from(value, "base64"));
  if (decoded.byteLength === 0) {
    throw new Error("Mistral speech returned empty audio data");
  }
  return decoded;
}

async function generateChunk(
  chunk: string,
  input: {
    credential: ResolvedServiceKey;
    userId: string;
    fetcher: Fetcher;
    sleep: (milliseconds: number) => Promise<void>;
    model: string;
    voiceId: string | null;
    signal?: AbortSignal;
    attemptTimeoutMs: number;
  },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (input.signal?.aborted) throw abortReason(input.signal);
    const deadline = attemptSignal(input.signal, input.attemptTimeoutMs);
    try {
      const response = await input.fetcher(MISTRAL_SPEECH_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${input.credential.key}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          input: chunk,
          model: input.model,
          response_format: "mp3",
          stream: false,
          ...(input.voiceId ? { voice_id: input.voiceId } : {}),
        }),
        signal: deadline.signal,
      });
      const body = await boundedText(response, deadline.signal);
      if (
        (response.status === 401 || response.status === 403) &&
        input.credential.source === "user"
      ) {
        await markServiceKeyInvalid(
          input.userId,
          "mistral",
          input.credential.invalidationToken,
        );
      }
      if (!response.ok) {
        const error = new Error(
          providerMessage(response.status, body, input.credential.key),
        );
        if (!RETRYABLE_STATUSES.has(response.status)) throw error;
        lastError = error;
      } else {
        let parsed: unknown;
        try {
          parsed = JSON.parse(body);
        } catch {
          throw new Error("Mistral speech returned malformed JSON");
        }
        return decodeAudioData(
          (parsed as { audio_data?: unknown } | null)?.audio_data,
        );
      }
    } catch (error) {
      if (input.signal?.aborted) throw abortReason(input.signal);
      lastError = error;
      if (
        error instanceof Error &&
        /returned (?:4\d\d)/.test(error.message) &&
        !/returned 429/.test(error.message)
      ) {
        throw error;
      }
    } finally {
      deadline.dispose();
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await input.sleep(Math.min(8_000, 500 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Mistral speech could not be reached");
}

export async function runMistralTextToSpeech(
  userId: string,
  text: string,
  options: MistralSpeechOptions = {},
): Promise<MistralSpeechResult> {
  if (ttsDisabled()) {
    throw new Error(
      "Podcast generation is disabled on this server. Enable it in server configuration first.",
    );
  }
  if (env.TTS_PROVIDER !== "mistral") {
    throw new Error("The configured text-to-speech provider is not supported");
  }
  const credential = options.key
    ? credentialForTests(options.key)
    : await resolveServiceKey(userId, "mistral");
  if (!credential) {
    throw new Error(
      "Podcast generation is not configured. Add a Mistral key in Settings → Integrations.",
    );
  }
  const chunks = splitSpeechText(text);
  if (chunks.length === 0) {
    throw new Error("The document has no narratable content");
  }
  if (chunks.length > SPEECH_MAX_CHUNKS) {
    throw new Error(
      `The document needs ${chunks.length} speech chunks; the limit is ${SPEECH_MAX_CHUNKS}`,
    );
  }
  const model = options.model ?? env.TTS_MODEL;
  const voiceId =
    options.voiceId === undefined
      ? (env.TTS_VOICE_ID ?? null)
      : options.voiceId?.trim() || null;
  const fetcher = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const audioChunks: Uint8Array[] = [];
  let total = 0;
  for (const chunk of chunks) {
    const audio = await generateChunk(chunk, {
      credential,
      userId,
      fetcher,
      sleep,
      model,
      voiceId,
      signal: options.signal,
      attemptTimeoutMs: options.attemptTimeoutMs ?? ATTEMPT_TIMEOUT_MS,
    });
    total += audio.byteLength;
    if (total > SPEECH_MAX_AUDIO_BYTES) {
      throw new Error("Generated podcast is larger than 100 MiB");
    }
    audioChunks.push(audio);
  }
  const combined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of audioChunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return {
    audio: combined,
    mimeType: "audio/mpeg",
    model,
    voiceId,
    chunkCount: chunks.length,
    characterCount: Array.from(text).length,
  };
}
