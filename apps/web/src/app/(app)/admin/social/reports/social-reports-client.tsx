"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { FlagIcon, UserRoundCheckIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  ReportPriorityMark,
  ReportStatusMark,
} from "@/components/admin/social-moderation-ui"
import { PageMeta } from "@/components/shell/page-chrome"
import { useSocialLabels } from "@/components/social/social-labels"
import {
  SocialEmpty,
  SocialHeading,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { INITIAL_ADMIN_SOCIAL_REPORTS_INPUT } from "@/lib/admin-social-inputs"
import { orpc } from "@/lib/orpc"

type ReportStatus = "open" | "investigating" | "resolved" | "dismissed"

/**
 * The moderation queue. Each report is a card with its whole lifecycle on
 * it — status, priority, assignment — because a queue this small does not
 * deserve a separate detail page.
 */
export function AdminSocialReportsClient() {
  const t = useExtracted()
  const labels = useSocialLabels()
  const queryClient = useQueryClient()
  const [status, setStatus] = useState<"all" | ReportStatus>(
    INITIAL_ADMIN_SOCIAL_REPORTS_INPUT.status
  )
  const reports = useQuery(
    orpc.admin.socialReports.queryOptions({ input: { status } })
  )

  const update = useMutation({
    ...orpc.admin.updateSocialReport.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await queryClient.invalidateQueries({
        queryKey: orpc.admin.socialReports.key(),
      })
    },
  })

  return (
    <>
      <PageMeta title={t("Reports")} />
      <div className="flex flex-col gap-4">
        <SocialHeading
          icon={FlagIcon}
          title={t("Reports")}
          description={t(
            "What members flagged. Messages never contain academic figures."
          )}
          action={
            <SelectControl
              aria-label={t("Status")}
              value={status}
              onValueChange={(value) => setStatus(value as typeof status)}
              className="w-44"
              options={[
                { value: "all", label: t("All statuses") },
                { value: "open", label: t("Open") },
                { value: "investigating", label: t("Investigating") },
                { value: "resolved", label: t("Resolved") },
                { value: "dismissed", label: t("Dismissed") },
              ]}
            />
          }
        />

        {reports.isLoading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : reports.data?.length ? (
          <ul className="flex flex-col gap-3">
            {reports.data.map((report) => (
              <li
                key={report.id}
                className="flex flex-col gap-3 rounded-xl border bg-card p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">
                    {labels.reportCategory(report.category)}
                  </span>
                  <ReportStatusMark status={report.status} />
                  <ReportPriorityMark priority={report.priority} />
                  <span className="ml-auto text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(report.createdAt))}
                  </span>
                </div>

                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  {report.message}
                </p>

                <p className="text-xs text-muted-foreground">
                  {t("From {name}", { name: report.reporter })}
                  {report.target
                    ? ` · ${t("about {name}", { name: report.target })}`
                    : ""}
                  {report.groupName
                    ? ` · ${t("class {name}", { name: report.groupName })}`
                    : ""}
                  {report.assignedTo
                    ? ` · ${t("assigned to {name}", { name: report.assignedTo })}`
                    : ""}
                </p>

                <div className="flex flex-wrap items-center gap-2">
                  <SelectControl
                    aria-label={t("Status")}
                    value={report.status}
                    onValueChange={(value) =>
                      update.mutate({
                        reportId: report.id,
                        status: value as ReportStatus,
                      })
                    }
                    className="w-40"
                    options={[
                      { value: "open", label: t("Open") },
                      { value: "investigating", label: t("Investigating") },
                      { value: "resolved", label: t("Resolved") },
                      { value: "dismissed", label: t("Dismissed") },
                    ]}
                  />
                  <SelectControl
                    aria-label={t("Priority")}
                    value={report.priority}
                    onValueChange={(value) =>
                      update.mutate({
                        reportId: report.id,
                        priority: value as "low" | "normal" | "high" | "urgent",
                      })
                    }
                    className="w-36"
                    options={[
                      { value: "low", label: t("Low") },
                      { value: "normal", label: t("Normal") },
                      { value: "high", label: t("High") },
                      { value: "urgent", label: t("Urgent") },
                    ]}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={update.isPending}
                    onClick={() =>
                      update.mutate({
                        reportId: report.id,
                        assignToMe: !report.assignedTo,
                      })
                    }
                  >
                    <UserRoundCheckIcon />
                    {report.assignedTo ? t("Unassign") : t("Assign to me")}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <SocialEmpty
            icon={FlagIcon}
            title={t("No reports")}
            description={t("Nothing waits in this view.")}
          />
        )}
      </div>
    </>
  )
}
