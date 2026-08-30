import {
  transcriptionRequestV1Schema,
  transcriptionResultV1Schema,
  type CapabilityOfferingSnapshot,
  type UnaryCapabilityAdapter,
} from "@avermate/agent-contracts";
import type { CapabilityArtifactIo } from "../artifact-io";
import type { TranscriptionSegmentAdapter } from "../providers/transcription";

/** Contract adapter for one bounded STT provider attempt. */
export class TranscriptionCapabilityAdapter
  implements UnaryCapabilityAdapter<"speech.transcribe">
{
  readonly kind = "speech.transcribe" as const;

  constructor(
    private readonly offering: CapabilityOfferingSnapshot<"speech.transcribe">,
    private readonly provider: TranscriptionSegmentAdapter,
    private readonly artifacts: CapabilityArtifactIo,
  ) {
    if (
      offering.adapterRevision !== provider.adapterRevision ||
      offering.provider !== provider.providerId
    ) {
      throw new Error("TRANSCRIPTION_CAPABILITY_ADAPTER_DESCRIPTOR_MISMATCH");
    }
  }

  descriptor() {
    return this.offering;
  }

  async invoke(
    context: Parameters<
      UnaryCapabilityAdapter<"speech.transcribe">["invoke"]
    >[0],
    rawInput: Parameters<
      UnaryCapabilityAdapter<"speech.transcribe">["invoke"]
    >[1],
  ) {
    const input = transcriptionRequestV1Schema.parse(rawInput);
    const specification = this.offering.specification;
    if (
      input.source.object.ownerId !== context.ownerId ||
      input.source.mimeType !== input.mimeType ||
      !specification.inputMimeTypes.includes(input.mimeType) ||
      input.source.byteSize > specification.maxBytes ||
      input.maximumSeconds > specification.maxDurationSeconds
    ) {
      throw new Error("TRANSCRIPTION_CAPABILITY_INPUT_UNSUPPORTED");
    }
    if (
      (input.diarization && !specification.diarization) ||
      !specification.timestamps.includes(input.timestamps) ||
      (input.language !== undefined && !specification.languageHint) ||
      (input.vocabulary !== undefined && !specification.vocabularyHints)
    ) {
      throw new Error("TRANSCRIPTION_CAPABILITY_FEATURE_UNSUPPORTED");
    }
    const maximumInput = this.offering.limits.maxInputBytes;
    if (maximumInput !== null && input.source.byteSize > maximumInput) {
      throw new Error("TRANSCRIPTION_CAPABILITY_INPUT_LIMIT_EXCEEDED");
    }
    const bytes = await this.artifacts.read(context.ownerId, input.source, {
      maximumBytes: Math.min(
        specification.maxBytes,
        maximumInput ?? specification.maxBytes,
      ),
      signal: context.signal,
    });
    const credential = await context.credential("apiKey");
    if (!credential) {
      throw new Error("TRANSCRIPTION_CAPABILITY_CREDENTIAL_UNAVAILABLE");
    }
    await context.authorize();
    const blobBytes = new Uint8Array(bytes.byteLength);
    blobBytes.set(bytes);
    const result = await this.provider.transcribeSegment({
      blob: new Blob([blobBytes.buffer], { type: input.mimeType }),
      mimeType: input.mimeType,
      language: input.language,
      model: this.offering.modelId,
      credential: credential.secret,
      signal: context.signal,
    });
    const segments =
      input.timestamps === "none"
        ? []
        : result.segments.map((segment, index) => ({
            id: `segment-${index + 1}`,
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text,
            speakerId: null,
            confidence: null,
          }));
    const durationMs = result.segments.reduce(
      (maximum, segment) => Math.max(maximum, segment.endMs),
      0,
    );
    const durationSeconds = durationMs > 0 ? durationMs / 1_000 : "unknown";
    return transcriptionResultV1Schema.parse({
      schemaVersion: 1,
      text: result.text,
      language: result.language ?? input.language ?? "unknown",
      durationSeconds,
      segments,
      words: null,
      usage: {
        version: 1,
        items:
          typeof durationSeconds === "number"
            ? [
                {
                  unit: "audio-second",
                  quantity: String(durationSeconds),
                  source: "measured",
                },
              ]
            : [],
        cost: {
          amountMinor: null,
          currency: null,
          authoritative: false,
          pricingSnapshotId: null,
        },
      },
      providerMetadata: null,
    });
  }
}
