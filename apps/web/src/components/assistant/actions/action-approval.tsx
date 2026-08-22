"use client"

import type { AgentActionDto } from "@avermate/agent-contracts"
import { ShieldAlertIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { useEffect, useMemo, useRef, useState } from "react"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { actionConsequence, approvalExpiryState } from "./action-model"
import { useActionCopy } from "./use-action-copy"

function approvalReason(
  action: AgentActionDto,
  t: ReturnType<typeof useExtracted>
): string {
  if (action.risk === "irreversible") {
    return t(
      "This effect cannot be reliably reversed and always needs your confirmation."
    )
  }
  if (action.effect === "external") {
    return t(
      "This action can affect an external system, so Avermate will not run it silently."
    )
  }
  if (action.risk === "high") {
    return t("This is a high-risk change and requires an explicit decision.")
  }
  if (action.compensatorId) {
    return t(
      "This write is recoverable while its affected resources remain unchanged."
    )
  }
  return t("This write requires your confirmation before execution.")
}

function useApprovalExpiry(expiresAt: string) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000)
    return () => window.clearInterval(timer)
  }, [])
  return useMemo(() => approvalExpiryState(expiresAt, now), [expiresAt, now])
}

export function ActionApprovalPanel({
  action,
  pending,
  disabled = false,
  onDecision,
}: {
  action: AgentActionDto
  pending: boolean
  disabled?: boolean
  onDecision: (decision: "approve" | "reject") => void
}) {
  const approval = action.approval
  if (
    action.status !== "awaiting-approval" ||
    !approval ||
    approval.state !== "pending"
  ) {
    return null
  }

  return (
    <LiveActionApprovalPanel
      action={action}
      expiresAt={approval.expiresAt}
      pending={pending}
      disabled={disabled}
      onDecision={onDecision}
    />
  )
}

function LiveActionApprovalPanel({
  action,
  expiresAt,
  pending,
  disabled,
  onDecision,
}: {
  action: AgentActionDto
  expiresAt: string
  pending: boolean
  disabled: boolean
  onDecision: (decision: "approve" | "reject") => void
}) {
  const t = useExtracted()
  const expiry = useApprovalExpiry(expiresAt)
  const approveButtonRef = useRef<HTMLButtonElement>(null)
  const minutes = Math.floor(expiry.remainingSeconds / 60)
  const seconds = expiry.remainingSeconds % 60
  const expiryLabel = expiry.expired
    ? t("Approval expired")
    : minutes > 0
      ? t("Expires in {minutes}m {seconds}s", {
          minutes: String(minutes),
          seconds: seconds.toString().padStart(2, "0"),
        })
      : t("Expires in {seconds}s", { seconds: String(seconds) })
  const effectLabel =
    action.effect === "external"
      ? t("External effect")
      : action.effect === "delete"
        ? t("Delete effect")
        : action.effect === "create"
          ? t("Create effect")
          : action.effect === "update"
            ? t("Update effect")
            : t("Read effect")
  const riskLabel =
    action.risk === "irreversible"
      ? t("Irreversible risk")
      : action.risk === "high"
        ? t("High risk")
        : action.risk === "medium"
          ? t("Medium risk")
          : t("Low risk")

  useEffect(() => {
    if (!expiry.expired) approveButtonRef.current?.focus()
  }, [action.id, expiry.expired])

  return (
    <Alert variant={expiry.expired ? "destructive" : "default"}>
      <ShieldAlertIcon />
      <AlertTitle>
        {expiry.expired ? t("Approval expired") : t("Approval required")}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>{approvalReason(action, t)}</span>
        <span className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{effectLabel}</Badge>
          <Badge
            variant={
              action.risk === "high" || action.risk === "irreversible"
                ? "destructive"
                : "secondary"
            }
          >
            {riskLabel}
          </Badge>
          <Badge variant={expiry.expired ? "destructive" : "outline"}>
            {expiryLabel}
          </Badge>
        </span>
        <span className="flex flex-wrap gap-2">
          <Button
            ref={approveButtonRef}
            type="button"
            size="sm"
            disabled={pending || disabled || expiry.expired}
            onClick={() => onDecision("approve")}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            {t("Confirm and continue")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || disabled || expiry.expired}
            onClick={() => onDecision("reject")}
          >
            {t("Reject")}
          </Button>
        </span>
      </AlertDescription>
    </Alert>
  )
}

export function ActionApprovalDialog({
  action,
  open,
  pending,
  onOpenChange,
  onDecision,
}: {
  action: AgentActionDto | null
  open: boolean
  pending: boolean
  onOpenChange: (open: boolean) => void
  onDecision: (decision: "approve" | "reject") => void
}) {
  const t = useExtracted()
  const actionCopy = useActionCopy()
  if (!action) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{actionCopy.title(action)}</DialogTitle>
          <DialogDescription>
            {actionConsequence(action) ?? approvalReason(action, t)}
          </DialogDescription>
        </DialogHeader>
        <ActionApprovalPanel
          action={action}
          pending={pending}
          onDecision={onDecision}
        />
        <DialogFooter>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
          >
            {t("Review later")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
