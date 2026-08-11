"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { ShieldAlertIcon, UserRoundXIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import {
  ReportPriorityMark,
  ReportStatusMark,
} from "@/components/admin/social-moderation-ui"
import { useSocialLabels } from "@/components/social/social-ui"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"

type ReportStatus = "open" | "investigating" | "resolved" | "dismissed"
type ReportPriority = "low" | "normal" | "high" | "urgent"
type SafetyAction =
  | { kind: "profile"; userId: string }
  | {
      kind: "group"
      groupId: string
      name: string
      revision: number
      frozen: boolean
    }

export function SocialReportDetail({ reportId }: { reportId: string | null }) {
  const t = useExtracted()
  const format = useFormatter()
  const labels = useSocialLabels()
  const queryClient = useQueryClient()
  const [safetyAction, setSafetyAction] = useState<SafetyAction | null>(null)
  const [reason, setReason] = useState("")

  const detail = useQuery({
    ...orpc.admin.socialReportDetail.queryOptions({
      input: { reportId: reportId ?? "" },
    }),
    enabled: Boolean(reportId),
  })
  const assignees = useQuery(orpc.admin.feedbackAssignees.queryOptions())

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.admin.socialReports.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.admin.socialReportDetail.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.admin.socialOverview.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.admin.socialGroups.key(),
      }),
      queryClient.invalidateQueries({ queryKey: orpc.admin.socialAudit.key() }),
    ])
  }
  const update = useMutation({
    ...orpc.admin.updateSocialReport.mutationOptions(),
    onSuccess: async () => {
      toast.success(t("The report was updated."))
      await refresh()
    },
    onError: async () => {
      toast.error(
        t("This report changed elsewhere. The latest version was reloaded.")
      )
      await refresh()
    },
  })
  const freezeProfile = useMutation({
    ...orpc.admin.freezeSocialProfile.mutationOptions(),
    onSuccess: async () => {
      setSafetyAction(null)
      setReason("")
      toast.success(
        t("The reported profile was frozen and its sharing was revoked.")
      )
      await refresh()
    },
    onError: () => toast.error(t("The reported profile could not be frozen.")),
  })
  const freezeGroup = useMutation({
    ...orpc.admin.freezeSocialGroup.mutationOptions(),
    onSuccess: async () => {
      setSafetyAction(null)
      setReason("")
      toast.success(t("The reported group's safety state was updated."))
      await refresh()
    },
    onError: async () => {
      toast.error(
        t("The group changed elsewhere. The latest version was reloaded.")
      )
      await refresh()
    },
  })

  if (!reportId) {
    return (
      <Card className="grid min-h-80 place-items-center p-6 text-center text-sm text-muted-foreground">
        {t("Select a report to review its protected moderation context.")}
      </Card>
    )
  }

  if (!detail.data) {
    return (
      <Card className="grid min-h-80 place-items-center">
        <Spinner />
      </Card>
    )
  }

  const item = detail.data
  const busy =
    update.isPending || freezeProfile.isPending || freezeGroup.isPending

  function patch(next: {
    status?: ReportStatus
    priority?: ReportPriority
    assignedToUserId?: string | null
  }) {
    update.mutate({
      reportId: item.id,
      expectedRevision: item.revision,
      ...next,
    })
  }

  return (
    <>
      <Card className="overflow-hidden py-0">
        <ScrollArea className="max-h-[calc(100svh-11rem)]">
          <div className="space-y-5 p-4">
            <header className="space-y-2">
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge variant="secondary">
                  {labels.reportCategory(item.category)}
                </Badge>
                <ReportStatusMark status={item.status} />
                <ReportPriorityMark priority={item.priority} />
              </div>
              <h2 className="text-lg font-semibold">
                {t("Safety report detail")}
              </h2>
              <p className="text-sm whitespace-pre-wrap text-muted-foreground">
                {item.message}
              </p>
              <p className="text-xs text-muted-foreground">
                {t(
                  "This is reporter-provided text. Do not copy it outside the moderation workflow."
                )}
              </p>
            </header>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1">
                <Label htmlFor="social-report-status">{t("Status")}</Label>
                <SelectControl
                  id="social-report-status"
                  value={item.status}
                  disabled={busy}
                  onValueChange={(value) =>
                    patch({ status: value as ReportStatus })
                  }
                  options={[
                    { value: "open", label: t("Open") },
                    { value: "investigating", label: t("Investigating") },
                    { value: "resolved", label: t("Resolved") },
                    { value: "dismissed", label: t("Dismissed") },
                  ]}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="social-report-priority">{t("Priority")}</Label>
                <SelectControl
                  id="social-report-priority"
                  value={item.priority}
                  disabled={busy}
                  onValueChange={(value) =>
                    patch({ priority: value as ReportPriority })
                  }
                  options={[
                    { value: "urgent", label: t("Urgent") },
                    { value: "high", label: t("High") },
                    { value: "normal", label: t("Normal") },
                    { value: "low", label: t("Low") },
                  ]}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="social-report-assignee">{t("Assignee")}</Label>
                <SelectControl
                  id="social-report-assignee"
                  value={item.assignedToUserId ?? ""}
                  disabled={busy}
                  onValueChange={(value) => patch({ assignedToUserId: value || null })}
                  placeholder={t("Unassigned")}
                  options={(assignees.data ?? []).map((assignee) => ({
                    value: assignee.id,
                    label: assignee.name,
                  }))}
                />
              </div>
            </div>

            <dl className="grid gap-3 rounded-xl border p-3 text-xs sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">{t("Reporter")}</dt>
                <dd>
                  <Link
                    href={`/admin/users/${item.reporter.id}`}
                    className="font-medium underline-offset-3 hover:underline"
                  >
                    {item.reporter.name}
                  </Link>
                  <span className="block truncate text-muted-foreground">
                    {item.reporter.email}
                  </span>
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("Created")}</dt>
                <dd>
                  {format.dateTime(item.createdAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("Last updated")}</dt>
                <dd>
                  {format.dateTime(item.updatedAt, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">{t("Linked scope")}</dt>
                <dd>
                  {item.targetGroup
                    ? t("Group: {name}", { name: item.targetGroup.name })
                    : item.targetUserId
                      ? t("Reported member profile")
                      : t("General social safety")}
                </dd>
              </div>
            </dl>

            {item.targetUserId || item.targetGroup ? (
              <section className="space-y-3 rounded-xl border border-destructive/20 bg-destructive/5 p-3">
                <div>
                  <h3 className="font-medium">
                    {t("Immediate safety controls")}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "These actions revoke sharing immediately and create a protected audit event. They never reveal academic data."
                    )}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {item.targetUserId ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => {
                        setReason("")
                        setSafetyAction({
                          kind: "profile",
                          userId: item.targetUserId!,
                        })
                      }}
                    >
                      <UserRoundXIcon aria-hidden />
                      {t("Freeze reported profile")}
                    </Button>
                  ) : null}
                  {item.targetGroup ? (
                    <Button
                      size="sm"
                      variant={
                        item.targetGroup.state === "frozen"
                          ? "outline"
                          : "destructive"
                      }
                      disabled={item.targetGroup.state === "archived"}
                      onClick={() => {
                        setReason("")
                        setSafetyAction({
                          kind: "group",
                          groupId: item.targetGroup!.id,
                          name: item.targetGroup!.name,
                          revision: item.targetGroup!.revision,
                          frozen: item.targetGroup!.state !== "frozen",
                        })
                      }}
                    >
                      <ShieldAlertIcon aria-hidden />
                      {item.targetGroup.state === "frozen"
                        ? t("Unfreeze reported group")
                        : t("Freeze reported group")}
                    </Button>
                  ) : null}
                </div>
              </section>
            ) : null}
          </div>
        </ScrollArea>
      </Card>

      <AlertDialog
        open={Boolean(safetyAction)}
        onOpenChange={(open) => {
          if (!open && !busy) setSafetyAction(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Confirm immediate safety action")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {safetyAction?.kind === "profile"
                ? t(
                    "The profile is frozen, discovery and grants are disabled, and current social sharing is revoked."
                  )
                : safetyAction?.frozen
                  ? t(
                      "The group is frozen, consents and rankings are withdrawn, invitations are revoked and aggregates are cleared."
                    )
                  : t(
                      "The group is unfrozen, but every member must explicitly consent again before sharing resumes."
                    )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-2">
            <Label htmlFor="social-report-safety-reason">
              {t("Moderation reason")}
            </Label>
            <Textarea
              id="social-report-safety-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={10}
              maxLength={500}
              placeholder={t("Required for the protected audit trail")}
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={
                safetyAction?.kind === "profile" || safetyAction?.frozen
                  ? "destructive"
                  : "default"
              }
              disabled={!safetyAction || reason.trim().length < 10 || busy}
              onClick={() => {
                if (safetyAction?.kind === "profile") {
                  freezeProfile.mutate({
                    userId: safetyAction.userId,
                    frozen: true,
                    reason: reason.trim(),
                  })
                } else if (safetyAction?.kind === "group") {
                  freezeGroup.mutate({
                    groupId: safetyAction.groupId,
                    frozen: safetyAction.frozen,
                    expectedRevision: safetyAction.revision,
                    reason: reason.trim(),
                  })
                }
              }}
            >
              {busy ? <Spinner /> : null}
              {t("Confirm moderation action")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
