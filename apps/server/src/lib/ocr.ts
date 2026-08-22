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

export const MISTRAL_OCR_MODEL = "mistral-ocr-latest";
const MISTRAL_FILES_URL = "https://api.mistral.ai/v1/files";
const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const MAX_ATTEMPTS = 6;

type Fetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface MistralOcrResult {
  markdown: string;
  pageCount: number;
  providerFileId: string;
  /** Exact provider page boundaries; consumers must not reconstruct these from Markdown. */
  pages?: Array<{ providerIndex: number; markdown: string }>;
}

export interface OcrProvider {
  id: "mistral" | "node-local";
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
  fetch?: Fetcher;
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
}

type OcrResolverDependencies = {
  selectNode: typeof selectedNodeDocumentAi;
  runNode: typeof runPairedNodeOcr;
  runMistral: typeof runMistralOcr;
};

const defaultOcrResolverDependencies: OcrResolverDependencies = {
  selectNode: selectedNodeDocumentAi,
  runNode: runPairedNodeOcr,
  runMistral: runMistralOcr,
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

function redactSecret(value: string, secret: string) {
  return secret ? value.replaceAll(secret, "[redacted]") : value;
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
  const suffix = redactSecret(detail, secret).trim().slice(0, 300);
  return suffix
    ? `Mistral OCR returned ${status}: ${suffix}`
    : `Mistral OCR returned ${status}`;
}

async function requestWithRetry(
  makeRequest: () => Promise<Response>,
  sleep: (milliseconds: number) => Promise<void>,
  secret: string,
  signal?: AbortSignal,
) {
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    if (signal?.aborted) {
      throw signal.reason instanceof Error
        ? signal.reason
        : new Error("OCR request was cancelled");
    }
    try {
      const response = await makeRequest();
      if (response.ok || !RETRYABLE_STATUSES.has(response.status)) {
        return response;
      }
      lastError = new Error(
        providerMessage(response.status, await response.text(), secret),
      );
    } catch (error) {
      if (signal?.aborted) {
        throw signal.reason instanceof Error
          ? signal.reason
          : new Error("OCR request was cancelled");
      }
      lastError = error;
    }

    if (attempt < MAX_ATTEMPTS - 1) {
      await sleep(Math.min(20_000, 1_000 * 2 ** attempt));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error("Mistral OCR could not be reached");
}

async function checkedJson(response: Response, secret: string) {
  const body = await response.text();
  if (!response.ok) {
    throw new Error(providerMessage(response.status, body, secret));
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Mistral OCR returned malformed JSON");
  }
}

function credentialForTests(key: string): ResolvedServiceKey {
  return { key, source: "operator" };
}

/** Upload one source, then OCR it without re-uploading during request retries. */
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

  const fetcher = options.fetch ?? fetch;
  const sleep =
    options.sleep ??
    ((milliseconds: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const headers = { Authorization: `Bearer ${credential.key}` };
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
    const uploadResponse = await requestWithRetry(
      () => {
        const form = new FormData();
        form.append("purpose", "ocr");
        form.append(
          "file",
          new File([file.blob], file.name, {
            type: file.blob.type || "application/octet-stream",
          }),
        );
        return fetcher(MISTRAL_FILES_URL, {
          method: "POST",
          headers,
          body: form,
          signal: options.signal,
        });
      },
      sleep,
      credential.key,
      options.signal,
    );
    if (uploadResponse.status === 401 && credential.source === "user") {
      await markServiceKeyInvalid(
        userId,
        "mistral",
        credential.invalidationToken,
      );
    }
    const upload = (await checkedJson(uploadResponse, credential.key)) as {
      id?: unknown;
    };
    if (typeof upload.id !== "string" || !upload.id) {
      throw new Error("Mistral OCR did not return an uploaded file id");
    }

    const ocrResponse = await requestWithRetry(
      () =>
        fetcher(MISTRAL_OCR_URL, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            document: { file_id: upload.id },
            model,
            include_image_base64: false,
          }),
          signal: options.signal,
        }),
      sleep,
      credential.key,
      options.signal,
    );
    if (ocrResponse.status === 401 && credential.source === "user") {
      await markServiceKeyInvalid(
        userId,
        "mistral",
        credential.invalidationToken,
      );
    }
    const ocr = (await checkedJson(ocrResponse, credential.key)) as {
      pages?: unknown;
    };
    if (!Array.isArray(ocr.pages)) {
      throw new Error("Mistral OCR did not return a pages array");
    }
    const pages = ocr.pages.map((page) => {
      const value = page as { index?: unknown; markdown?: unknown };
      if (
        typeof value.index !== "number" ||
        typeof value.markdown !== "string"
      ) {
        throw new Error("Mistral OCR returned a malformed page");
      }
      return { index: value.index, markdown: value.markdown };
    });
    await settleManagedProviderUsage(reservation, {
      actualQuantity: String(pages.length),
      outcome: "completed",
      authoritative: true,
      evidenceRef: `mistral-file:${upload.id}`,
    });
    accountingSettled = true;
    if (pages.length > maxPages) {
      throw new Error(
        `OCR result has ${pages.length} pages; the configured limit is ${maxPages}`,
      );
    }

    return {
      markdown: pages
        .map((page) => `<!-- Page ${page.index} -->\n${page.markdown}`)
        .join("\n\n"),
      pageCount: pages.length,
      providerFileId: upload.id,
      pages: pages.map((page) => ({
        providerIndex: page.index,
        markdown: page.markdown,
      })),
    };
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
  const node = await dependencies.selectNode(userId, "ocr");
  if (node.selected || env.OCR_PROVIDER === "node") {
    if (!node.selected) throw new Error("NODE_OCR_PLACEMENT_REQUIRED");
    return {
      id: "node-local",
      model: `${node.modelId}@${node.modelRevision}`,
      run: (file, input = {}) =>
        dependencies.runNode(userId, file, {
          maxPages: input.maxPages ?? options.maxPages,
          operationId: input.operationId ?? options.operationId,
          attempt: input.attempt ?? options.attempt,
          signal: input.signal ?? options.signal,
          language: input.language ?? options.language,
        }),
    };
  }
  return {
    id: "mistral",
    model: options.model ?? MISTRAL_OCR_MODEL,
    run: (file, input = {}) =>
      dependencies.runMistral(userId, file, {
        ...options,
        maxPages: input.maxPages ?? options.maxPages,
        operationId: input.operationId ?? options.operationId,
        signal: input.signal ?? options.signal,
      }),
  };
}

export type OcrResolverTestDependencies = Partial<OcrResolverDependencies>;
