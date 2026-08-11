"use client"

import { useState, type FormEvent } from "react"
import { useQuery } from "@tanstack/react-query"
import { ChevronLeftIcon, ChevronRightIcon, SearchIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { SocialReportDetail } from "@/components/admin/social-report-detail"
import { PageMeta } from "@/components/shell/page-chrome"
import {
  ReportPriorityMark,
  ReportStatusMark,
} from "@/components/admin/social-moderation-ui"
import { useSocialLabels } from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { SelectControl } from "@/components/forms/controls"
import { INITIAL_ADMIN_SOCIAL_REPORTS_INPUT } from "@/lib/admin-social-inputs"
import { orpc } from "@/lib/orpc"
import { cn } from "@/lib/utils"

type ReportStatus = "open" | "investigating" | "resolved" | "dismissed"
type ReportPriority = "low" | "normal" | "high" | "urgent"
type ReportFilters = {
  status: ReportStatus | "all"
  priority: ReportPriority | "all"
  search: string
  limit: number
  offset: number
}

export function AdminSocialReportsClient() {
  const t = useExtracted()
  const format = useFormatter()
  const labels = useSocialLabels()
  const [filters, setFilters] = useState<ReportFilters>({
    status: "all",
    priority: "all",
    search: INITIAL_ADMIN_SOCIAL_REPORTS_INPUT.search,
    limit: INITIAL_ADMIN_SOCIAL_REPORTS_INPUT.limit,
    offset: INITIAL_ADMIN_SOCIAL_REPORTS_INPUT.offset,
  })
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const reports = useQuery(
    orpc.admin.socialReports.queryOptions({
      input: {
        statuses: filters.status === "all" ? [] : [filters.status],
        priorities: filters.priority === "all" ? [] : [filters.priority],
        search: filters.search,
        limit: filters.limit,
        offset: filters.offset,
      },
    })
  )

  const resolvedSelectedId = reports.data?.items.some(
    (item) => item.id === selectedId
  )
    ? selectedId
    : (reports.data?.items[0]?.id ?? null)

  function updateFilters(patch: Partial<ReportFilters>) {
    setFilters((current) => ({
      ...current,
      ...patch,
      offset: patch.offset ?? 0,
    }))
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateFilters({ search: search.trim() })
  }

  const hasNext = Boolean(
    reports.data &&
    reports.data.offset + reports.data.limit < reports.data.total
  )

  return (
    <>
      <PageMeta title={t("Social safety reports")} backHref="/admin/social" />
      <div className="flex flex-col gap-4">
        <div className="hidden md:block">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Social safety queue")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Review reports with least-privilege context, assign an owner and record every moderation decision."
            )}
          </p>
        </div>

        <Card className="py-4">
          <CardContent className="space-y-3 px-4">
            <form
              className="flex flex-col gap-2 sm:flex-row"
              onSubmit={submitSearch}
            >
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search report messages")}
                aria-label={t("Search social reports")}
              />
              <Button variant="outline" type="submit">
                <SearchIcon aria-hidden />
                {t("Search")}
              </Button>
            </form>
            <div className="grid gap-2 sm:grid-cols-2">
              <SelectControl
                aria-label={t("Report status filter")}
                value={filters.status}
                onValueChange={(value) =>
                  updateFilters({
                    status: value as ReportStatus | "all",
                  })
                }
                options={[
                  { value: "all", label: t("All statuses") },
                  { value: "open", label: t("Open") },
                  { value: "investigating", label: t("Investigating") },
                  { value: "resolved", label: t("Resolved") },
                  { value: "dismissed", label: t("Dismissed") },
                ]}
              />
              <SelectControl
                aria-label={t("Report priority filter")}
                value={filters.priority}
                onValueChange={(value) =>
                  updateFilters({
                    priority: value as ReportPriority | "all",
                  })
                }
                options={[
                  { value: "all", label: t("All priorities") },
                  { value: "urgent", label: t("Urgent") },
                  { value: "high", label: t("High") },
                  { value: "normal", label: t("Normal") },
                  { value: "low", label: t("Low") },
                ]}
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid min-h-[32rem] gap-4 @3xl/main:grid-cols-[minmax(18rem,0.9fr)_minmax(24rem,1.1fr)]">
          <Card className="overflow-hidden py-0">
            <div className="divide-y">
              {reports.data?.items.map((report) => (
                <button
                  key={report.id}
                  type="button"
                  onClick={() => setSelectedId(report.id)}
                  aria-pressed={resolvedSelectedId === report.id}
                  className={cn(
                    "w-full space-y-2 px-4 py-3 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset",
                    resolvedSelectedId === report.id
                      ? "bg-muted"
                      : "hover:bg-muted/50"
                  )}
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <ReportPriorityMark priority={report.priority} />
                    <ReportStatusMark status={report.status} />
                    <span className="ml-auto text-xs text-muted-foreground">
                      {format.dateTime(report.updatedAt, {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </span>
                  </div>
                  <p className="line-clamp-2 text-sm">{report.message}</p>
                  <div className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    <span className="font-medium">
                      {labels.reportCategory(report.category)}
                    </span>
                    <span>{report.reporter.name}</span>
                    {report.groupId ? <span>{t("Group-related")}</span> : null}
                    {report.hasTargetUser ? (
                      <span>{t("Member-related")}</span>
                    ) : null}
                  </div>
                </button>
              ))}
              {reports.data?.items.length === 0 ? (
                <p className="px-4 py-12 text-center text-sm text-muted-foreground">
                  {t("No safety report matches these filters.")}
                </p>
              ) : null}
            </div>
          </Card>

          <SocialReportDetail reportId={resolvedSelectedId} />
        </div>

        <div className="flex items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {reports.data
              ? t("{count} safety reports", {
                  count: String(reports.data.total),
                })
              : t("Loading reports…")}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              disabled={filters.offset === 0 || reports.isFetching}
              onClick={() =>
                updateFilters({
                  offset: Math.max(0, filters.offset - filters.limit),
                })
              }
            >
              <ChevronLeftIcon aria-hidden />
              {t("Previous")}
            </Button>
            <Button
              variant="outline"
              disabled={!hasNext || reports.isFetching}
              onClick={() =>
                updateFilters({ offset: filters.offset + filters.limit })
              }
            >
              {t("Next")}
              <ChevronRightIcon aria-hidden />
            </Button>
          </div>
        </div>
      </div>
    </>
  )
}
