import {
  documentExtractionRequestV1Schema,
  documentExtractionResultV1Schema,
  type CapabilityOfferingSnapshot,
  type UnaryCapabilityAdapter,
} from "@avermate/agent-contracts";
import type { CapabilityArtifactIo } from "../artifact-io";
import type { NativePdfDocumentExtractionAdapter } from "../providers/document-extraction";

/** Deterministic, network-free PDF extraction under the same operation fences. */
export class DocumentExtractionCapabilityAdapter
  implements UnaryCapabilityAdapter<"document.extract">
{
  readonly kind = "document.extract" as const;

  constructor(
    private readonly offering: CapabilityOfferingSnapshot<"document.extract">,
    private readonly provider: NativePdfDocumentExtractionAdapter,
    private readonly artifacts: CapabilityArtifactIo,
  ) {
    if (
      offering.adapterRevision !== provider.adapterRevision ||
      offering.provider !== provider.providerId ||
      !offering.specification.deterministic
    ) {
      throw new Error("DOCUMENT_EXTRACTION_ADAPTER_DESCRIPTOR_MISMATCH");
    }
  }

  descriptor() {
    return this.offering;
  }

  async invoke(
    context: Parameters<UnaryCapabilityAdapter<"document.extract">["invoke"]>[0],
    rawInput: Parameters<UnaryCapabilityAdapter<"document.extract">["invoke"]>[1],
  ) {
    const input = documentExtractionRequestV1Schema.parse(rawInput);
    if (
      input.source.object.ownerId !== context.ownerId ||
      input.source.mimeType !== input.mimeType ||
      input.mimeType !== "application/pdf" ||
      !this.offering.specification.inputMimeTypes.includes(input.mimeType) ||
      input.maximumBytes > this.offering.specification.maxBytes ||
      input.source.byteSize > input.maximumBytes ||
      (this.offering.limits.maxInputBytes !== null &&
        input.source.byteSize > this.offering.limits.maxInputBytes)
    ) {
      throw new Error("DOCUMENT_EXTRACTION_INPUT_UNSUPPORTED");
    }
    const bytes = await this.artifacts.read(context.ownerId, input.source, {
      maximumBytes: input.maximumBytes,
      signal: context.signal,
    });
    await context.authorize();
    const extracted = await this.provider.extract(bytes, {
      timeoutMs: Math.max(
        1,
        Math.min(45_000, context.deadline.getTime() - Date.now()),
      ),
      signal: context.signal,
    });
    return documentExtractionResultV1Schema.parse({
      schemaVersion: 1,
      document: {
        title: null,
        language: null,
        sections: extracted.pages.map((page) => ({
          headingPath: [],
          markdown: page.text,
          sourceLocator: { kind: "page", value: String(page.page) },
        })),
        assets: [],
      },
      extractionPath: [
        {
          stage: "pdf-text-layer",
          implementation: this.provider.providerId,
          revision: this.provider.adapterRevision,
        },
      ],
      usage: {
        version: 1,
        items: [
          {
            unit: "page",
            quantity: String(extracted.totalPages),
            source: "measured",
          },
        ],
        cost: {
          amountMinor: "0",
          currency: "EUR",
          authoritative: true,
          pricingSnapshotId: null,
        },
      },
      providerMetadata: { deterministic: true },
    });
  }
}
