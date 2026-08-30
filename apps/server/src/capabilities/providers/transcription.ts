/** Provider-attempt adapters for `speech.transcribe`. No adapter retries. */

export const MISTRAL_TRANSCRIPTION_MODEL = "voxtral-mini-latest";
export const MISTRAL_TRANSCRIPTION_URL =
  "https://api.mistral.ai/v1/audio/transcriptions";
export const TRANSCRIPTION_PROVIDER_MAX_INPUT_BYTES = 32 * 1024 * 1024;
const MAX_PROVIDER_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_SEGMENTS = 20_000;
const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;

export type TranscriptionProviderFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type TranscriptionSegmentResult = {
  text: string;
  segments: { startMs: number; endMs: number; text: string }[];
  language?: string;
};

export type TranscriptionSegmentRequest = {
  blob: Blob;
  mimeType: string;
  language?: string;
  model: string;
  credential: string | null;
  signal: AbortSignal;
};

export interface TranscriptionSegmentAdapter {
  readonly providerId: string;
  readonly adapterRevision: string;
  transcribeSegment(
    input: TranscriptionSegmentRequest,
  ): Promise<TranscriptionSegmentResult>;
}

export class TranscriptionProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "TranscriptionProviderError";
  }
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Transcription request was cancelled");
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
  label: string,
  signal: AbortSignal,
) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`${label} is larger than the configured limit`);
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      if (signal.aborted) throw abortReason(signal);
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} is larger than the configured limit`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (signal.aborted) {
      await reader.cancel(signal.reason).catch(() => undefined);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
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
    ? `Mistral transcription returned ${status}: ${safe}`
    : `Mistral transcription returned ${status}`;
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function parseSegments(
  value: unknown,
  timeUnit: "seconds" | "milliseconds",
): TranscriptionSegmentResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Transcription provider returned malformed JSON");
  }
  const response = value as {
    text?: unknown;
    language?: unknown;
    segments?: unknown;
  };
  if (typeof response.text !== "string") {
    throw new Error("Transcription provider did not return text");
  }
  if (utf8Bytes(response.text) > MAX_PROVIDER_TEXT_BYTES) {
    throw new Error("Transcription provider text is larger than 2 MiB");
  }
  if (
    !Array.isArray(response.segments) ||
    response.segments.length > MAX_PROVIDER_SEGMENTS
  ) {
    throw new Error("Transcription provider returned an invalid segment list");
  }
  let previousStart = -1;
  const segments = response.segments.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Transcription provider returned a malformed segment");
    }
    const segment = entry as { start?: unknown; end?: unknown; text?: unknown };
    if (
      typeof segment.start !== "number" ||
      !Number.isFinite(segment.start) ||
      segment.start < 0 ||
      typeof segment.end !== "number" ||
      !Number.isFinite(segment.end) ||
      segment.end < segment.start ||
      typeof segment.text !== "string"
    ) {
      throw new Error("Transcription provider returned a malformed segment");
    }
    const multiplier = timeUnit === "seconds" ? 1_000 : 1;
    const startMs = Math.round(segment.start * multiplier);
    const endMs = Math.round(segment.end * multiplier);
    if (startMs < previousStart) {
      throw new Error("Transcription provider returned unordered segments");
    }
    previousStart = startMs;
    return { startMs, endMs, text: segment.text };
  });
  const language =
    typeof response.language === "string" && response.language.trim()
      ? response.language.trim().slice(0, 64)
      : undefined;
  return { text: response.text, segments, ...(language ? { language } : {}) };
}

function extensionFor(mimeType: string) {
  if (mimeType === "audio/webm") return ".webm";
  if (mimeType === "audio/ogg") return ".ogg";
  if (mimeType === "audio/m4a") return ".m4a";
  return ".mp4";
}

export class MistralTranscriptionAdapter
  implements TranscriptionSegmentAdapter
{
  readonly providerId = "mistral";
  readonly adapterRevision = "mistral-transcription-multipart/1";

  constructor(
    private readonly fetcher: TranscriptionProviderFetcher = fetch,
  ) {}

  async transcribeSegment(
    input: TranscriptionSegmentRequest,
  ): Promise<TranscriptionSegmentResult> {
    if (!input.credential) {
      throw new Error("Mistral transcription requires a credential");
    }
    input.signal.throwIfAborted();
    const form = new FormData();
    form.append("model", input.model);
    // Mistral currently rejects language together with timestamp granularities.
    form.append("timestamp_granularities", "segment");
    form.append(
      "file",
      new File([input.blob], `segment${extensionFor(input.mimeType)}`, {
        type: input.mimeType,
      }),
    );
    const response = await this.fetcher(MISTRAL_TRANSCRIPTION_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${input.credential}` },
      body: form,
      signal: input.signal,
    });
    let body: string;
    try {
      body = await readBoundedText(
        response,
        response.ok ? MAX_PROVIDER_RESPONSE_BYTES : MAX_PROVIDER_ERROR_BYTES,
        response.ok
          ? "Mistral transcription response"
          : "Mistral transcription error response",
        input.signal,
      );
    } catch (error) {
      if (input.signal.aborted) throw error;
      throw new TranscriptionProviderError(
        error instanceof Error
          ? error.message
          : "Mistral transcription response could not be read",
        response.status,
        false,
      );
    }
    if (!response.ok) {
      throw new TranscriptionProviderError(
        providerMessage(response.status, body, input.credential),
        response.status,
        [429, 500, 502, 503, 504].includes(response.status),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new TranscriptionProviderError(
        "Mistral transcription returned malformed JSON",
        response.status,
        false,
      );
    }
    try {
      return parseSegments(parsed, "seconds");
    } catch (error) {
      if (error instanceof Error) {
        throw new TranscriptionProviderError(
          error.message.replace(
            "Transcription provider",
            "Mistral transcription",
          ),
          response.status,
          false,
        );
      }
      throw error;
    }
  }
}

export type AiSdkDeepgramTranscriptionAdapterOptions = {
  fetch?: TranscriptionProviderFetcher;
  maximumInputBytes?: number;
};

function sdkStatus(error: unknown) {
  if (!error || typeof error !== "object") return null;
  const status = (error as { statusCode?: unknown }).statusCode;
  return typeof status === "number" && Number.isSafeInteger(status)
    ? status
    : null;
}

/** Official AI SDK Deepgram adapter with a closed provider-options object. */
export class AiSdkDeepgramTranscriptionAdapter
  implements TranscriptionSegmentAdapter
{
  readonly providerId = "deepgram";
  readonly adapterRevision = "ai-sdk-deepgram/3.1.3";
  readonly #maximumInputBytes: number;

  constructor(
    private readonly options: AiSdkDeepgramTranscriptionAdapterOptions = {},
  ) {
    this.#maximumInputBytes =
      options.maximumInputBytes ?? TRANSCRIPTION_PROVIDER_MAX_INPUT_BYTES;
    if (
      !Number.isSafeInteger(this.#maximumInputBytes) ||
      this.#maximumInputBytes < 1 ||
      this.#maximumInputBytes > TRANSCRIPTION_PROVIDER_MAX_INPUT_BYTES
    ) {
      throw new Error("DEEPGRAM_TRANSCRIPTION_INPUT_LIMIT_INVALID");
    }
  }

  async transcribeSegment(
    input: TranscriptionSegmentRequest,
  ): Promise<TranscriptionSegmentResult> {
    if (!input.credential) {
      throw new Error("Deepgram transcription requires a credential");
    }
    if (input.blob.size > this.#maximumInputBytes) {
      throw new Error("DEEPGRAM_TRANSCRIPTION_INPUT_TOO_LARGE");
    }
    input.signal.throwIfAborted();
    const audio = new Uint8Array(await input.blob.arrayBuffer());
    input.signal.throwIfAborted();
    const baseFetch = this.options.fetch ?? fetch;
    const boundedFetch: TranscriptionProviderFetcher = async (
      resource,
      init,
    ) => {
      const response = await baseFetch(resource, init);
      const signal =
        init?.signal ??
        (resource instanceof Request ? resource.signal : input.signal);
      const body = await readBoundedText(
        response,
        response.ok ? MAX_PROVIDER_RESPONSE_BYTES : MAX_PROVIDER_ERROR_BYTES,
        "Deepgram transcription response",
        signal,
      );
      return new Response(body, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
    try {
      const provider = createDeepgram({
        apiKey: input.credential,
        fetch: boundedFetch as typeof fetch,
      });
      const result = await aiSdkTranscribe({
        model: provider.transcription(input.model),
        audio,
        providerOptions: {
          deepgram: {
            punctuate: true,
            smartFormat: true,
            diarize: false,
            detectLanguage: input.language === undefined,
            ...(input.language ? { language: input.language } : {}),
          },
        },
        // Avermate owns retries and explicit route changes.
        maxRetries: 0,
        abortSignal: input.signal,
      });
      return parseSegments(
        {
          text: result.text,
          language: result.language,
          segments: result.segments.map((segment) => ({
            text: segment.text,
            start: segment.startSecond,
            end: segment.endSecond,
          })),
        },
        "seconds",
      );
    } catch (error) {
      if (input.signal.aborted) throw abortReason(input.signal);
      if (
        error instanceof Error &&
        error.message.startsWith("DEEPGRAM_TRANSCRIPTION_")
      ) {
        throw error;
      }
      const status = sdkStatus(error);
      throw new TranscriptionProviderError(
        status
          ? `Deepgram transcription returned ${status}`
          : "Deepgram transcription request failed",
        status,
        status === 429 || (status !== null && status >= 500),
      );
    }
  }
}

export type BoundedTranscriptionProtocolAdapterOptions = {
  endpoint: string;
  providerId: string;
  fetch: TranscriptionProviderFetcher;
  maximumInputBytes?: number;
};

/** Reviewed `avermate.speech-transcription/v1` sidecar protocol adapter. */
export class BoundedTranscriptionProtocolAdapter
  implements TranscriptionSegmentAdapter
{
  readonly providerId: string;
  readonly adapterRevision = "avermate.speech-transcription-http/1";
  readonly #endpoint: string;
  readonly #maximumInputBytes: number;

  constructor(
    private readonly options: BoundedTranscriptionProtocolAdapterOptions,
  ) {
    const endpoint = new URL(options.endpoint);
    if (
      !["http:", "https:"].includes(endpoint.protocol) ||
      endpoint.username ||
      endpoint.password ||
      endpoint.hash ||
      endpoint.search
    ) {
      throw new Error("TRANSCRIPTION_PROTOCOL_ENDPOINT_INVALID");
    }
    if (!/^[a-z0-9][a-z0-9._-]{0,127}$/u.test(options.providerId)) {
      throw new Error("TRANSCRIPTION_PROTOCOL_PROVIDER_ID_INVALID");
    }
    const maximumInputBytes =
      options.maximumInputBytes ?? TRANSCRIPTION_PROVIDER_MAX_INPUT_BYTES;
    if (
      !Number.isSafeInteger(maximumInputBytes) ||
      maximumInputBytes < 1 ||
      maximumInputBytes > TRANSCRIPTION_PROVIDER_MAX_INPUT_BYTES
    ) {
      throw new Error("TRANSCRIPTION_PROTOCOL_INPUT_LIMIT_INVALID");
    }
    this.providerId = options.providerId;
    this.#endpoint = endpoint.toString();
    this.#maximumInputBytes = maximumInputBytes;
  }

  async transcribeSegment(
    input: TranscriptionSegmentRequest,
  ): Promise<TranscriptionSegmentResult> {
    if (input.blob.size > this.#maximumInputBytes) {
      throw new Error("TRANSCRIPTION_PROTOCOL_INPUT_TOO_LARGE");
    }
    input.signal.throwIfAborted();
    const form = new FormData();
    form.append("schemaVersion", "1");
    form.append("model", input.model);
    form.append("timestamps", "segment");
    if (input.language) form.append("language", input.language);
    form.append(
      "file",
      new File([input.blob], `segment${extensionFor(input.mimeType)}`, {
        type: input.mimeType,
      }),
    );
    const response = await this.options.fetch(this.#endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        ...(input.credential
          ? { authorization: `Bearer ${input.credential}` }
          : {}),
      },
      body: form,
      signal: input.signal,
    });
    const body = await readBoundedText(
      response,
      response.ok ? MAX_PROVIDER_RESPONSE_BYTES : MAX_PROVIDER_ERROR_BYTES,
      "Transcription protocol response",
      input.signal,
    );
    if (!response.ok) {
      throw new TranscriptionProviderError(
        `Transcription protocol returned ${response.status}`,
        response.status,
        [429, 500, 502, 503, 504].includes(response.status),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("TRANSCRIPTION_PROTOCOL_INVALID_JSON");
    }
    return parseSegments(parsed, "milliseconds");
  }
}
import { createDeepgram } from "@ai-sdk/deepgram";
import { transcribe as aiSdkTranscribe } from "ai";
