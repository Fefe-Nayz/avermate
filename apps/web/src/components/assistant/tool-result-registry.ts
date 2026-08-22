export const SPECIALIZED_TOOL_RESULT_REGISTRY = {
  "learning.copy.request_analysis": "copy-analysis",
  "learning.copy.review_analysis": "copy-review",
  "learning.concepts.list": "concept",
  "learning.concepts.get": "concept",
  "learning.evidence.list": "evidence",
  "learning.evidence.get": "evidence",
  "learning.evidence.decide": "evidence",
  "learning.mastery.list": "mastery",
  "learning.mastery.get": "mastery",
  "learning.mastery.explain": "mastery",
  "learning.plan.list": "plan",
  "learning.plan.propose": "plan",
  "learning.plan.apply": "plan",
  "learning.quiz.generate": "quiz-progress",
  "learning.quiz.start": "quiz-progress",
  "artifact.plan": "artifact-progress",
  "artifact.cancel": "artifact-progress",
  "artifact.retry_stage": "artifact-progress",
  "artifact.promote": "artifact-progress",
  "artifact.set_state": "artifact-progress",
  "artifact.list": "artifact-progress",
  "artifact.get_manifest": "artifact-progress",
  "artifact.workflow": "artifact-progress",
  "actions.undo_preview": "undo-compensation",
} as const

export type SpecializedToolResultKind =
  (typeof SPECIALIZED_TOOL_RESULT_REGISTRY)[keyof typeof SPECIALIZED_TOOL_RESULT_REGISTRY]

export function specializedToolResultKind(
  toolName: string
): SpecializedToolResultKind | null {
  if (Object.hasOwn(SPECIALIZED_TOOL_RESULT_REGISTRY, toolName)) {
    return SPECIALIZED_TOOL_RESULT_REGISTRY[
      toolName as keyof typeof SPECIALIZED_TOOL_RESULT_REGISTRY
    ]
  }
  return null
}

export function usesSpecializedToolResult(toolName: string): boolean {
  return specializedToolResultKind(toolName) !== null
}
