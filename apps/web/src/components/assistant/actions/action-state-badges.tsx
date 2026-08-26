"use client"

import type { AgentActionDto } from "@avermate/agent-contracts"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { actionStatePresentation, undoStatePresentation } from "./action-model"

export function ActionStateBadges({ action }: { action: AgentActionDto }) {
  const t = useExtracted()
  const execution = actionStatePresentation(action)
  const undo = undoStatePresentation(action)
  /**
   * Two lookup tables, not two ternary staircases.
   *
   * Eighteen branches between them before, which is how "Compensation failed"
   * survived: nobody reads to the bottom of a staircase. It says "Undo failed"
   * now, because compensation is the word the code uses and undo is the word
   * the reader clicked.
   */
  const failedLabels: Record<string, string> = {
    rejected: t("Rejected"),
    expired: t("Expired"),
    "inspect-required": t("Needs inspection"),
  }
  const executionLabel =
    execution.state === "pending"
      ? action.status === "awaiting-approval"
        ? t("Pending approval")
        : t("Pending")
      : execution.state === "executing"
        ? t("Executing")
        : execution.state === "succeeded" || execution.state === "undone"
          ? t("Succeeded")
          : (failedLabels[action.status] ?? t("Failed"))

  const undoLabels: Record<string, string> = {
    "not-applicable": t("No undo"),
    ineligible: t("Not undoable"),
    eligible: t("Undo available"),
    "approval-pending": t("Undo approval pending"),
    "in-progress": t("Undoing"),
    compensated: t("Undone"),
    "partially-compensated": t("Partially undone"),
    conflicted: t("Undo conflict"),
    failed: t("Undo failed"),
  }
  const undoLabel = undoLabels[action.undoState] ?? t("Undo blocked")

  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      <Badge
        variant={execution.variant}
        aria-label={t("Execution: {state}", { state: executionLabel })}
        data-action-state={execution.state}
      >
        {executionLabel}
      </Badge>
      <Badge
        variant={undo.variant}
        aria-label={t("Undo: {state}", { state: undoLabel })}
        data-undo-state={action.undoState}
      >
        {undoLabel}
      </Badge>
    </div>
  )
}
