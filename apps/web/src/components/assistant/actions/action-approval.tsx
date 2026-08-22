"use client"

import type { AgentActionDto } from "@avermate/agent-contracts"
import { ShieldAlertIcon } from "lucide-react"
import { useEffect, useMemo, useState } from "react"
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
import {
  actionConsequence,
  actionTitle,
  approvalExpiryState,
} from "./action-model"

function approvalReason(action: AgentActionDto): string {
  if (action.risk === "irreversible") {
    return "This effect cannot be reliably reversed and always needs your confirmation."
  }
  if (action.effect === "external") {
    return "This action can affect an external system, so Avermate will not run it silently."
  }
  if (action.risk === "high") {
    return "This is a high-risk change and requires an explicit decision."
  }
  if (action.compensatorId) {
    return "This write is recoverable while its affected resources remain unchanged."
  }
  return "This write requires your confirmation before execution."
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
  onDecision,
}: {
  action: AgentActionDto
  pending: boolean
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
      onDecision={onDecision}
    />
  )
}

function LiveActionApprovalPanel({
  action,
  expiresAt,
  pending,
  onDecision,
}: {
  action: AgentActionDto
  expiresAt: string
  pending: boolean
  onDecision: (decision: "approve" | "reject") => void
}) {
  const expiry = useApprovalExpiry(expiresAt)

  return (
    <Alert variant={expiry.expired ? "destructive" : "default"}>
      <ShieldAlertIcon />
      <AlertTitle>
        {expiry.expired ? "Approval expired" : "Approval required"}
      </AlertTitle>
      <AlertDescription className="flex flex-col gap-3">
        <span>{approvalReason(action)}</span>
        <span className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{action.effect}</Badge>
          <Badge
            variant={
              action.risk === "high" || action.risk === "irreversible"
                ? "destructive"
                : "secondary"
            }
          >
            {action.risk} risk
          </Badge>
          <Badge variant={expiry.expired ? "destructive" : "outline"}>
            {expiry.label}
          </Badge>
        </span>
        <span className="flex flex-wrap gap-2">
          <Button
            type="button"
            size="sm"
            disabled={pending || expiry.expired}
            onClick={() => onDecision("approve")}
          >
            {pending ? <Spinner data-icon="inline-start" /> : null}
            Confirm and continue
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || expiry.expired}
            onClick={() => onDecision("reject")}
          >
            Reject
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
  if (!action) return null

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{actionTitle(action)}</DialogTitle>
          <DialogDescription>
            {actionConsequence(action) ?? approvalReason(action)}
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
            Review later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
