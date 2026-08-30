import { createHash } from "node:crypto";
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
} from "../usage/managed-provider-accounting";
import {
  DEFAULT_MISTRAL_SPEECH_MODEL,
  MISTRAL_SPEECH_URL,
  MistralSpeechSynthesisAdapter,
  SpeechSynthesisProviderError,
  type SpeechProviderFetcher,
  type SpeechSynthesisChunkAdapter,
} from "../capabilities/providers/speech-synthesis";
import { capabilityExecutionMode, capabilityRuntime } from "../capabilities/runtime";
import { capabilityRegistryInvoker } from "../capabilities/registry-invoker";
import { coreCapabilityArtifactIo } from "../capabilities/artifact-io";
import { newId } from "./id";

export { DEFAULT_MISTRAL_SPEECH_MODEL, MISTRAL_SPEECH_URL };
export const SPEECH_CHUNK_MAX_CHARS = 3_500;
export const SPEECH_MAX_CHUNKS = 32;
export const SPEECH_MAX_AUDIO_BYTES = 100 * 1024 * 1024;

const ATTEMPT_TIMEOUT_MS = 2 * 60 * 1_000;
const MAX_ATTEMPTS = 4;

export interface MistralSpeechResult {
  audio: Uint8Array;
  mimeType: "audio/mpeg";
  model: string;
  voiceId: string | null;
  chunkCount: number;
  characterCount: number;
  /** Compatibility metadata; future registry adapters can return another id. */
  provider?: string;
  /** Durable file created by a registry adapter; artifact workflows can adopt it. */
  artifactFileId?: string;
}

export interface MistralSpeechOptions {
  fetch?: SpeechProviderFetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Test seam. Production resolves the sealed user key, then operator key. */
  key?: string;
  /** Test seam; production always requests the exact Mistral route. */
  resolveCredential?: typeof resolveProviderServiceKey;
  model?: string;
  voiceId?: string | null;
  /** Durable run/job id used to make managed accounting idempotent. */
  operationId?: string;
  signal?: AbortSignal;
  attemptTimeoutMs?: number;
  /** Provider-attempt seam used by registry/conformance tests. */
  adapter?: SpeechSynthesisChunkAdapter;
  projectId?: string;
  workflowId?: string;
}

function ttsDisabled() {
  const runtime = process.env.DISABLE_TTS;
  return env.DISABLE_TTS || runtime === "true" || runtime === "1";
}

export async function textToSpeechEnabled(userId?: string) {
  if (ttsDisabled()) return false;
  if (capabilityExecutionMode("speech.synthesize") === "registry") {
    return userId ? capabilityRegistryInvoker.isConfigured({
      ownerId: userId,
      capability: "speech.synthesize",
      purpose: "media.podcast-narration",
    }) : false;
  }
  if (env.TTS_PROVIDER !== "mistral") return false;
  if (!userId) {
    return operatorServiceKeysEnabled() && Boolean(env.MISTRAL_API_KEY?.trim());
  }
  return Boolean(await resolveProviderServiceKey(userId, "mistral", "mistral"));
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

async function generateChunk(
  chunk: string,
  input: {
    adapter: SpeechSynthesisChunkAdapter;
    credential: ResolvedServiceKey;
    userId: string;
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
      const result = await input.adapter.synthesizeChunk({
        text: chunk,
        model: input.model,
        voiceId: input.voiceId,
        credential: input.credential.key,
        signal: deadline.signal,
      });
      return result.audio;
    } catch (error) {
      if (input.signal?.aborted) throw abortReason(input.signal);
      if (
        error instanceof SpeechSynthesisProviderError &&
        (error.status === 401 || error.status === 403) &&
        input.credential.source === "user"
      ) {
        await markServiceKeyInvalid(
          input.userId,
          "mistral",
          input.credential.invalidationToken,
        );
      }
      lastError = error;
      if (
        error instanceof SpeechSynthesisProviderError &&
        !error.retryable
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
    : await (options.resolveCredential ?? resolveProviderServiceKey)(
        userId,
        "mistral",
        "mistral",
      );
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
  const characterCount = Array.from(text).length;
  const reservation = await reserveManagedProviderUsage({
    credential,
    accountId: userId,
    operationId: options.operationId,
    capability: "tts.characters",
    unit: "characters",
    maximumQuantity: String(characterCount),
    provider: "mistral",
    model,
    estimatorVersion: "tts-unicode-codepoints/1",
  });
  const adapter =
    options.adapter ?? new MistralSpeechSynthesisAdapter(options.fetch ?? fetch);
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const audioChunks: Uint8Array[] = [];
  let total = 0;
  let providerStarted = false;
  let accountingSettled = false;
  try {
    for (const chunk of chunks) {
      providerStarted = true;
      const audio = await generateChunk(chunk, {
        adapter,
        credential,
        userId,
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
    await settleManagedProviderUsage(reservation, {
      actualQuantity: String(characterCount),
      outcome: "completed",
      authoritative: false,
      evidenceRef: "mistral-tts-request-characters",
    });
    accountingSettled = true;
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
      characterCount,
      provider: adapter.providerId,
    };
  } catch (error) {
    if (reservation && providerStarted && !accountingSettled) {
      await settleManagedProviderUsage(reservation, {
        actualQuantity: reservation.maximumQuantity,
        outcome: options.signal?.aborted ? "cancelled" : "failed",
        authoritative: false,
        evidenceRef: "mistral-tts-ambiguous-failure",
      }).catch(() => undefined);
    }
    throw error;
  }
}

/** Provider-neutral workflow facade. Legacy callers remain source-compatible. */
export async function textToSpeech(
  userId: string,
  text: string,
  options: MistralSpeechOptions = {},
) {
  const model = options.model ?? env.TTS_MODEL;
  const selection = {
    offeringId: null,
    routeKey: `mistral:${model}`,
    provider: "mistral",
    modelId: model,
    reason: "legacy-connection-bridge",
  } as const;
  const registryResolve = () =>
    capabilityRegistryInvoker.resolve({
      ownerId: userId,
      capability: "speech.synthesize",
      purpose: "media.podcast-narration",
      projectId: options.projectId,
      workflowId: options.workflowId,
      requirements: {
        inputBytes: new TextEncoder().encode(text).byteLength,
        batchSize: 1,
        voiceMode: "exact",
        requiredFeatures: ["alignment.none"],
      },
    });
  const registryExecute = async (): Promise<MistralSpeechResult> => {
    const voiceId = options.voiceId ?? env.TTS_VOICE_ID ?? "default";
    const result = await capabilityRegistryInvoker.invoke({
      ownerId: userId,
      capability: "speech.synthesize",
      purpose: "media.podcast-narration",
      projectId: options.projectId,
      workflowId: options.workflowId,
      request: {
        schemaVersion: 1,
        text,
        voice: { mode: "exact", voiceId },
        output: { container: "mp3" },
        alignment: "none",
      },
      idempotencyKey: options.operationId
        ? `tts-${createHash("sha256").update(options.operationId).digest("hex")}`
        : newId("tts"),
      requirements: {
        inputBytes: new TextEncoder().encode(text).byteLength,
        batchSize: 1,
        voiceMode: "exact",
        requiredFeatures: ["alignment.none"],
      },
      signal: options.signal,
    });
    const audio = await coreCapabilityArtifactIo.read(userId, result.audio, {
      maximumBytes: SPEECH_MAX_AUDIO_BYTES,
      signal: options.signal ?? new AbortController().signal,
    });
    const metadata = result.providerMetadata ?? {};
    return {
      audio,
      mimeType: "audio/mpeg",
      model:
        typeof metadata.modelId === "string" ? metadata.modelId : "unknown",
      voiceId: result.voice.providerVoiceId,
      chunkCount:
        typeof metadata.chunkCount === "number" ? metadata.chunkCount : 1,
      characterCount: Array.from(text).length,
      provider:
        typeof metadata.provider === "string" ? metadata.provider : "registry",
      artifactFileId:
        result.audio.object.namespace === "files"
          ? result.audio.object.key
          : undefined,
    };
  };
  return capabilityRuntime.invoke({
    ownerId: userId,
    capability: "speech.synthesize",
    purpose: "media.podcast-narration",
    legacy: {
      resolve: async () => selection,
      execute: () => runMistralTextToSpeech(userId, text, options),
    },
    registry: {
      resolve: registryResolve,
      execute: registryExecute,
    },
  });
}
