import {
  ocrRequestV1Schema,
  ocrResultV1Schema,
  type CapabilityOfferingSnapshot,
  type UnaryCapabilityAdapter,
} from "@avermate/agent-contracts";
import type { CapabilityArtifactIo } from "../artifact-io";
import type { OcrDocumentAdapter } from "../providers/ocr";

function extension(mimeType: string) {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/webp") return "webp";
  return "bin";
}

/** Contract adapter for one provider upload+OCR logical attempt. */
export class OcrCapabilityAdapter
  implements UnaryCapabilityAdapter<"document.ocr">
{
  readonly kind = "document.ocr" as const;

  constructor(
    private readonly offering: CapabilityOfferingSnapshot<"document.ocr">,
    private readonly provider: OcrDocumentAdapter,
    private readonly artifacts: CapabilityArtifactIo,
  ) {
    if (
      offering.adapterRevision !== provider.adapterRevision ||
      offering.provider !== provider.providerId
    ) {
      throw new Error("OCR_CAPABILITY_ADAPTER_DESCRIPTOR_MISMATCH");
    }
  }

  descriptor() {
    return this.offering;
  }

  async invoke(
    context: Parameters<UnaryCapabilityAdapter<"document.ocr">["invoke"]>[0],
    rawInput: Parameters<UnaryCapabilityAdapter<"document.ocr">["invoke"]>[1],
  ) {
    const input = ocrRequestV1Schema.parse(rawInput);
    const specification = this.offering.specification;
    if (
      input.source.object.ownerId !== context.ownerId ||
      input.source.mimeType !== input.mimeType ||
      !specification.inputMimeTypes.includes(input.mimeType) ||
      input.source.byteSize > specification.maxBytes ||
      input.maximumPages > specification.maxPages
    ) {
      throw new Error("OCR_CAPABILITY_INPUT_UNSUPPORTED");
    }
    // The reviewed Mistral endpoint processes the entire document and has no
    // page/language filter. Reject those requests rather than silently spending
    // on a broader operation than the frozen input describes.
    if (input.pages !== undefined || input.languageHints !== undefined) {
      throw new Error("OCR_CAPABILITY_FILTER_UNSUPPORTED");
    }
    const maximumInput = this.offering.limits.maxInputBytes;
    if (maximumInput !== null && input.source.byteSize > maximumInput) {
      throw new Error("OCR_CAPABILITY_INPUT_LIMIT_EXCEEDED");
    }
    const bytes = await this.artifacts.read(context.ownerId, input.source, {
      maximumBytes: Math.min(
        specification.maxBytes,
        maximumInput ?? specification.maxBytes,
      ),
      signal: context.signal,
    });
    const credential = await context.credential("apiKey");
    if (!credential) throw new Error("OCR_CAPABILITY_CREDENTIAL_UNAVAILABLE");
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    await context.authorize();
    const result = await this.provider.run({
      file: {
        blob: new Blob([blobBytes.buffer], { type: input.mimeType }),
        name: `${context.operationId}.${extension(input.mimeType)}`,
      },
      model: this.offering.modelId,
      credential: credential.secret,
      signal: context.signal,
      // Retained by the compatibility transport type; the adapter performs no retry.
      sleep: async () => undefined,
    });
    if (result.pageCount > input.maximumPages) {
      throw new Error("OCR_CAPABILITY_PAGE_LIMIT_EXCEEDED");
    }
    return ocrResultV1Schema.parse({
      schemaVersion: 1,
      pages: result.pages.map((page) => ({
        page: page.providerIndex + 1,
        markdown: input.requestedFeatures.markdown ? page.markdown : null,
        plainText: page.markdown,
        blocks: input.requestedFeatures.blocks
          ? [
              {
                id: `page-${page.providerIndex + 1}-content`,
                kind: "paragraph",
                text: page.markdown,
                bbox: null,
                confidence: null,
                assetRef: null,
              },
            ]
          : [],
      })),
      pageCount: result.pageCount,
      language: "unknown",
      usage: {
        version: 1,
        items: [
          {
            unit: "page",
            quantity: String(result.pageCount),
            source: "provider",
          },
        ],
        cost: {
          amountMinor: null,
          currency: null,
          authoritative: false,
          pricingSnapshotId: null,
        },
      },
      providerMetadata: { providerFileId: result.providerFileId },
    });
  }
}
