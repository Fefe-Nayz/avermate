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
import { runPairedNodeOcr, selectedNodeDocumentAi } from "../node/document-ai";
import {
  MISTRAL_OCR_MODEL,
  MistralOcrAdapter,
  OcrProviderError,
  type OcrDocumentAdapter,
  type OcrProviderFetcher,
} from "../capabilities/providers/ocr";
import { capabilityRuntime } from "../capabilities/runtime";
import { capabilityRegistryInvoker } from "../capabilities/registry-invoker";
import { coreCapabilityArtifactIo, type CapabilityArtifactIo } from "../capabilities/artifact-io";

export { MISTRAL_OCR_MODEL };

const OCR_MAX_ATTEMPTS = 6;

export interface MistralOcrResult {
  markdown: string;
  pageCount: number;
  providerFileId: string;
  /** Exact provider page boundaries; consumers must not reconstruct these from Markdown. */
  pages?: Array<{ providerIndex: number; markdown: string }>;
}

export interface OcrProvider {
  id: "mistral" | "node-local" | "capability-registry";
  model: string;
  run(
    file: { blob: Blob; name: string },
    options?: Pick<
      MistralOcrOptions,
      "maxPages" | "operationId" | "signal" | "language"
      | "attempt"
    >,
  ): Promise<MistralOcrResult>;
}

export interface MistralOcrOptions {
  fetch?: OcrProviderFetcher;
  sleep?: (milliseconds: number) => Promise<void>;
  /** Test seam; production always resolves the user's sealed key first. */
  key?: string;
  /** Test seam; production always requests the exact Mistral route. */
  resolveCredential?: typeof resolveProviderServiceKey;
  maxPages?: number;
  model?: string;
  /** Durable run/job id used to make managed accounting idempotent. */
  operationId?: string;
  signal?: AbortSignal;
  /** ISO/provider language hint. Node defaults to the pinned fra+eng pack. */
  language?: string;
  attempt?: number;
  /** Provider-attempt seam used by registry/conformance tests. */
  adapter?: OcrDocumentAdapter;
  /** Provider-neutral workflow purpose used by the capability policy. */
  purpose?: string;
  /** Trusted project/workflow scope supplied by the owning server workflow. */
  projectId?: string;
  workflowId?: string;
}

type OcrResolverDependencies = {
  selectNode: typeof selectedNodeDocumentAi;
  runNode: typeof runPairedNodeOcr;
  runMistral: typeof runMistralOcr;
  runtime: Pick<typeof capabilityRuntime, "invoke">;
  registry: Pick<typeof capabilityRegistryInvoker, "prepare" | "invoke" | "resolve">;
  artifacts: CapabilityArtifactIo;
};

const defaultOcrResolverDependencies: OcrResolverDependencies = {
  selectNode: selectedNodeDocumentAi,
  runNode: runPairedNodeOcr,
  runMistral: runMistralOcr,
  runtime: capabilityRuntime,
  registry: capabilityRegistryInvoker,
  artifacts: coreCapabilityArtifactIo,
};

function ocrDisabled() {
  const runtime = process.env.DISABLE_OCR;
  return env.DISABLE_OCR || runtime === "true" || runtime === "1";
}

export async function ocrEnabled(userId?: string) {
  if (ocrDisabled()) return false;
  if (!userId) {
    return operatorServiceKeysEnabled() && Boolean(env.MISTRAL_API_KEY);
  }
  try {
    const node = await selectedNodeDocumentAi(userId, "ocr");
    if (node.selected) return true;
  } catch {
    return false;
  }
  if (env.OCR_PROVIDER === "node") return false;
  return Boolean(await resolveProviderServiceKey(userId, "mistral", "mistral"));
}

function credentialForTests(key: string): ResolvedServiceKey {
  return { key, source: "operator" };
}

/** Retry whole logical attempts; provider adapters themselves never retry. */
export async function runMistralOcr(
  userId: string,
  file: { blob: Blob; name: string },
  options: MistralOcrOptions = {},
): Promise<MistralOcrResult> {
  if (ocrDisabled()) {
    throw new Error(
      "OCR is disabled on this server. Enable it in server configuration first.",
    );
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
      "OCR is not configured. Add a Mistral key in Settings → Integrations.",
    );
  }

  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const model = options.model ?? MISTRAL_OCR_MODEL;
  const maxPages = options.maxPages ?? env.OCR_MAX_PAGES_PER_DOCUMENT;
  if (!Number.isSafeInteger(maxPages) || maxPages <= 0) {
    throw new Error("OCR page limit must be a positive integer");
  }
  const reservation = await reserveManagedProviderUsage({
    credential,
    accountId: userId,
    operationId: options.operationId,
    capability: "ocr.pages",
    unit: "pages",
    maximumQuantity: String(maxPages),
    provider: "mistral",
    model,
    estimatorVersion: "ocr-configured-page-limit/1",
  });
  let providerStarted = false;
  let accountingSettled = false;
  try {
    providerStarted = true;
    const adapter =
      options.adapter ?? new MistralOcrAdapter(options.fetch ?? fetch);
    let result: MistralOcrResult | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < OCR_MAX_ATTEMPTS; attempt += 1) {
      options.signal?.throwIfAborted();
      try {
        result = await adapter.run({
          file,
          model,
          credential: credential.key,
          sleep,
          signal: options.signal,
        });
        break;
      } catch (error) {
        if (
          error instanceof OcrProviderError &&
          (error.status === 401 || error.status === 403) &&
          credential.source === "user"
        ) {
          await markServiceKeyInvalid(
            userId,
            "mistral",
            credential.invalidationToken,
          );
        }
        lastError = error;
        if (error instanceof OcrProviderError && !error.retryable) throw error;
      }
      if (attempt < OCR_MAX_ATTEMPTS - 1) {
        await sleep(Math.min(20_000, 1_000 * 2 ** attempt));
      }
    }
    if (!result) {
      throw lastError instanceof Error
        ? lastError
        : new Error("Mistral OCR could not be reached");
    }
    await settleManagedProviderUsage(reservation, {
      actualQuantity: String(result.pageCount),
      outcome: "completed",
      authoritative: true,
      evidenceRef: `mistral-file:${result.providerFileId}`,
    });
    accountingSettled = true;
    if (result.pageCount > maxPages) {
      throw new Error(
        `OCR result has ${result.pageCount} pages; the configured limit is ${maxPages}`,
      );
    }
    return result;
  } catch (error) {
    if (reservation && providerStarted && !accountingSettled) {
      await settleManagedProviderUsage(reservation, {
        actualQuantity: reservation.maximumQuantity,
        outcome: options.signal?.aborted ? "cancelled" : "failed",
        authoritative: false,
        evidenceRef: "mistral-ocr-ambiguous-failure",
      }).catch(() => undefined);
    }
    throw error;
  }
}

/** Resolve once from persisted models placement; an unavailable Node never falls back. */
export async function resolveOcrProvider(
  userId: string,
  options: MistralOcrOptions = {},
  overrides: Partial<OcrResolverDependencies> = {},
): Promise<OcrProvider> {
  const dependencies = { ...defaultOcrResolverDependencies, ...overrides };
  let legacyProvider: Promise<OcrProvider> | null = null;
  const loadLegacy = () =>
    (legacyProvider ??= (async () => {
      const node = await dependencies.selectNode(userId, "ocr");
      const selectedNode = node.selected || env.OCR_PROVIDER === "node";
      if (selectedNode && !node.selected) {
        throw new Error("NODE_OCR_PLACEMENT_REQUIRED");
      }
      const model = node.selected
        ? `${node.modelId}@${node.modelRevision}`
        : (options.model ?? MISTRAL_OCR_MODEL);
      return node.selected
        ? {
            id: "node-local" as const,
            model,
            run: (file, input = {}) =>
              dependencies.runNode(userId, file, {
                maxPages: input.maxPages ?? options.maxPages,
                operationId: input.operationId ?? options.operationId,
                attempt: input.attempt ?? options.attempt,
                signal: input.signal ?? options.signal,
                language: input.language ?? options.language,
              }),
          }
        : {
            id: "mistral" as const,
            model,
            run: (file, input = {}) =>
              dependencies.runMistral(userId, file, {
                ...options,
                maxPages: input.maxPages ?? options.maxPages,
                operationId: input.operationId ?? options.operationId,
                signal: input.signal ?? options.signal,
              }),
          };
    })());
  const purpose = options.purpose ?? "materials.ocr";
  const registryProvider = async (): Promise<OcrProvider> => {
    const { offering } = await dependencies.registry.prepare({
      ownerId: userId,
      capability: "document.ocr",
      purpose,
      projectId: options.projectId,
      workflowId: options.workflowId,
      refreshOfferings: true,
      signal: options.signal,
    });
    if (offering.capability !== "document.ocr") {
      throw new Error("OCR_CAPABILITY_ROUTE_MISMATCH");
    }
    const route = {
      provider: offering.provider,
      modelId: offering.modelId,
      modelRevision: offering.modelRevision,
    };
    return {
      id: "capability-registry",
      model: `${offering.modelId}@${offering.modelRevision}`,
      run: async (file, input = {}) => {
        const signal =
          input.signal ?? options.signal ?? new AbortController().signal;
        const operationId =
          input.operationId ?? options.operationId ?? crypto.randomUUID();
        const mimeType = file.blob.type.split(";", 1)[0]!.trim().toLowerCase();
        if (
          !["application/pdf", "image/png", "image/jpeg", "image/webp"].includes(
            mimeType,
          )
        ) {
          throw new Error("OCR_CAPABILITY_MIME_UNSUPPORTED");
        }
        const bytes = new Uint8Array(await file.blob.arrayBuffer());
        const source = await dependencies.artifacts.write({
          ownerId: userId,
          operationId,
          bytes,
          mimeType,
          nameHint: file.name,
          purpose: "grade-copy",
          signal,
        });
        const result = await dependencies.registry.invoke({
          ownerId: userId,
          capability: "document.ocr",
          purpose,
          projectId: options.projectId,
          workflowId: options.workflowId,
          request: {
            schemaVersion: 1,
            source,
            mimeType,
            ...(input.language ?? options.language
              ? { languageHints: [input.language ?? options.language!] }
              : {}),
            requestedFeatures: {
              markdown: true,
              blocks: false,
              tables: true,
              formulas: true,
              images: false,
            },
            maximumPages:
              input.maxPages ??
              options.maxPages ??
              env.OCR_MAX_PAGES_PER_DOCUMENT,
          },
          idempotencyKey: `ocr:${operationId}`,
          route,
          requirements: {
            requiredFeatures: ["native-pdf", "images", "tables", "formulas"],
            inputBytes: bytes.byteLength,
            batchSize: 1,
            ...(input.language ?? options.language
              ? { language: input.language ?? options.language! }
              : {}),
          },
          signal,
        });
        const pages = result.pages.map((page) => ({
          providerIndex: page.page - 1,
          markdown: page.markdown ?? page.plainText ?? "",
        }));
        const providerFileId = result.providerMetadata?.providerFileId;
        return {
          markdown: pages.map((page) => page.markdown).join("\n\n"),
          pageCount: result.pageCount,
          providerFileId:
            typeof providerFileId === "string"
              ? providerFileId
              : `capability:${operationId}`,
          pages,
        };
      },
    };
  };
  return dependencies.runtime.invoke({
    ownerId: userId,
    capability: "document.ocr",
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
          capability: "document.ocr",
          purpose,
          projectId: options.projectId,
          workflowId: options.workflowId,
        }),
      execute: registryProvider,
    },
  });
}

export type OcrResolverTestDependencies = Partial<OcrResolverDependencies>;
