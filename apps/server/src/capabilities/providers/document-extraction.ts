import { extractText, getDocumentProxy } from "unpdf";

export type NativePdfExtraction = {
  totalPages: number;
  pages: readonly { page: number; text: string }[];
};

const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_PDF_PAGES = 10_000;
const MAX_PDF_TEXT_BYTES = 64 * 1024 * 1024;

function utf8Size(value: string) {
  return new TextEncoder().encode(value).byteLength;
}

function abortReason(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("PDF native extraction was cancelled");
}

/** Deterministic, network-free `document.extract` adapter for PDF text layers. */
export class NativePdfDocumentExtractionAdapter {
  readonly providerId = "avermate-native-pdf";
  readonly adapterRevision = "unpdf-text-layer/1";

  async extract(
    bytes: ArrayBuffer | Uint8Array,
    options: { timeoutMs?: number; signal?: AbortSignal } = {},
  ): Promise<NativePdfExtraction> {
    const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (input.byteLength > MAX_PDF_BYTES) {
      throw new Error("PDF exceeds the native extraction byte limit");
    }
    options.signal?.throwIfAborted();
    const pdf = await getDocumentProxy(input, {
      maxImageSize: 16_777_216,
      stopAtErrors: false,
    });
    if (pdf.numPages < 1 || pdf.numPages > MAX_PDF_PAGES) {
      await pdf.cleanup();
      throw new Error("PDF page count exceeds the native extraction limit");
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abort: (() => void) | undefined;
    try {
      const timeout = new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("PDF native text extraction timed out")),
          options.timeoutMs ?? 45_000,
        );
      });
      const cancelled = options.signal
        ? new Promise<never>((_resolve, reject) => {
            abort = () => reject(abortReason(options.signal!));
            options.signal!.addEventListener("abort", abort, { once: true });
          })
        : new Promise<never>(() => undefined);
      const result = await Promise.race([
        extractText(pdf, { mergePages: false }),
        timeout,
        cancelled,
      ]);
      const pages = result.text.map((text, index) => ({
        page: index + 1,
        text: text.replaceAll("\0", "").replace(/\r\n?/g, "\n").trim(),
      }));
      const byteSize = pages.reduce(
        (total, page) => total + utf8Size(page.text),
        0,
      );
      if (byteSize > MAX_PDF_TEXT_BYTES) {
        throw new Error("PDF text layer exceeds the extraction output limit");
      }
      return { totalPages: result.totalPages, pages };
    } finally {
      clearTimeout(timer);
      if (abort) options.signal?.removeEventListener("abort", abort);
      await pdf.cleanup().catch(() => undefined);
    }
  }
}

export const nativePdfDocumentExtractionAdapter =
  new NativePdfDocumentExtractionAdapter();
