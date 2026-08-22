"use client"

import { useId, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { FlagIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { SocialCallout } from "@/components/social/social-ui"
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

type ReportCategory =
  "harassment" | "privacy" | "impersonation" | "unsafe_content" | "other"

/**
 * Reporting a person or a group.
 *
 * The one instruction that matters — do not paste grades into a moderation
 * queue — sits beside the text box, where the mistake would actually be made.
 */
export function ReportDialog({
  targetUserId,
  groupId,
}: {
  targetUserId?: string
  groupId?: string
}) {
  const t = useExtracted()
  const formId = useId()
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
        render={<Button type="button" size="sm" variant="ghost" />}
      >
        <FlagIcon /> {t("Report")}
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("Report a safety issue")}</DialogTitle>
          <DialogDescription>
            {t(
              "This goes to Avermate's private moderation queue. The person you are reporting is not told."
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="space-y-2">
            <Label htmlFor={`report-category-${formId}`}>{t("Category")}</Label>
            <SelectControl
              id={`report-category-${formId}`}
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
            <Label htmlFor={`report-message-${formId}`}>
              {t("What happened?")}
            </Label>
            <Textarea
              id={`report-message-${formId}`}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              minLength={10}
              maxLength={2000}
              rows={5}
            />
            <p className="numeric text-right text-xs text-muted-foreground">
              {message.trim().length}/2000
            </p>
          </div>
          <SocialCallout tone="caution" title={t("Keep school data out of it")}>
            {t(
              "Write only what a moderator needs. Do not paste grades, subject names or anyone's academic results."
            )}
          </SocialCallout>
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
                targetUserId,
                groupId,
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
