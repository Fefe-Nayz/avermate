import { describe, expect, test } from "bun:test"
import {
  CAPABILITY_KINDS,
  CAPABILITY_PURPOSES,
  capabilityPurposeMatches,
  capabilityStatusTone,
  fallbackDisclosure,
  isPrivacyEscalation,
} from "./capability-settings-model"

describe("capability settings model", () => {
  test("presents every v1 capability exactly once", () => {
    expect(new Set(CAPABILITY_KINDS).size).toBe(9)
    expect(CAPABILITY_KINDS).toEqual([
      "language.generate",
      "embedding.generate",
      "rerank.score",
      "speech.transcribe",
      "speech.synthesize",
      "document.ocr",
      "document.extract",
      "image.generate",
      "video.generate",
    ])
    expect(
      CAPABILITY_KINDS.every((kind) =>
        CAPABILITY_PURPOSES.some((purpose) => purpose.capability === kind)
      )
    ).toBe(true)
  })

  test("detects privacy escalation independently of provider names", () => {
    expect(isPrivacyEscalation("none", "owner-node")).toBe(true)
    expect(isPrivacyEscalation("owner-node", "external-provider")).toBe(true)
    expect(isPrivacyEscalation("external-provider", "owner-node")).toBe(false)
    expect(isPrivacyEscalation("avermate-managed", "avermate-managed")).toBe(
      false
    )
  })

  test("produces an explicit disclosure for local to cloud fallback", () => {
    expect(
      fallbackDisclosure(
        "node",
        "owner-node",
        "direct-byok",
        "external-provider"
      )
    ).toBe("node-to-external")
    expect(
      fallbackDisclosure("node", "owner-node", "managed", "avermate-managed")
    ).toBe("node-to-managed")
  })

  test("matches exact and namespaced purpose policies", () => {
    expect(capabilityPurposeMatches("*", "assistant.chat")).toBe(true)
    expect(capabilityPurposeMatches("recordings.*", "recordings.course")).toBe(
      true
    )
    expect(
      capabilityPurposeMatches("recordings.*", "assistant.dictation")
    ).toBe(false)
    expect(capabilityPurposeMatches("assistant.chat", "assistant.chat")).toBe(
      true
    )
  })

  test("maps unknown states conservatively", () => {
    expect(capabilityStatusTone("ready")).toBe("positive")
    expect(capabilityStatusTone("degraded")).toBe("warning")
    expect(capabilityStatusTone("invalid")).toBe("negative")
    expect(capabilityStatusTone("future-state")).toBe("neutral")
  })
})
