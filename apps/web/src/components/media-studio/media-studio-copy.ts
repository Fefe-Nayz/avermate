"use client"

import type { GeneratedArtifactKind } from "@avermate/agent-contracts"
import { useExtracted } from "next-intl"

export function useMediaStudioCopy() {
  const t = useExtracted()
  const artifactKindOptions: readonly {
    value: GeneratedArtifactKind
    label: string
    description: string
  }[] = [
    {
      value: "markdown",
      label: t("Markdown document"),
      description: t("Structured notes with citations and private media."),
    },
    {
      value: "latex-source",
      label: t("LaTeX source"),
      description: t("Editable LaTeX document before compilation."),
    },
    {
      value: "pdf",
      label: t("PDF"),
      description: t("Compiled document that can be previewed in Avermate."),
    },
    {
      value: "slides-source",
      label: t("Presentation outline"),
      description: t("Editable slide structure."),
    },
    {
      value: "pptx",
      label: t("PowerPoint"),
      description: t("Presentation exportable as PPTX."),
    },
    {
      value: "quiz",
      label: t("Quiz"),
      description: t("Questions traceable to the selected sources."),
    },
    {
      value: "audio",
      label: t("Podcast"),
      description: t("Audio narration with script and provenance."),
    },
    {
      value: "image",
      label: t("Illustration"),
      description: t("Educational image from a reviewable workflow."),
    },
    {
      value: "anki",
      label: t("Anki package"),
      description: t("Exportable study cards."),
    },
    {
      value: "html",
      label: t("Interactive document"),
      description: t("Sandboxed, downloadable HTML artifact."),
    },
    {
      value: "video-timeline",
      label: t("Video storyboard"),
      description: t("Deterministic timeline before final rendering."),
    },
    {
      value: "video",
      label: t("Narrated video"),
      description: t("Slides, narration, captions and video rendering."),
    },
    {
      value: "thumbnail",
      label: t("Thumbnail"),
      description: t("Cover visual linked to a revision."),
    },
  ]

  function artifactKindLabel(kind: string) {
    return (
      artifactKindOptions.find((option) => option.value === kind)?.label ?? kind
    )
  }

  function workflowStatusLabel(status: string) {
    switch (status) {
      case "planned":
        return t("Planned")
      case "queued":
        return t("Queued")
      case "running":
        return t("Running")
      case "awaiting_approval":
        return t("Approval required")
      case "completed":
        return t("Completed")
      case "failed":
        return t("Failed")
      case "cancelled":
        return t("Cancelled")
      case "superseded":
        return t("Superseded")
      default:
        return status
    }
  }

  function stageLabel(key: string) {
    switch (key) {
      case "generate":
        return t("Generate")
      case "validate":
        return t("Validate")
      case "publish":
        return t("Publish")
      case "resolve-citations":
        return t("Resolve citations")
      case "publish-timeline":
        return t("Publish storyboard")
      case "validate-timeline":
        return t("Validate storyboard")
      case "render-video":
        return t("Render video")
      case "adopt-output":
        return t("Adopt output")
      case "compose-thumbnail":
        return t("Compose thumbnail")
      default:
        return key.replaceAll("-", " ")
    }
  }

  function capabilityReason(input: {
    available: boolean
    reasonCode?: string
    message?: string
  }) {
    if (input.available) return t("Available")
    if (input.message) return input.message
    if (input.reasonCode === "placement_unavailable")
      return t("No conforming placement is configured.")
    if (input.reasonCode === "capability_disabled")
      return t("This capability is disabled.")
    return t("Unavailable")
  }

  return {
    artifactKindOptions,
    artifactKindLabel,
    workflowStatusLabel,
    stageLabel,
    capabilityReason,
  }
}
