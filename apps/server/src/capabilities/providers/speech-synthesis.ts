/**
 * Provider-specific speech synthesis transports.
 *
 * These adapters perform exactly one provider attempt. Credential selection,
 * accounting, retries and workflow artifact publication stay in the caller so
 * no provider can hide fallback or spend behind this boundary.
 */

export const MISTRAL_SPEECH_URL = "https://api.mistral.ai/v1/audio/speech";
export const DEFAULT_MISTRAL_SPEECH_MODEL = "voxtral-mini-tts-2603";
export const SPEECH_PROVIDER_MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

export type SpeechProviderFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type SpeechSynthesisChunkRequest = {
  text: string;
  model: string;
  voiceId: string | null;
  credential: string | null;
  signal: AbortSignal;
};

export type SpeechSynthesisChunkResult = {
  audio: Uint8Array;
  mimeType: "audio/mpeg" | "audio/wav" | "audio/ogg";
  providerRequestId: string | null;
};

export interface SpeechSynthesisChunkAdapter {
  readonly providerId: string;
  readonly adapterRevision: string;
  synthesizeChunk(
    input: SpeechSynthesisChunkRequest,
  ): Promise<SpeechSynthesisChunkResult>;
}

export class SpeechSynthesisProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "SpeechSynthesisProviderError";
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Speech synthesis request was cancelled");
}

async function boundedBytes(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Speech synthesis response is larger than the limit");
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      if (signal.aborted) throw abortReason(signal);
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Speech synthesis response is larger than the limit");
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }
  const output = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

async function boundedText(
  response: Response,
  maximumBytes: number,
  signal: AbortSignal,
) {
  return new TextDecoder().decode(
    await boundedBytes(response, maximumBytes, signal),
  );
}

function providerMessage(status: number, body: string, secret: string | null) {
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
  const safe = (secret ? detail.replaceAll(secret, "[redacted]") : detail)
    .trim()
    .slice(0, 300);
  return safe
    ? `Mistral speech returned ${status}: ${safe}`
    : `Mistral speech returned ${status}`;
}

function decodeMistralAudio(value: unknown) {
  if (
    typeof value !== "string" ||
    !value ||
    value.length >
      Math.ceil((SPEECH_PROVIDER_MAX_RESPONSE_BYTES * 4) / 3) + 8 ||
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

export class MistralSpeechSynthesisAdapter
  implements SpeechSynthesisChunkAdapter
{
  readonly providerId = "mistral";
  readonly adapterRevision = "mistral-speech-json/1";

  constructor(
    private readonly fetcher: SpeechProviderFetcher = fetch,
  ) {}

  async synthesizeChunk(
    input: SpeechSynthesisChunkRequest,
  ): Promise<SpeechSynthesisChunkResult> {
    if (!input.credential) {
      throw new Error("Mistral speech requires a credential");
    }
    input.signal.throwIfAborted();
    const response = await this.fetcher(MISTRAL_SPEECH_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${input.credential}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: input.text,
        model: input.model,
        response_format: "mp3",
        stream: false,
        ...(input.voiceId ? { voice_id: input.voiceId } : {}),
      }),
      signal: input.signal,
    });
    const body = await boundedText(
      response,
      SPEECH_PROVIDER_MAX_RESPONSE_BYTES,
      input.signal,
    );
    if (!response.ok) {
      throw new SpeechSynthesisProviderError(
        providerMessage(response.status, body, input.credential),
        response.status,
        [429, 500, 502, 503, 504].includes(response.status),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("Mistral speech returned malformed JSON");
    }
    return {
      audio: decodeMistralAudio(
        (parsed as { audio_data?: unknown } | null)?.audio_data,
      ),
      mimeType: "audio/mpeg",
      providerRequestId:
        response.headers.get("x-request-id") ??
        response.headers.get("request-id"),
    };
  }
}

export type AiSdkElevenLabsSpeechAdapterOptions = {
  fetch?: SpeechProviderFetcher;
  maximumResponseBytes?: number;
};

function sdkStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && Number.isSafeInteger(status)
    ? status
    : null;
}

/** Official AI SDK ElevenLabs adapter with SDK retries explicitly disabled. */
export class AiSdkElevenLabsSpeechSynthesisAdapter
  implements SpeechSynthesisChunkAdapter
{
  readonly providerId = "elevenlabs";
  readonly adapterRevision = "ai-sdk-elevenlabs/3.0.33";
  readonly #maximumResponseBytes: number;

  constructor(
    private readonly options: AiSdkElevenLabsSpeechAdapterOptions = {},
  ) {
    this.#maximumResponseBytes =
      options.maximumResponseBytes ?? SPEECH_PROVIDER_MAX_RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(this.#maximumResponseBytes) ||
      this.#maximumResponseBytes < 1 ||
      this.#maximumResponseBytes > SPEECH_PROVIDER_MAX_RESPONSE_BYTES
    ) {
      throw new Error("ELEVENLABS_SPEECH_RESPONSE_LIMIT_INVALID");
    }
  }

  async synthesizeChunk(
    input: SpeechSynthesisChunkRequest,
  ): Promise<SpeechSynthesisChunkResult> {
    if (!input.credential) {
      throw new Error("ElevenLabs speech requires a credential");
    }
    input.signal.throwIfAborted();
    const baseFetch = this.options.fetch ?? fetch;
    const boundedFetch: SpeechProviderFetcher = async (resource, init) => {
      const response = await baseFetch(resource, init);
      if (!response.ok) return response;
      const signal =
        init?.signal ??
        (resource instanceof Request ? resource.signal : input.signal);
      const audio = await boundedBytes(
        response,
        this.#maximumResponseBytes,
        signal,
      );
      return new Response(audio, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
    try {
      const provider = createElevenLabs({
        apiKey: input.credential,
        fetch: boundedFetch as typeof fetch,
      });
      const result = await generateSpeech({
        model: provider.speech(input.model),
        text: input.text,
        ...(input.voiceId ? { voice: input.voiceId } : {}),
        outputFormat: "mp3",
        // Avermate owns retries and route changes; the SDK performs one call.
        maxRetries: 0,
        abortSignal: input.signal,
      });
      const audio = Uint8Array.from(result.audio.uint8Array);
      if (audio.byteLength < 1 || audio.byteLength > this.#maximumResponseBytes) {
        throw new Error("ELEVENLABS_SPEECH_AUDIO_LIMIT");
      }
      if (
        result.audio.mediaType !== "audio/mpeg" &&
        result.audio.mediaType !== "audio/mp3"
      ) {
        throw new Error("ELEVENLABS_SPEECH_UNEXPECTED_MIME_TYPE");
      }
      const metadata = result.responses.at(-1);
      return {
        audio,
        mimeType: "audio/mpeg",
        providerRequestId:
          metadata?.headers?.["request-id"] ??
          metadata?.headers?.["x-request-id"] ??
          null,
      };
    } catch (error) {
      if (input.signal.aborted) throw abortReason(input.signal);
      if (
        error instanceof Error &&
        error.message.startsWith("ELEVENLABS_SPEECH_")
      ) {
        throw error;
      }
      const status = sdkStatus(error);
      throw new SpeechSynthesisProviderError(
        status
          ? `ElevenLabs speech returned ${status}`
          : "ElevenLabs speech request failed",
        status,
        status === 429 || (status !== null && status >= 500),
      );
    }
  }
}

export type BoundedSpeechSynthesisProtocolAdapterOptions = {
  /** Exact reviewed sidecar endpoint; credentials in URLs are forbidden. */
  endpoint: string;
  providerId: string;
  fetch: SpeechProviderFetcher;
  maximumResponseBytes?: number;
};

/**
 * A second, deliberately narrow adapter for reviewed Core transports or Node
 * sidecars. It implements `avermate.speech-synthesis/v1`, accepts one bounded
 * text chunk and returns one raw audio body. It has no discovery or fallback.
 */
export class BoundedSpeechSynthesisProtocolAdapter
  implements SpeechSynthesisChunkAdapter
{
  readonly providerId: string;
  readonly adapterRevision = "avermate.speech-synthesis-http/1";
  readonly #endpoint: string;
  readonly #maximumResponseBytes: number;

  constructor(
    private readonly options: BoundedSpeechSynthesisProtocolAdapterOptions,
  ) {
    const endpoint = new URL(options.endpoint);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash ||
      endpoint.search
    ) {
      throw new Error("SPEECH_PROTOCOL_ENDPOINT_INVALID");
    }
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(options.providerId)) {
      throw new Error("SPEECH_PROTOCOL_PROVIDER_ID_INVALID");
    }
    const maximumResponseBytes =
      options.maximumResponseBytes ?? SPEECH_PROVIDER_MAX_RESPONSE_BYTES;
    if (
      !Number.isSafeInteger(maximumResponseBytes) ||
      maximumResponseBytes < 1 ||
      maximumResponseBytes > SPEECH_PROVIDER_MAX_RESPONSE_BYTES
    ) {
      throw new Error("SPEECH_PROTOCOL_RESPONSE_LIMIT_INVALID");
    }
    this.providerId = options.providerId;
    this.#endpoint = endpoint.toString();
    this.#maximumResponseBytes = maximumResponseBytes;
  }

  async synthesizeChunk(
    input: SpeechSynthesisChunkRequest,
  ): Promise<SpeechSynthesisChunkResult> {
    const characterCount = Array.from(input.text).length;
    if (characterCount < 1 || characterCount > 3_500) {
      throw new Error("SPEECH_PROTOCOL_TEXT_LIMIT");
    }
    input.signal.throwIfAborted();
    const response = await this.options.fetch(this.#endpoint, {
      method: "POST",
      headers: {
        accept: "audio/mpeg, audio/wav, audio/ogg",
        "content-type": "application/json",
        ...(input.credential
          ? { authorization: `Bearer ${input.credential}` }
          : {}),
      },
      body: JSON.stringify({
        schemaVersion: 1,
        text: input.text,
        model: input.model,
        voice: input.voiceId ? { mode: "exact", voiceId: input.voiceId } : null,
        output: { container: "mp3" },
      }),
      signal: input.signal,
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new SpeechSynthesisProviderError(
        `Speech synthesis protocol returned ${response.status}`,
        response.status,
        [429, 500, 502, 503, 504].includes(response.status),
      );
    }
    const contentType = response.headers
      .get("content-type")
      ?.split(";", 1)[0]
      ?.trim()
      .toLowerCase();
    if (
      contentType !== "audio/mpeg" &&
      contentType !== "audio/wav" &&
      contentType !== "audio/ogg"
    ) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("SPEECH_PROTOCOL_UNEXPECTED_MIME_TYPE");
    }
    const audio = await boundedBytes(
      response,
      this.#maximumResponseBytes,
      input.signal,
    );
    if (audio.byteLength === 0) {
      throw new Error("SPEECH_PROTOCOL_EMPTY_AUDIO");
    }
    return {
      audio,
      mimeType: contentType,
      providerRequestId: response.headers.get("x-request-id"),
    };
  }
}
import { createElevenLabs } from "@ai-sdk/elevenlabs";
import { generateSpeech } from "ai";
