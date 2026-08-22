import { env } from "./env";
import {
  markServiceKeyInvalid,
  operatorServiceKeysEnabled,
  resolveProviderServiceKey,
  type ResolvedServiceKey,
} from "./service-keys";
import {
  reserveManagedProviderUsage,
  settleManagedProviderUsage,
  usesManagedOperatorSpend,
} from "../usage/managed-provider-accounting";
import {
  runPairedNodeTranscription,
  selectedNodeDocumentAi,
} from "../node/document-ai";

/**
 * Mistral audio transcription contract, verified against the current API docs:
 * POST https://api.mistral.ai/v1/audio/transcriptions as multipart/form-data,
 * model `voxtral-mini-latest`, with `timestamp_granularities=segment`.
 *
 * The API currently does not accept timestamp granularities together with a
 * requested language. We therefore never send the optional input language;
 * the detected response language remains available to callers.
 */
export const MISTRAL_TRANSCRIPTION_MODEL = "voxtral-mini-latest";
export const MISTRAL_TRANSCRIPTION_URL =
  "https://api.mistral.ai/v1/audio/transcriptions";
export const MAX_TRANSCRIPTION_AUDIO_BYTES = 32 * 1024 * 1024;
export const TRANSCRIPTION_ATTEMPT_TIMEOUT_MS = 5 * 60 * 1_000;

const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 6;
const MAX_PROVIDER_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_PROVIDER_SEGMENTS = 20_000;
const MAX_PROVIDER_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface TranscriptionResult {
  text: string;
  segments: { startMs: number; endMs: number; text: string }[];
  language?: string;
}

export interface TranscriptionProvider {
  id: "mistral" | "openai" | "node-local";
  /** Exact provider model, including the attested revision for local Node. */
  model: string;
  transcribeSegment(input: {
    blob: Blob;
    mimeType: string;
    language?: string;
    operationId?: string;
    attempt?: number;
    maximumSeconds?: number;
    signal?: AbortSignal;
  }): Promise<TranscriptionResult>;
}

export interface MistralTranscriptionOptions {
  fetch?: Fetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Test seam. Production resolves the sealed user key, then operator key. */
  key?: string;
  /** Test seam; production always requests the exact Mistral route. */
  resolveCredential?: typeof resolveProviderServiceKey;
  maxBytes?: number;
  model?: string;
  /** Durable run/job id used to make managed accounting idempotent. */
  operationId?: string;
  /** Conservative duration bound required for operator-paid transcription. */
  maximumSeconds?: number;
  signal?: AbortSignal;
  /** Per-attempt deadline, including response-body consumption. */
  attemptTimeoutMs?: number;
}

type TranscriptionResolverDependencies = {
  selectNode: typeof selectedNodeDocumentAi;
  runNode: typeof runPairedNodeTranscription;
  runMistral: typeof runMistralTranscription;
};

const defaultTranscriptionResolverDependencies: TranscriptionResolverDependencies = {
  selectNode: selectedNodeDocumentAi,
  runNode: runPairedNodeTranscription,
  runMistral: runMistralTranscription,
};

function transcriptionDisabled() {
  const runtime = process.env.DISABLE_TRANSCRIPTION;
  return env.DISABLE_TRANSCRIPTION || runtime === "true" || runtime === "1";
}

export async function transcriptionEnabled(userId?: string) {
  if (transcriptionDisabled()) return false;
  if (!userId) {
    return (
      operatorServiceKeysEnabled() && Boolean(env.TRANSCRIPTION_API_KEY?.trim())
    );
  }
  try {
    const node = await selectedNodeDocumentAi(userId, "transcription");
    if (node.selected) return true;
  } catch {
    return false;
  }
  if (env.TRANSCRIPTION_PROVIDER === "node") return false;
  return Boolean(
    await resolveProviderServiceKey(userId, "transcription", "mistral"),
  );
}

function abortError(signal: AbortSignal | undefined) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Transcription request was cancelled");
}

function awaitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(abortError(signal));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function attemptDeadline(parent: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  const timeoutError = new Error("Mistral transcription attempt timed out");
  const abortFromParent = () => controller.abort(abortError(parent));
  if (parent?.aborted) abortFromParent();
  else parent?.addEventListener("abort", abortFromParent, { once: true });
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  return {
    signal: controller.signal,
    timedOut: () => controller.signal.reason === timeoutError,
    dispose: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", abortFromParent);
    },
  };
}

function redactedProviderMessage(status: number, body: string, secret: string) {
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
    ? `Mistral transcription returned ${status}: ${safe}`
    : `Mistral transcription returned ${status}`;
}

async function boundedResponseText(
  response: Response,
  maxBytes: number,
  label: string,
  signal?: AbortSignal,
) {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`${label} is larger than the configured limit`);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await awaitWithSignal(reader.read(), signal);
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error(`${label} is larger than the configured limit`);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } catch (error) {
    if (signal?.aborted) {
      await reader.cancel(signal.reason).catch(() => undefined);
    }
    throw error;
  } finally {
    reader.releaseLock();
  }
}

async function requestWithRetry(
  makeRequest: (signal: AbortSignal) => Promise<Response>,
  sleep: (milliseconds: number) => Promise<void>,
  secret: string,
  options: { signal?: AbortSignal; attemptTimeoutMs: number },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const deadline = attemptDeadline(options.signal, options.attemptTimeoutMs);
    let response: Response | undefined;
    try {
      response = await awaitWithSignal(
        makeRequest(deadline.signal),
        deadline.signal,
      );
      const body = await boundedResponseText(
        response,
        response.ok ? MAX_PROVIDER_RESPONSE_BYTES : MAX_PROVIDER_ERROR_BYTES,
        response.ok
          ? "Mistral transcription response"
          : "Mistral transcription error response",
        deadline.signal,
      );
      if (response.ok || !RETRYABLE_STATUSES.has(response.status)) {
        return { response, body };
      }
      lastError = new Error(
        redactedProviderMessage(response.status, body, secret),
      );
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal);
      if (deadline.timedOut()) {
        lastError = new Error("Mistral transcription attempt timed out");
      } else if (
        response &&
        (response.ok || !RETRYABLE_STATUSES.has(response.status))
      ) {
        throw error;
      } else {
        lastError = error;
      }
    } finally {
      deadline.dispose();
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(Math.min(20_000, 1_000 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Mistral transcription could not be reached");
}

function credentialForTests(key: string): ResolvedServiceKey {
  return { key, source: "operator" };
}

function extensionFor(mimeType: string) {
  if (mimeType === "audio/webm") return ".webm";
  if (mimeType === "audio/ogg") return ".ogg";
  if (mimeType === "audio/m4a") return ".m4a";
  return ".mp4";
}

function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function parseResponse(value: unknown): TranscriptionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Mistral transcription returned malformed JSON");
  }
  const response = value as {
    text?: unknown;
    language?: unknown;
    segments?: unknown;
  };
  if (typeof response.text !== "string") {
    throw new Error("Mistral transcription did not return text");
  }
  if (utf8Bytes(response.text) > MAX_PROVIDER_TEXT_BYTES) {
    throw new Error("Mistral transcription text is larger than 2 MiB");
  }
  if (
    !Array.isArray(response.segments) ||
    response.segments.length > MAX_PROVIDER_SEGMENTS
  ) {
    throw new Error("Mistral transcription returned an invalid segment list");
  }

  const segments = response.segments.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error("Mistral transcription returned a malformed segment");
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
      throw new Error("Mistral transcription returned a malformed segment");
    }
    return {
      startMs: Math.round(segment.start * 1_000),
      endMs: Math.round(segment.end * 1_000),
      text: segment.text,
    };
  });
  const language =
    typeof response.language === "string" && response.language.trim()
      ? response.language.trim().slice(0, 64)
      : undefined;
  return { text: response.text, segments, ...(language ? { language } : {}) };
}

export async function runMistralTranscription(
  userId: string,
  input: { blob: Blob; mimeType: string; language?: string },
  options: MistralTranscriptionOptions = {},
): Promise<TranscriptionResult> {
  if (transcriptionDisabled()) {
    throw new Error(
      "Transcription is disabled on this server. Enable it in server configuration first.",
    );
  }
  const maxBytes = options.maxBytes ?? MAX_TRANSCRIPTION_AUDIO_BYTES;
  if (input.blob.size > maxBytes) {
    throw new Error("A transcription segment must be 32 MiB or smaller");
  }
  const credential = options.key
    ? credentialForTests(options.key)
    : await (options.resolveCredential ?? resolveProviderServiceKey)(
        userId,
        "transcription",
        "mistral",
      );
  if (!credential) {
    throw new Error(
      "Transcription is not configured. Add a transcription key in Settings → Integrations.",
    );
  }

  const model = options.model ?? MISTRAL_TRANSCRIPTION_MODEL;
  const maximumSeconds = options.maximumSeconds;
  if (
    maximumSeconds !== undefined &&
    (!Number.isSafeInteger(maximumSeconds) || maximumSeconds <= 0)
  ) {
    throw new Error("Transcription duration limit must be a positive integer");
  }
  if (usesManagedOperatorSpend(credential) && maximumSeconds === undefined) {
    throw new Error("MANAGED_MAXIMUM_SECONDS_REQUIRED");
  }
  const reservation = await reserveManagedProviderUsage({
    credential,
    accountId: userId,
    operationId: options.operationId,
    capability: "transcription.seconds",
    unit: "seconds",
    maximumQuantity:
      maximumSeconds === undefined ? "0" : String(maximumSeconds),
    provider: "mistral",
    model,
    estimatorVersion: "transcription-source-duration/1",
  });

  const fetcher = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const signal = options.signal;
  let providerStarted = false;
  let accountingSettled = false;
  try {
    providerStarted = true;
    const { response, body } = await requestWithRetry(
      (attemptSignal) => {
        const form = new FormData();
        form.append("model", model);
        form.append("timestamp_granularities", "segment");
        form.append(
          "file",
          new File([input.blob], `segment${extensionFor(input.mimeType)}`, {
            type: input.mimeType,
          }),
        );
        return fetcher(MISTRAL_TRANSCRIPTION_URL, {
          method: "POST",
          headers: { Authorization: `Bearer ${credential.key}` },
          body: form,
          signal: attemptSignal,
        });
      },
      sleep,
      credential.key,
      {
        signal,
        attemptTimeoutMs:
          options.attemptTimeoutMs ?? TRANSCRIPTION_ATTEMPT_TIMEOUT_MS,
      },
    );
    if (response.status === 401 && credential.source === "user") {
      await markServiceKeyInvalid(
        userId,
        "transcription",
        credential.invalidationToken,
      );
    }
    if (!response.ok) {
      throw new Error(
        redactedProviderMessage(response.status, body, credential.key),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error("Mistral transcription returned malformed JSON");
    }
    const result = parseResponse(parsed);
    const observedMilliseconds = result.segments.reduce(
      (maximum, segment) => Math.max(maximum, segment.endMs),
      0,
    );
    const estimatedSeconds = Math.max(
      0,
      Math.ceil(observedMilliseconds / 1_000) || maximumSeconds || 0,
    );
    await settleManagedProviderUsage(reservation, {
      actualQuantity: String(estimatedSeconds),
      outcome: "completed",
      authoritative: false,
      evidenceRef: "mistral-segment-timestamps",
    });
    accountingSettled = true;
    return result;
  } catch (error) {
    if (reservation && providerStarted && !accountingSettled) {
      await settleManagedProviderUsage(reservation, {
        actualQuantity: reservation.maximumQuantity,
        outcome: options.signal?.aborted ? "cancelled" : "failed",
        authoritative: false,
        evidenceRef: "mistral-transcription-ambiguous-failure",
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function resolveTranscriptionProvider(
  userId: string,
  options: MistralTranscriptionOptions = {},
  overrides: Partial<TranscriptionResolverDependencies> = {},
): Promise<TranscriptionProvider> {
  const dependencies = {
    ...defaultTranscriptionResolverDependencies,
    ...overrides,
  };
  const node = await dependencies.selectNode(userId, "transcription");
  if (node.selected || env.TRANSCRIPTION_PROVIDER === "node") {
    if (!node.selected) {
      throw new Error("NODE_TRANSCRIPTION_PLACEMENT_REQUIRED");
    }
    return {
      id: "node-local",
      model: `${node.modelId}@${node.modelRevision}`,
      transcribeSegment: (input) =>
        dependencies.runNode(userId, {
          ...input,
          operationId: input.operationId ?? options.operationId,
          attempt: input.attempt,
          maximumSeconds: input.maximumSeconds ?? options.maximumSeconds,
          signal: input.signal ?? options.signal,
        }),
    };
  }
  return {
    id: "mistral",
    model: options.model ?? MISTRAL_TRANSCRIPTION_MODEL,
    transcribeSegment: (input) =>
      dependencies.runMistral(userId, input, {
        ...options,
        operationId: input.operationId ?? options.operationId,
        maximumSeconds: input.maximumSeconds ?? options.maximumSeconds,
        signal: input.signal ?? options.signal,
      }),
  };
}

export type TranscriptionResolverTestDependencies = Partial<TranscriptionResolverDependencies>;
