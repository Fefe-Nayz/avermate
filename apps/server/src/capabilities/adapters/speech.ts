import {
  speechSynthesisRequestV1Schema,
  speechSynthesisResultV1Schema,
  type CapabilityOfferingSnapshot,
  type UnaryCapabilityAdapter,
} from "@avermate/agent-contracts";
import type { CapabilityArtifactIo } from "../artifact-io";
import type { SpeechSynthesisChunkAdapter } from "../providers/speech-synthesis";

const MAX_CHARS_PER_PROVIDER_REQUEST = 3_500;
const MAX_PROVIDER_REQUESTS = 32;

function hardChunks(value: string) {
  const points = Array.from(value);
  const result: string[] = [];
  for (
    let offset = 0;
    offset < points.length;
    offset += MAX_CHARS_PER_PROVIDER_REQUEST
  ) {
    result.push(points.slice(offset, offset + MAX_CHARS_PER_PROVIDER_REQUEST).join(""));
  }
  return result;
}

function speechChunks(raw: string) {
  const text = raw.replace(/\s+/gu, " ").trim();
  if (!text) return [];
  const chunks: string[] = [];
  let current = "";
  const flush = () => {
    if (current) chunks.push(current);
    current = "";
  };
  for (const sentence of text.split(/(?<=[.!?…])\s+/u)) {
    if (Array.from(sentence).length > MAX_CHARS_PER_PROVIDER_REQUEST) {
      flush();
      chunks.push(...hardChunks(sentence));
      continue;
    }
    const candidate = current ? `${current} ${sentence}` : sentence;
    if (Array.from(candidate).length <= MAX_CHARS_PER_PROVIDER_REQUEST) {
      current = candidate;
    } else {
      flush();
      current = sentence;
    }
  }
  flush();
  return chunks;
}

function combine(chunks: readonly Uint8Array[], maximumBytes: number) {
  const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  if (total < 1 || total > maximumBytes) {
    throw new Error("SPEECH_CAPABILITY_OUTPUT_LIMIT_EXCEEDED");
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

/** Contract adapter: one logical attempt, no credential lookup, retry or accounting. */
export class SpeechSynthesisCapabilityAdapter
  implements UnaryCapabilityAdapter<"speech.synthesize">
{
  readonly kind = "speech.synthesize" as const;

  constructor(
    private readonly offering: CapabilityOfferingSnapshot<"speech.synthesize">,
    private readonly provider: SpeechSynthesisChunkAdapter,
    private readonly artifacts: CapabilityArtifactIo,
  ) {
    if (
      offering.adapterRevision !== provider.adapterRevision ||
      offering.provider !== provider.providerId
    ) {
      throw new Error("SPEECH_CAPABILITY_ADAPTER_DESCRIPTOR_MISMATCH");
    }
  }

  descriptor() {
    return this.offering;
  }

  async invoke(context: Parameters<UnaryCapabilityAdapter<"speech.synthesize">["invoke"]>[0], rawInput: Parameters<UnaryCapabilityAdapter<"speech.synthesize">["invoke"]>[1]) {
    const input = speechSynthesisRequestV1Schema.parse(rawInput);
    const inputBytes = new TextEncoder().encode(input.text).byteLength;
    const maximumInput = this.offering.limits.maxInputBytes;
    if (maximumInput !== null && inputBytes > maximumInput) {
      throw new Error("SPEECH_CAPABILITY_INPUT_LIMIT_EXCEEDED");
    }
    if (
      input.output.container !== "mp3" ||
      input.output.sampleRate !== undefined ||
      input.alignment !== "none" ||
      input.speed !== undefined ||
      input.voice.mode !== "exact"
    ) {
      throw new Error("SPEECH_CAPABILITY_FEATURE_UNSUPPORTED");
    }
    const chunks = speechChunks(input.text);
    if (chunks.length < 1 || chunks.length > MAX_PROVIDER_REQUESTS) {
      throw new Error("SPEECH_CAPABILITY_PROVIDER_REQUEST_LIMIT_EXCEEDED");
    }
    const credential = await context.credential("apiKey");
    if (!credential) throw new Error("SPEECH_CAPABILITY_CREDENTIAL_UNAVAILABLE");

    const generated: Uint8Array[] = [];
    const providerRequestIds: string[] = [];
    for (const chunk of chunks) {
      await context.authorize();
      const result = await this.provider.synthesizeChunk({
        text: chunk,
        model: this.offering.modelId,
        voiceId:
          input.voice.voiceId === "default" ? null : input.voice.voiceId,
        credential: credential.secret,
        signal: context.signal,
      });
      if (result.mimeType !== "audio/mpeg") {
        throw new Error("SPEECH_CAPABILITY_PROVIDER_MIME_MISMATCH");
      }
      generated.push(result.audio);
      if (result.providerRequestId) providerRequestIds.push(result.providerRequestId);
    }
    const bytes = combine(
      generated,
      this.offering.limits.maxOutputBytes ?? 100 * 1024 * 1024,
    );

    // Re-check consent, lease and operation cancellation before publishing bytes.
    await context.authorize();
    const audio = await this.artifacts.write({
      ownerId: context.ownerId,
      operationId: context.operationId,
      bytes,
      mimeType: "audio/mpeg",
      nameHint: `${context.operationId}.mp3`,
      signal: context.signal,
    });
    return speechSynthesisResultV1Schema.parse({
      schemaVersion: 1,
      audio,
      mimeType: "audio/mpeg",
      durationSeconds: "unknown",
      voice: {
        providerVoiceId: input.voice.voiceId,
        revision: input.voice.voiceRevision ?? null,
      },
      alignment: null,
      usage: {
        version: 1,
        items: [
          {
            unit: "character",
            quantity: String(Array.from(input.text).length),
            source: "measured",
          },
        ],
        cost: {
          amountMinor: null,
          currency: null,
          authoritative: false,
          pricingSnapshotId: null,
        },
      },
      providerMetadata: {
        provider: this.offering.provider,
        modelId: this.offering.modelId,
        chunkCount: chunks.length,
        providerRequestCount: chunks.length,
        providerRequestId: providerRequestIds.at(-1) ?? null,
      },
    });
  }
}
