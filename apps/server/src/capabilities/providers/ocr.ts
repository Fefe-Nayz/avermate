/** Provider-attempt adapters for `document.ocr`. */

export const MISTRAL_OCR_MODEL = "mistral-ocr-latest";
export const MISTRAL_FILES_URL = "https://api.mistral.ai/v1/files";
export const MISTRAL_OCR_URL = "https://api.mistral.ai/v1/ocr";
const MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_PROVIDER_ERROR_BYTES = 64 * 1024;

export type OcrProviderFetcher = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type OcrDocumentResult = {
  markdown: string;
  pageCount: number;
  providerFileId: string;
  pages: Array<{ providerIndex: number; markdown: string }>;
};

export type OcrDocumentRequest = {
  file: { blob: Blob; name: string };
  model: string;
  credential: string;
  signal?: AbortSignal;
  sleep: (milliseconds: number) => Promise<void>;
};

export interface OcrDocumentAdapter {
  readonly providerId: string;
  readonly adapterRevision: string;
  run(input: OcrDocumentRequest): Promise<OcrDocumentResult>;
}

export class OcrProviderError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "OcrProviderError";
  }
}

function abortReason(signal?: AbortSignal) {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("OCR request was cancelled");
}

async function boundedText(
  response: Response,
  maximumBytes: number,
  signal?: AbortSignal,
) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error("Mistral OCR response exceeds the configured limit");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  let total = 0;
  try {
    while (true) {
      if (signal?.aborted) throw abortReason(signal);
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw new Error("Mistral OCR response exceeds the configured limit");
      }
      text += decoder.decode(part.value, { stream: true });
    }
    return text + decoder.decode();
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
    ? `Mistral OCR returned ${status}: ${safe}`
    : `Mistral OCR returned ${status}`;
}

async function requestOnce(
  makeRequest: () => Promise<Response>,
  input: Pick<OcrDocumentRequest, "credential" | "signal">,
) {
  if (input.signal?.aborted) throw abortReason(input.signal);
  const response = await makeRequest();
  const body = await boundedText(
    response,
    response.ok ? MAX_PROVIDER_RESPONSE_BYTES : MAX_PROVIDER_ERROR_BYTES,
    input.signal,
  );
  if (!response.ok) {
    throw new OcrProviderError(
      providerMessage(response.status, body, input.credential),
      response.status,
      [429, 500, 502, 503, 504].includes(response.status),
    );
  }
  return { response, body };
}

function parseJson(body: string) {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error("Mistral OCR returned malformed JSON");
  }
}

export class MistralOcrAdapter implements OcrDocumentAdapter {
  readonly providerId = "mistral";
  readonly adapterRevision = "mistral-files-ocr/1";

  constructor(
    private readonly fetcher: OcrProviderFetcher = fetch,
  ) {}

  async run(input: OcrDocumentRequest): Promise<OcrDocumentResult> {
    const headers = { Authorization: `Bearer ${input.credential}` };
    const upload = await requestOnce(
      () => {
        const form = new FormData();
        form.append("purpose", "ocr");
        form.append(
          "file",
          new File([input.file.blob], input.file.name, {
            type: input.file.blob.type || "application/octet-stream",
          }),
        );
        return this.fetcher(MISTRAL_FILES_URL, {
          method: "POST",
          headers,
          body: form,
          signal: input.signal,
        });
      },
      input,
    );
    const uploaded = parseJson(upload.body) as { id?: unknown };
    if (typeof uploaded.id !== "string" || !uploaded.id) {
      throw new Error("Mistral OCR did not return an uploaded file id");
    }
    const ocr = await requestOnce(
      () =>
        this.fetcher(MISTRAL_OCR_URL, {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            document: { file_id: uploaded.id },
            model: input.model,
            include_image_base64: false,
          }),
          signal: input.signal,
        }),
      input,
    );
    const parsed = parseJson(ocr.body) as { pages?: unknown };
    if (!Array.isArray(parsed.pages)) {
      throw new Error("Mistral OCR did not return a pages array");
    }
    const indexes = new Set<number>();
    const pages = parsed.pages.map((page) => {
      const value = page as { index?: unknown; markdown?: unknown };
      if (
        typeof value.index !== "number" ||
        !Number.isSafeInteger(value.index) ||
        value.index < 0 ||
        indexes.has(value.index) ||
        typeof value.markdown !== "string"
      ) {
        throw new Error("Mistral OCR returned a malformed page");
      }
      indexes.add(value.index);
      return { providerIndex: value.index, markdown: value.markdown };
    });
    return {
      markdown: pages
        .map(
          (page) =>
            `<!-- Page ${page.providerIndex} -->\n${page.markdown}`,
        )
        .join("\n\n"),
      pageCount: pages.length,
      providerFileId: uploaded.id,
      pages,
    };
  }
}
