"use client"

import type { AgentActionDto } from "@avermate/agent-contracts"
import { useExtracted } from "next-intl"
import { actionReason, actionTitle, reasonCodeLabel } from "./action-model"

export function useActionCopy() {
  const t = useExtracted()

  function title(action: Pick<AgentActionDto, "toolId">): string {
    switch (action.toolId) {
      case "planning.tasks.create":
        return t("Create a personal task")
      case "grades.update":
        return t("Update a grade")
      case "artifact.plan":
        return t("Plan an artifact workflow")
      case "artifact.cancel":
        return t("Cancel an artifact workflow")
      case "artifact.retry_stage":
        return t("Retry an artifact stage")
      case "artifact.promote":
        return t("Promote an artifact revision")
      case "artifact.set_state":
        return t("Change artifact state")
      case "learning.copy.request_analysis":
        return t("Request copy analysis")
      case "learning.copy.review_analysis":
        return t("Review copy analysis")
      case "learning.evidence.decide":
        return t("Change an evidence inclusion decision")
      case "learning.plan.propose":
        return t("Propose a learning plan")
      case "learning.plan.apply":
        return t("Apply a learning-plan item")
      case "learning.quiz.generate":
        return t("Generate a sourced quiz")
      case "learning.quiz.start":
        return t("Start a learning quiz")
      default:
        return actionTitle(action)
    }
  }

  function reasonCode(code: string): string {
    switch (code) {
      case "active-compensation":
        return t("A compensation action is still running.")
      case "already-compensated":
        return t("This action was already undone.")
      case "compensation-failed":
        return t(
          "The compensating action failed. The original action remains in history."
        )
      case "no-compensator":
        return t("This action has no reviewed compensating operation.")
      case "not-eligible":
        return t("This action is not eligible for undo.")
      case "resource-missing":
        return t("The affected resource no longer exists.")
      case "resource-revision-changed":
        return t(
          "The resource changed after this action. Undo will not overwrite later work."
        )
      case "uncompensated-dependant":
        return t(
          "A dependent action must be undone first or repaired independently."
        )
      default:
        return reasonCodeLabel(code)
    }
  }

  function reason(action: AgentActionDto): string | null {
    if (action.undoReasonCode) {
      return reasonCode(action.undoReasonCode)
    }
    if (action.safeError) return action.safeError
    if (action.status === "inspect-required") {
      return t(
        "The server cannot prove whether the external effect happened. Inspect it before retrying."
      )
    }
    if (action.undoState === "partially-compensated") {
      return t(
        "Only part of this action was undone. Completed compensation remains recorded; unresolved work needs review."
      )
    }
    return actionReason(action)
  }

  return { reason, reasonCode, title }
}
