import { describe, expect, test } from "bun:test"
import {
  SPECIALIZED_TOOL_RESULT_REGISTRY,
  specializedToolResultKind,
  usesSpecializedToolResult,
} from "./tool-result-registry"

describe("assistant tool-result registry", () => {
  test("keeps mandatory Learning results in a closed registry", () => {
    expect(specializedToolResultKind("learning.copy.request_analysis")).toBe(
      "copy-analysis"
    )
    expect(specializedToolResultKind("learning.copy.review_analysis")).toBe(
      "copy-review"
    )
    expect(specializedToolResultKind("learning.evidence.list")).toBe("evidence")
    expect(specializedToolResultKind("learning.concepts.get")).toBe("concept")
    expect(specializedToolResultKind("learning.evidence.get")).toBe("evidence")
    expect(specializedToolResultKind("learning.mastery.get")).toBe("mastery")
    expect(specializedToolResultKind("learning.mastery.explain")).toBe(
      "mastery"
    )
    expect(specializedToolResultKind("learning.plan.propose")).toBe("plan")
    expect(specializedToolResultKind("learning.plan.apply")).toBe("plan")
    expect(specializedToolResultKind("learning.quiz.start")).toBe(
      "quiz-progress"
    )
    expect(specializedToolResultKind("learning.quiz.generate")).toBe(
      "quiz-progress"
    )
  })

  test("routes artifact progress and undo previews without prefix matching", () => {
    expect(specializedToolResultKind("artifact.workflow")).toBe(
      "artifact-progress"
    )
    expect(specializedToolResultKind("actions.undo_preview")).toBe(
      "undo-compensation"
    )
    expect(specializedToolResultKind("learning.plan.delete")).toBeNull()
    expect(specializedToolResultKind("artifact.unknown")).toBeNull()
    expect(usesSpecializedToolResult("grades.list")).toBe(false)
  })

  test("contains no wildcard registry entries", () => {
    expect(Object.keys(SPECIALIZED_TOOL_RESULT_REGISTRY)).not.toContain("*")
    expect(Object.keys(SPECIALIZED_TOOL_RESULT_REGISTRY)).not.toContain(
      "learning.*"
    )
  })
})
