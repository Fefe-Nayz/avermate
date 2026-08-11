"use client"

import { useState, type FormEvent } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  BotIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  InboxIcon,
  SearchIcon,
  UserRoundXIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { FeedbackDetailPane } from "@/components/admin/feedback-detail-pane"
import { PageMeta } from "@/components/shell/page-chrome"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import { Spinner } from "@/components/ui/spinner"
import {
  adminFeedbackQueueInput,
  INITIAL_ADMIN_FEEDBACK_FILTERS,
  type AdminFeedbackFilters,
  type FeedbackAssigneeFilter,
  type FeedbackPriority,
  type FeedbackSource,
  type FeedbackStatus,
} from "@/lib/admin-feedback-query"
import { orpc } from "@/lib/orpc"

export function AdminFeedbackClient() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const [filters, setFilters] = useState<AdminFeedbackFilters>(
    INITIAL_ADMIN_FEEDBACK_FILTERS
  )
  const [search, setSearch] = useState("")
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [bulkStatus, setBulkStatus] = useState<FeedbackStatus>("triaged")
  const [bulkPriority, setBulkPriority] = useState<FeedbackPriority>("normal")
  const [bulkAssignee, setBulkAssignee] = useState("")

  const queue = useQuery(
    orpc.admin.feedbackQueue.queryOptions({
      input: adminFeedbackQueueInput(filters),
    })
  )
  const stats = useQuery(orpc.admin.feedbackTriageStats.queryOptions())
  const assignees = useQuery(orpc.admin.feedbackAssignees.queryOptions())

  const resolvedSelectedId = queue.data?.items.some(
    (item) => item.id === selectedId
  )
    ? selectedId
    : (queue.data?.items[0]?.id ?? null)

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.admin.feedbackQueue.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.admin.feedbackDetail.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.admin.feedbackTriageStats.key(),
      }),
    ])
  }
  const bulk = useMutation({
    ...orpc.admin.bulkUpdateFeedbackTriage.mutationOptions(),
    onSuccess: async () => {
      setChecked(new Set())
      toast.success(t("Selected feedback items updated."))
      await refresh()
    },
    onError: async () => {
      toast.error(
        t("At least one item changed elsewhere. The queue was reloaded.")
      )
      await refresh()
    },
  })

  function updateFilters(patch: Partial<AdminFeedbackFilters>) {
    setFilters((current) => ({
      ...current,
      ...patch,
      offset: patch.offset ?? 0,
    }))
    setChecked(new Set())
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    updateFilters({ search })
  }

  const selectedItems =
    queue.data?.items.filter((item) => checked.has(item.id)) ?? []
  const hasNext = Boolean(
    queue.data && queue.data.offset + queue.data.limit < queue.data.total
  )

  return (
    <>
      <PageMeta title={t("Feedback triage")} backHref="/admin" />
      <div className="flex flex-col gap-4">
        <div className="hidden md:block">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Central feedback queue")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Manual requests and deduplicated automatic errors, with ownership, labels and an auditable internal timeline."
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-3 @xl/main:grid-cols-5">
          <Card className="py-3">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">{t("Unresolved")}</p>
              <p className="text-2xl font-semibold">
                {stats.data?.unresolved ?? "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">
                {t("Occurrences")}
              </p>
              <p className="text-2xl font-semibold">
                {stats.data?.occurrences ?? "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="px-4">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <AlertTriangleIcon className="size-3" />
                {t("Urgent")}
              </p>
              <p className="text-2xl font-semibold">
                {stats.data?.urgent ?? "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="py-3">
            <CardContent className="px-4">
              <p className="flex items-center gap-1 text-xs text-muted-foreground">
                <UserRoundXIcon className="size-3" />
                {t("Unassigned")}
              </p>
              <p className="text-2xl font-semibold">
                {stats.data?.unassigned ?? "—"}
              </p>
            </CardContent>
          </Card>
          <Card className="col-span-2 py-3 @xl/main:col-span-1">
            <CardContent className="px-4">
              <p className="text-xs text-muted-foreground">
                {t("Unique items")}
              </p>
              <p className="text-2xl font-semibold">
                {stats.data?.total ?? "—"}
              </p>
            </CardContent>
          </Card>
        </div>

        <Card className="py-4">
          <CardContent className="space-y-3 px-4">
            <form className="flex gap-2" onSubmit={submitSearch}>
              <Input
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder={t("Search subject, route or opaque digest")}
                aria-label={t("Search feedback")}
              />
              <Button variant="outline" type="submit">
                <SearchIcon />
                {t("Search")}
              </Button>
            </form>
            <div className="grid gap-2 sm:grid-cols-2 @xl/main:grid-cols-5">
              <NativeSelect
                aria-label={t("Status filter")}
                className="w-full"
                value={filters.status}
                onChange={(event) =>
                  updateFilters({
                    status: event.target.value as FeedbackStatus | "all",
                  })
                }
              >
                <NativeSelectOption value="all">
                  {t("All statuses")}
                </NativeSelectOption>
                <NativeSelectOption value="open">
                  {t("Open")}
                </NativeSelectOption>
                <NativeSelectOption value="triaged">
                  {t("Triaged")}
                </NativeSelectOption>
                <NativeSelectOption value="in_progress">
                  {t("In progress")}
                </NativeSelectOption>
                <NativeSelectOption value="waiting">
                  {t("Waiting")}
                </NativeSelectOption>
                <NativeSelectOption value="resolved">
                  {t("Resolved")}
                </NativeSelectOption>
                <NativeSelectOption value="closed">
                  {t("Closed")}
                </NativeSelectOption>
                <NativeSelectOption value="rejected">
                  {t("Rejected")}
                </NativeSelectOption>
              </NativeSelect>
              <NativeSelect
                aria-label={t("Priority filter")}
                className="w-full"
                value={filters.priority}
                onChange={(event) =>
                  updateFilters({
                    priority: event.target.value as FeedbackPriority | "all",
                  })
                }
              >
                <NativeSelectOption value="all">
                  {t("All priorities")}
                </NativeSelectOption>
                <NativeSelectOption value="low">{t("Low")}</NativeSelectOption>
                <NativeSelectOption value="normal">
                  {t("Normal")}
                </NativeSelectOption>
                <NativeSelectOption value="high">
                  {t("High")}
                </NativeSelectOption>
                <NativeSelectOption value="urgent">
                  {t("Urgent")}
                </NativeSelectOption>
              </NativeSelect>
              <NativeSelect
                aria-label={t("Source filter")}
                className="w-full"
                value={filters.source}
                onChange={(event) =>
                  updateFilters({
                    source: event.target.value as FeedbackSource,
                  })
                }
              >
                <NativeSelectOption value="all">
                  {t("All sources")}
                </NativeSelectOption>
                <NativeSelectOption value="form">
                  {t("Forms")}
                </NativeSelectOption>
                <NativeSelectOption value="auto:web">
                  {t("Automatic · Web")}
                </NativeSelectOption>
                <NativeSelectOption value="auto:mobile">
                  {t("Automatic · Mobile")}
                </NativeSelectOption>
                <NativeSelectOption value="auto:server">
                  {t("Automatic · Server")}
                </NativeSelectOption>
              </NativeSelect>
              <NativeSelect
                aria-label={t("Assignment filter")}
                className="w-full"
                value={filters.assignee}
                onChange={(event) =>
                  updateFilters({
                    assignee: event.target.value as FeedbackAssigneeFilter,
                  })
                }
              >
                <NativeSelectOption value="all">
                  {t("All assignments")}
                </NativeSelectOption>
                <NativeSelectOption value="unassigned">
                  {t("Unassigned")}
                </NativeSelectOption>
                <NativeSelectOption value="mine">
                  {t("Assigned to me")}
                </NativeSelectOption>
              </NativeSelect>
              <Input
                value={filters.label}
                onChange={(event) =>
                  updateFilters({ label: event.target.value })
                }
                placeholder={t("Label filter")}
                aria-label={t("Label filter")}
              />
            </div>
          </CardContent>
        </Card>

        {checked.size ? (
          <Card className="border-primary/20 py-3">
            <CardContent className="flex flex-wrap items-center gap-2 px-4">
              <Badge>
                {t("{count} selected", { count: String(checked.size) })}
              </Badge>
              <NativeSelect
                value={bulkStatus}
                onChange={(event) =>
                  setBulkStatus(event.target.value as FeedbackStatus)
                }
              >
                <NativeSelectOption value="triaged">
                  {t("Triaged")}
                </NativeSelectOption>
                <NativeSelectOption value="in_progress">
                  {t("In progress")}
                </NativeSelectOption>
                <NativeSelectOption value="waiting">
                  {t("Waiting")}
                </NativeSelectOption>
                <NativeSelectOption value="resolved">
                  {t("Resolved")}
                </NativeSelectOption>
                <NativeSelectOption value="closed">
                  {t("Closed")}
                </NativeSelectOption>
                <NativeSelectOption value="rejected">
                  {t("Rejected")}
                </NativeSelectOption>
              </NativeSelect>
              <Button
                size="sm"
                disabled={bulk.isPending}
                onClick={() =>
                  bulk.mutate({
                    items: selectedItems.map((item) => ({
                      feedbackId: item.id,
                      expectedRevision: item.revision,
                    })),
                    patch: { status: bulkStatus },
                  })
                }
              >
                {bulk.isPending ? <Spinner /> : null}
                {t("Apply status")}
              </Button>
              <NativeSelect
                value={bulkPriority}
                onChange={(event) =>
                  setBulkPriority(event.target.value as FeedbackPriority)
                }
              >
                <NativeSelectOption value="low">{t("Low")}</NativeSelectOption>
                <NativeSelectOption value="normal">
                  {t("Normal")}
                </NativeSelectOption>
                <NativeSelectOption value="high">
                  {t("High")}
                </NativeSelectOption>
                <NativeSelectOption value="urgent">
                  {t("Urgent")}
                </NativeSelectOption>
              </NativeSelect>
              <Button
                size="sm"
                variant="outline"
                disabled={bulk.isPending}
                onClick={() =>
                  bulk.mutate({
                    items: selectedItems.map((item) => ({
                      feedbackId: item.id,
                      expectedRevision: item.revision,
                    })),
                    patch: { priority: bulkPriority },
                  })
                }
              >
                {t("Apply priority")}
              </Button>
              <NativeSelect
                value={bulkAssignee}
                onChange={(event) => setBulkAssignee(event.target.value)}
              >
                <NativeSelectOption value="">
                  {t("Unassigned")}
                </NativeSelectOption>
                {assignees.data?.map((assignee) => (
                  <NativeSelectOption key={assignee.id} value={assignee.id}>
                    {assignee.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
              <Button
                size="sm"
                variant="outline"
                disabled={bulk.isPending}
                onClick={() =>
                  bulk.mutate({
                    items: selectedItems.map((item) => ({
                      feedbackId: item.id,
                      expectedRevision: item.revision,
                    })),
                    patch: { assignedToUserId: bulkAssignee || null },
                  })
                }
              >
                {t("Apply assignee")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setChecked(new Set())}
              >
                {t("Clear selection")}
              </Button>
            </CardContent>
          </Card>
        ) : null}

        <div className="grid min-h-[34rem] overflow-hidden rounded-xl border bg-card @xl/main:grid-cols-[minmax(20rem,0.9fr)_minmax(28rem,1.1fr)]">
          <section
            className="border-b @xl/main:border-r @xl/main:border-b-0"
            aria-label={t("Feedback queue")}
          >
            <div className="flex items-center justify-between border-b p-3">
              <div className="flex items-center gap-2 text-sm font-medium">
                <InboxIcon className="size-4" />
                {t("Queue")}
                <Badge variant="outline">{queue.data?.total ?? 0}</Badge>
              </div>
              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <Checkbox
                  checked={Boolean(
                    queue.data?.items.length &&
                    checked.size === queue.data.items.length
                  )}
                  onCheckedChange={(value) =>
                    setChecked(
                      value === true
                        ? new Set(
                            queue.data?.items.map((item) => item.id) ?? []
                          )
                        : new Set()
                    )
                  }
                />
                {t("Select page")}
              </label>
            </div>
            {queue.isLoading ? (
              <div className="grid min-h-64 place-items-center">
                <Spinner />
              </div>
            ) : null}
            <ul className="max-h-[44rem] divide-y overflow-y-auto">
              {queue.data?.items.map((item) => (
                <li
                  key={item.id}
                  className={
                    resolvedSelectedId === item.id ? "bg-primary/5" : undefined
                  }
                >
                  <div className="flex items-start gap-3 p-3">
                    <Checkbox
                      className="mt-1"
                      checked={checked.has(item.id)}
                      onCheckedChange={(value) =>
                        setChecked((current) => {
                          const next = new Set(current)
                          if (value === true) next.add(item.id)
                          else next.delete(item.id)
                          return next
                        })
                      }
                      aria-label={t("Select feedback item")}
                    />
                    <button
                      type="button"
                      className="min-w-0 flex-1 space-y-2 text-left"
                      onClick={() => setSelectedId(item.id)}
                    >
                      <div className="flex flex-wrap items-center gap-1.5">
                        {item.source.startsWith("auto:") ? (
                          <BotIcon className="size-3.5 text-muted-foreground" />
                        ) : null}
                        <Badge
                          variant={
                            item.priority === "urgent"
                              ? "destructive"
                              : "outline"
                          }
                        >
                          {item.priority}
                        </Badge>
                        <Badge variant="secondary">{item.status}</Badge>
                        {item.duplicateCount > 1 ? (
                          <Badge variant="outline">
                            ×{item.duplicateCount}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="line-clamp-2 text-sm font-medium">
                        {item.subject}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {item.labels.map((label) => (
                          <Badge key={label} variant="outline">
                            {label}
                          </Badge>
                        ))}
                      </div>
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {!queue.data?.items.length && !queue.isLoading ? (
              <p className="p-8 text-center text-sm text-muted-foreground">
                {t("No feedback matches these filters.")}
              </p>
            ) : null}
            <div className="flex items-center justify-between border-t p-3">
              <Button
                size="sm"
                variant="outline"
                disabled={filters.offset === 0}
                onClick={() =>
                  updateFilters({ offset: Math.max(0, filters.offset - 50) })
                }
              >
                <ChevronLeftIcon />
                {t("Previous")}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={!hasNext}
                onClick={() => updateFilters({ offset: filters.offset + 50 })}
              >
                {t("Next")}
                <ChevronRightIcon />
              </Button>
            </div>
          </section>
          <aside aria-label={t("Feedback detail")}>
            {resolvedSelectedId ? (
              <FeedbackDetailPane
                key={resolvedSelectedId}
                feedbackId={resolvedSelectedId}
              />
            ) : (
              <div className="grid min-h-80 place-items-center text-sm text-muted-foreground">
                {t("Choose a feedback item.")}
              </div>
            )}
          </aside>
        </div>
      </div>
    </>
  )
}
