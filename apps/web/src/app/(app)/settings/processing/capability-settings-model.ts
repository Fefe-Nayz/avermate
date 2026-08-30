import type {
  CapabilityKind,
  CapabilityPlacementKind,
  DataEgressClass,
} from "@avermate/agent-contracts"

export const CAPABILITY_KINDS = [
  "language.generate",
  "embedding.generate",
  "rerank.score",
  "speech.transcribe",
  "speech.synthesize",
  "document.ocr",
  "document.extract",
  "image.generate",
  "video.generate",
] as const satisfies readonly CapabilityKind[]

export const CAPABILITY_PURPOSES = [
  {
    id: "assistant.chat",
    capability: "language.generate",
    title: "Chat",
  },
  {
    id: "corpus.document-embedding",
    capability: "embedding.generate",
    title: "Document embeddings",
  },
  {
    id: "corpus.reranking",
    capability: "rerank.score",
    title: "Reranking",
  },
  {
    id: "assistant.dictation",
    capability: "speech.transcribe",
    title: "Dictation",
  },
  {
    id: "recordings.course-transcription",
    capability: "speech.transcribe",
    title: "Course transcription",
  },
  {
    id: "materials.ocr",
    capability: "document.ocr",
    title: "Document OCR",
  },
  {
    id: "materials.document-extraction",
    capability: "document.extract",
    title: "Document extraction",
  },
  {
    id: "media.podcast-narration",
    capability: "speech.synthesize",
    title: "Podcast narration",
  },
  {
    id: "media.video-narration",
    capability: "speech.synthesize",
    title: "Video narration",
  },
  {
    id: "media.image-generation",
    capability: "image.generate",
    title: "Image generation",
  },
  {
    id: "media.video-generation",
    capability: "video.generate",
    title: "Video generation",
  },
] as const satisfies ReadonlyArray<{
  id: string
  capability: CapabilityKind
  title: string
}>

const EGRESS_RANK = {
  none: 0,
  "owner-node": 1,
  "avermate-managed": 2,
  "external-provider": 3,
} as const satisfies Record<DataEgressClass, number>

export function isPrivacyEscalation(
  primary: DataEgressClass,
  fallback: DataEgressClass
): boolean {
  return EGRESS_RANK[fallback] > EGRESS_RANK[primary]
}

export type FallbackDisclosure =
  | "same-boundary"
  | "node-to-managed"
  | "node-to-external"
  | "managed-to-external"
  | "privacy-escalation"

export function fallbackDisclosure(
  primaryPlacement: CapabilityPlacementKind,
  primaryEgress: DataEgressClass,
  fallbackPlacement: CapabilityPlacementKind,
  fallbackEgress: DataEgressClass
): FallbackDisclosure {
  if (!isPrivacyEscalation(primaryEgress, fallbackEgress)) {
    return "same-boundary"
  }
  if (primaryPlacement === "node" && fallbackPlacement === "managed") {
    return "node-to-managed"
  }
  if (primaryPlacement === "node" && fallbackEgress === "external-provider") {
    return "node-to-external"
  }
  if (
    primaryPlacement === "managed" &&
    fallbackEgress === "external-provider"
  ) {
    return "managed-to-external"
  }
  return "privacy-escalation"
}

export function capabilityStatusTone(
  status: string
): "neutral" | "positive" | "warning" | "negative" {
  switch (status) {
    case "ready":
    case "healthy":
    case "completed":
      return "positive"
    case "draft":
    case "discovered":
    case "validating":
    case "unknown":
    case "routing":
    case "reserved":
      return "neutral"
    case "degraded":
    case "inspect-required":
    case "waiting-provider":
      return "warning"
    case "disabled":
    case "invalid":
    case "offline":
    case "unauthorized":
    case "failed":
    case "cancelled":
      return "negative"
    default:
      return "neutral"
  }
}

export function capabilityPurposeMatches(
  pattern: string,
  purpose: string
): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith(".*")) {
    const prefix = pattern.slice(0, -1)
    return purpose.startsWith(prefix)
  }
  return pattern === purpose
}
