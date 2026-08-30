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
import {
  MISTRAL_TRANSCRIPTION_MODEL,
  MISTRAL_TRANSCRIPTION_URL,
  MistralTranscriptionAdapter,
  TRANSCRIPTION_PROVIDER_MAX_INPUT_BYTES,
  TranscriptionProviderError,
  type TranscriptionProviderFetcher,
  type TranscriptionSegmentAdapter,
  type TranscriptionSegmentResult,
} from "../capabilities/providers/transcription";
import { capabilityRuntime } from "../capabilities/runtime";
import { capabilityRegistryInvoker } from "../capabilities/registry-invoker";
import { coreCapabilityArtifactIo, type CapabilityArtifactIo } from "../capabilities/artifact-io";

/**
 * Mistral audio transcription contract, verified against the current API docs:
 * POST https://api.mistral.ai/v1/audio/transcriptions as multipart/form-data,
 * model `voxtral-mini-latest`, with `timestamp_granularities=segment`.
 *
 * The API currently does not accept timestamp granularities together with a
 * requested language. We therefore never send the optional input language;
 * the detected response language remains available to callers.
 */
export { MISTRAL_TRANSCRIPTION_MODEL, MISTRAL_TRANSCRIPTION_URL };
export const MAX_TRANSCRIPTION_AUDIO_BYTES =
  TRANSCRIPTION_PROVIDER_MAX_INPUT_BYTES;
export const TRANSCRIPTION_ATTEMPT_TIMEOUT_MS = 5 * 60 * 1_000;

const MAX_ATTEMPTS = 6;

export type TranscriptionResult = TranscriptionSegmentResult;

export interface TranscriptionProvider {
  id: "mistral" | "openai" | "deepgram" | "node-local" | "capability-registry";
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
  fetch?: TranscriptionProviderFetcher;
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
  /** Provider-attempt seam used by registry/conformance tests. */
  adapter?: TranscriptionSegmentAdapter;
  /** Provider-neutral workflow purpose used by the capability policy. */
  purpose?: string;
  /** Trusted project/workflow scope supplied by the owning server workflow. */
  projectId?: string;
  workflowId?: string;
}

type TranscriptionResolverDependencies = {
  selectNode: typeof selectedNodeDocumentAi;
  runNode: typeof runPairedNodeTranscription;
  runMistral: typeof runMistralTranscription;
  runtime: Pick<typeof capabilityRuntime, "invoke">;
  registry: Pick<typeof capabilityRegistryInvoker, "prepare" | "invoke" | "resolve">;
  artifacts: CapabilityArtifactIo;
};

const defaultTranscriptionResolverDependencies: TranscriptionResolverDependencies = {
  selectNode: selectedNodeDocumentAi,
  runNode: runPairedNodeTranscription,
  runMistral: runMistralTranscription,
  runtime: capabilityRuntime,
  registry: capabilityRegistryInvoker,
  artifacts: coreCapabilityArtifactIo,
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

async function requestWithRetry(
  makeRequest: (signal: AbortSignal) => Promise<TranscriptionResult>,
  sleep: (milliseconds: number) => Promise<void>,
  options: { signal?: AbortSignal; attemptTimeoutMs: number },
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (options.signal?.aborted) throw abortError(options.signal);
    const deadline = attemptDeadline(options.signal, options.attemptTimeoutMs);
    try {
      return await awaitWithSignal(
        makeRequest(deadline.signal),
        deadline.signal,
      );
    } catch (error) {
      if (options.signal?.aborted) throw abortError(options.signal);
      if (deadline.timedOut()) {
        lastError = new Error("Mistral transcription attempt timed out");
      } else if (
        error instanceof TranscriptionProviderError &&
        !error.retryable
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

  const adapter =
    options.adapter ?? new MistralTranscriptionAdapter(options.fetch ?? fetch);
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const signal = options.signal;
  let providerStarted = false;
  let accountingSettled = false;
  try {
    providerStarted = true;
    const result = await requestWithRetry(
      async (attemptSignal) => {
        try {
          return await adapter.transcribeSegment({
            ...input,
            model,
            credential: credential.key,
            signal: attemptSignal,
          });
        } catch (error) {
          if (
            error instanceof TranscriptionProviderError &&
            error.status === 401 &&
            credential.source === "user"
          ) {
            await markServiceKeyInvalid(
              userId,
              "transcription",
              credential.invalidationToken,
            );
          }
          throw error;
        }
      },
      sleep,
      {
        signal,
        attemptTimeoutMs:
          options.attemptTimeoutMs ?? TRANSCRIPTION_ATTEMPT_TIMEOUT_MS,
      },
    );
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
  let legacyProvider: Promise<TranscriptionProvider> | null = null;
  const loadLegacy = () =>
    (legacyProvider ??= (async () => {
      const node = await dependencies.selectNode(userId, "transcription");
      const selectedNode =
        node.selected || env.TRANSCRIPTION_PROVIDER === "node";
      if (selectedNode && !node.selected) {
        throw new Error("NODE_TRANSCRIPTION_PLACEMENT_REQUIRED");
      }
      const model = node.selected
        ? `${node.modelId}@${node.modelRevision}`
        : (options.model ?? MISTRAL_TRANSCRIPTION_MODEL);
      return node.selected
        ? {
            id: "node-local" as const,
            model,
            transcribeSegment: (input) =>
              dependencies.runNode(userId, {
                ...input,
                operationId: input.operationId ?? options.operationId,
                attempt: input.attempt,
                maximumSeconds:
                  input.maximumSeconds ?? options.maximumSeconds,
                signal: input.signal ?? options.signal,
              }),
          }
        : {
            id: "mistral" as const,
            model,
            transcribeSegment: (input) =>
              dependencies.runMistral(userId, input, {
                ...options,
                operationId: input.operationId ?? options.operationId,
                maximumSeconds:
                  input.maximumSeconds ?? options.maximumSeconds,
                signal: input.signal ?? options.signal,
              }),
          };
    })());
  const purpose = options.purpose ?? "recordings.course-transcription";
  const registryProvider = async (): Promise<TranscriptionProvider> => {
    const { offering } = await dependencies.registry.prepare({
      ownerId: userId,
      capability: "speech.transcribe",
      purpose,
      projectId: options.projectId,
      workflowId: options.workflowId,
      refreshOfferings: true,
      signal: options.signal,
    });
    if (offering.capability !== "speech.transcribe") {
      throw new Error("TRANSCRIPTION_CAPABILITY_ROUTE_MISMATCH");
    }
    const route = {
      provider: offering.provider,
      modelId: offering.modelId,
      modelRevision: offering.modelRevision,
    };
    return {
      id: "capability-registry",
      model: `${offering.modelId}@${offering.modelRevision}`,
      transcribeSegment: async (input) => {
        const signal =
          input.signal ?? options.signal ?? new AbortController().signal;
        const operationId =
          input.operationId ?? options.operationId ?? crypto.randomUUID();
        const normalizedMimeType =
          input.mimeType === "audio/x-wav"
            ? "audio/wav"
            : input.mimeType === "audio/m4a"
              ? "audio/mp4"
              : input.mimeType;
        const bytes = new Uint8Array(await input.blob.arrayBuffer());
        const source = await dependencies.artifacts.write({
          ownerId: userId,
          operationId,
          bytes,
          mimeType: normalizedMimeType,
          nameHint: `${operationId}-transcription-source`,
          purpose: "course-media",
          signal,
        });
        const result = await dependencies.registry.invoke({
          ownerId: userId,
          capability: "speech.transcribe",
          purpose,
          projectId: options.projectId,
          workflowId: options.workflowId,
          request: {
            schemaVersion: 1,
            source,
            mimeType: normalizedMimeType,
            ...(input.language ? { language: input.language } : {}),
            timestamps: "segment",
            diarization: false,
            maximumSeconds:
              input.maximumSeconds ?? options.maximumSeconds ?? 14_400,
          },
          idempotencyKey: `transcription:${operationId}`,
          route,
          requirements: {
            requiredFeatures: ["timestamps.segment"],
            inputBytes: bytes.byteLength,
            batchSize: 1,
            ...(input.language ? { language: input.language } : {}),
          },
          signal,
        });
        return {
          text: result.text,
          ...(result.language === "unknown"
            ? {}
            : { language: result.language }),
          segments: result.segments.map((segment) => ({
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
          })),
        };
      },
    };
  };
  return dependencies.runtime.invoke({
    ownerId: userId,
    capability: "speech.transcribe",
    purpose,
    legacy: {
      resolve: async () => {
        const provider = await loadLegacy();
        return {
          offeringId: null,
          routeKey: `${provider.id}:${provider.model}`,
          provider: provider.id,
          modelId: provider.model,
          reason: "legacy-connection",
        };
      },
      execute: loadLegacy,
    },
    registry: {
      resolve: () =>
        dependencies.registry.resolve({
          ownerId: userId,
          capability: "speech.transcribe",
          purpose,
          projectId: options.projectId,
          workflowId: options.workflowId,
        }),
      execute: registryProvider,
    },
  });
}

export type TranscriptionResolverTestDependencies = Partial<TranscriptionResolverDependencies>;
