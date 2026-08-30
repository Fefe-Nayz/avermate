"use client"

import { useExtracted } from "next-intl"

/** Local display messages only: protocol IDs and unknown provider metadata stay verbatim. */
export function useProcessingLabels() {
  const t = useExtracted()
  return (source: string): string => {
    switch (source) {
      case "Placement":
        return t("Placement")
      case "Provider":
        return t("Provider")
      case "Configuration":
        return t("Configuration")
      case "Secrets":
        return t("Secrets")
      case "Validation":
        return t("Validation")
      case "Discovery":
        return t("Discovery")
      case "Consent":
        return t("Consent")
      case "Policies":
        return t("Policies")
      case "Setup":
        return t("Setup")
      case "Personal API key":
        return t("Personal API key")
      case "Avermate Node":
        return t("Avermate Node")
      case "Avermate calls the provider with your encrypted credential.":
        return t("Avermate calls the provider with your encrypted credential.")
      case "The credential and execution remain under your Node's custody.":
        return t(
          "The credential and execution remain under your Node's custody."
        )
      case "Language generation":
        return t("Language generation")
      case "Embeddings":
        return t("Embeddings")
      case "Reranking":
        return t("Reranking")
      case "Speech transcription":
        return t("Speech transcription")
      case "Speech synthesis":
        return t("Speech synthesis")
      case "Document OCR":
        return t("Document OCR")
      case "Document extraction":
        return t("Document extraction")
      case "Image generation":
        return t("Image generation")
      case "Video generation":
        return t("Video generation")
      case "Chat":
        return t("Chat")
      case "Document embeddings":
        return t("Document embeddings")
      case "Dictation":
        return t("Dictation")
      case "Course transcription":
        return t("Course transcription")
      case "Podcast narration":
        return t("Podcast narration")
      case "Video narration":
        return t("Video narration")
      case "Connections":
        return t("Connections")
      case "Capabilities":
        return t("Capabilities")
      case "Usage":
        return t("Usage")
      case "Privacy":
        return t("Privacy")
      case "Diagnostics":
        return t("Diagnostics")
      case "Region":
        return t("Region")
      case "Optional provider region used for discovery and data-boundary display.":
        return t(
          "Optional provider region used for discovery and data-boundary display."
        )
      case "Project ID":
        return t("Project ID")
      case "Optional Google Cloud project identifier.":
        return t("Optional Google Cloud project identifier.")
      case "API origin":
        return t("API origin")
      case "HTTPS origin only; paths, credentials and private hosted addresses are rejected.":
        return t(
          "HTTPS origin only; paths, credentials and private hosted addresses are rejected."
        )
      case "API version":
        return t("API version")
      case "Optional reviewed protocol version selector.":
        return t("Optional reviewed protocol version selector.")
      case "Organization":
        return t("Organization")
      case "Optional non-secret provider organization identifier.":
        return t("Optional non-secret provider organization identifier.")
      case "Model ID":
        return t("Model ID")
      case "Exact immutable provider model identifier.":
        return t("Exact immutable provider model identifier.")
      case "Embedding dimensions":
        return t("Embedding dimensions")
      case "Required when this connection advertises an embedding offering.":
        return t(
          "Required when this connection advertises an embedding offering."
        )
      case "Model revision":
        return t("Model revision")
      case "Pinned provider model revision; defaults to the exact model ID.":
        return t(
          "Pinned provider model revision; defaults to the exact model ID."
        )
      case "Preprocessing revision":
        return t("Preprocessing revision")
      case "Immutable embedding preprocessing revision.":
        return t("Immutable embedding preprocessing revision.")
      case "Paired Node that advertises the capability offerings.":
        return t("Paired Node that advertises the capability offerings.")
      case "Configuration revision":
        return t("Configuration revision")
      case "Signed Node configuration revision fence.":
        return t("Signed Node configuration revision fence.")
      case "Pinned deployment revision":
        return t("Pinned deployment revision")
      case "Operator/provider revision of this exact deployment. Change it whenever weights or upstream configuration change.":
        return t(
          "Operator/provider revision of this exact deployment. Change it whenever weights or upstream configuration change."
        )
      case "Proxy origin":
        return t("Proxy origin")
      case "HTTPS public origin in hosted Core; use a paired Node for a private-network proxy.":
        return t(
          "HTTPS public origin in hosted Core; use a paired Node for a private-network proxy."
        )
      case "Exact deployment ID":
        return t("Exact deployment ID")
      case "One deployment and one upstream; no wildcard, automatic router or load-balanced model group.":
        return t(
          "One deployment and one upstream; no wildcard, automatic router or load-balanced model group."
        )
      case "Dedicated deployment without hidden fallback":
        return t("Dedicated deployment without hidden fallback")
      case "I configured this proxy with one upstream, retries disabled and all fallback lists empty. Avermate cannot inspect a remote proxy's internal configuration.":
        return t(
          "I configured this proxy with one upstream, retries disabled and all fallback lists empty. Avermate cannot inspect a remote proxy's internal configuration."
        )
      case "Model and inference provider":
        return t("Model and inference provider")
      case "Exact organization/model:provider, for example openai/gpt-oss-120b:groq. No automatic provider selection.":
        return t(
          "Exact organization/model:provider, for example openai/gpt-oss-120b:groq. No automatic provider selection."
        )
      default:
        return source
    }
  }
}
