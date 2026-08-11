"use client"

import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FlagIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

type ReportSource =
  "friendship" | "friend_request" | "group" | "group_membership"
type ReportCategory =
  "harassment" | "privacy" | "impersonation" | "unsafe_content" | "other"

export function ReportDialog({
  source,
  sourceId,
  compact = false,
}: {
  source: ReportSource
  sourceId: string
  compact?: boolean
}) {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [open, setOpen] = useState(false)
  const [category, setCategory] = useState<ReportCategory>("harassment")
  const [message, setMessage] = useState("")
  const create = useMutation({
    ...orpc.social.reports.create.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      setOpen(false)
      setMessage("")
      toast.success(t("Report sent to Avermate moderators."))
      await queryClient.invalidateQueries({
        queryKey: orpc.social.reports.mine.key(),
      })
    },
  })

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <Button
            type="button"
            size={compact ? "icon-sm" : "sm"}
            variant="ghost"
            aria-label={compact ? t("Report") : undefined}
          />
        }
      >
        <FlagIcon /> {compact ? null : t("Report")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Report a social safety issue")}</DialogTitle>
          <DialogDescription>
            {t(
              "Reports go to Avermate's private moderation queue, not Discord. Describe only what moderators need; do not include grades or other sensitive school details."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor={`report-category-${sourceId}`}>
              {t("Category")}
            </Label>
            <SelectControl
              id={`report-category-${sourceId}`}
              value={category}
              onValueChange={(value) => setCategory(value as ReportCategory)}
              options={[
                { value: "harassment", label: t("Harassment") },
                { value: "privacy", label: t("Privacy") },
                { value: "impersonation", label: t("Impersonation") },
                { value: "unsafe_content", label: t("Unsafe content") },
                { value: "other", label: t("Other") },
              ]}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`report-message-${sourceId}`}>
              {t("What happened?")}
            </Label>
            <Textarea
              id={`report-message-${sourceId}`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              minLength={10}
              maxLength={2000}
              rows={5}
            />
          </div>
          {create.error ? (
            <p role="alert" className="text-sm text-destructive">
              {t("The report could not be sent. Try again later.")}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button
            disabled={create.isPending || message.trim().length < 10}
            onClick={() =>
              create.mutate({
                source,
                sourceId,
                category,
                message: message.trim(),
              })
            }
          >
            {create.isPending ? <Spinner /> : null}
            {t("Send private report")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
