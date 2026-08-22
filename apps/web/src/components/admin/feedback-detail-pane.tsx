"use client"

import { useState } from "react"
import Image from "next/image"
import Link from "next/link"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { MessageSquarePlusIcon, TagIcon, XIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { orpc } from "@/lib/orpc"
import type {
  FeedbackPriority,
  FeedbackStatus,
} from "@/lib/admin-feedback-query"

const SAFE_CONTEXT_KEYS = new Set([
  "appVersion",
  "browser",
  "buildVersion",
  "connectivity",
  "device",
  "locale",
  "os",
  "platform",
  "route",
  "userAgent",
  "viewport",
])

function safeContextEntries(context: Record<string, string>) {
  return Object.entries(context)
    .filter(
      ([key, value]) => SAFE_CONTEXT_KEYS.has(key) && typeof value === "string"
    )
    .map(([key, value]) => [key, value.slice(0, 500)] as const)
}

export function FeedbackDetailPane({ feedbackId }: { feedbackId: string }) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const detail = useQuery(
    orpc.admin.feedbackDetail.queryOptions({ input: { feedbackId } })
  )
  const assignees = useQuery(orpc.admin.feedbackAssignees.queryOptions())
  const [label, setLabel] = useState("")
  const [comment, setComment] = useState("")

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
  const update = useMutation({
    ...orpc.admin.updateFeedbackTriage.mutationOptions(),
    onSuccess: refresh,
    onError: async () => {
      toast.error(
        t("This item changed elsewhere. The latest version was reloaded.")
      )
      await refresh()
    },
  })
  const addLabel = useMutation({
    ...orpc.admin.addFeedbackLabel.mutationOptions(),
    onSuccess: async () => {
      setLabel("")
      await refresh()
    },
  })
  const removeLabel = useMutation({
    ...orpc.admin.removeFeedbackLabel.mutationOptions(),
    onSuccess: refresh,
  })
  const addComment = useMutation({
    ...orpc.admin.addFeedbackComment.mutationOptions(),
    onSuccess: async () => {
      setComment("")
      await refresh()
    },
  })

  if (!detail.data) {
    return (
      <div className="grid min-h-80 place-items-center">
        <Spinner />
      </div>
    )
  }

  const item = detail.data
  const context = safeContextEntries(item.context)
  const busy =
    update.isPending ||
    addLabel.isPending ||
    removeLabel.isPending ||
    addComment.isPending

  function patch(next: {
    status?: FeedbackStatus
    priority?: FeedbackPriority
    assignedToUserId?: string | null
  }) {
    update.mutate({
      feedbackId: item.id,
      expectedRevision: item.revision,
      patch: next,
    })
  }

  return (
    <ScrollArea className="max-h-[calc(100svh-12rem)]">
      <div className="space-y-5 p-4">
        <header className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge>{item.kind}</Badge>
            <Badge
              variant={
                item.source.startsWith("auto:") ? "secondary" : "outline"
              }
            >
              {item.source.startsWith("auto:") ? t("Automatic") : t("Form")}
            </Badge>
            {item.duplicateCount > 1 ? (
              <Badge variant="outline">
                {t("{count} occurrences", {
                  count: String(item.duplicateCount),
                })}
              </Badge>
            ) : null}
          </div>
          <h2 className="text-lg font-semibold">{item.subject}</h2>
          <p className="text-sm whitespace-pre-wrap text-muted-foreground">
            {item.message}
          </p>
        </header>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="feedback-status">{t("Status")}</Label>
            <SelectControl
              id="feedback-status"
              value={item.status}
              disabled={busy}
              onValueChange={(value) =>
                patch({ status: value as FeedbackStatus })
              }
              options={[
                { value: "open", label: t("Open") },
                { value: "triaged", label: t("Triaged") },
                { value: "in_progress", label: t("In progress") },
                { value: "waiting", label: t("Waiting") },
                { value: "resolved", label: t("Resolved") },
                { value: "closed", label: t("Closed") },
                { value: "rejected", label: t("Rejected") },
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="feedback-priority">{t("Priority")}</Label>
            <SelectControl
              id="feedback-priority"
              value={item.priority}
              disabled={busy}
              onValueChange={(value) =>
                patch({ priority: value as FeedbackPriority })
              }
              options={[
                { value: "low", label: t("Low") },
                { value: "normal", label: t("Normal") },
                { value: "high", label: t("High") },
                { value: "urgent", label: t("Urgent") },
              ]}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="feedback-assignee">{t("Assignee")}</Label>
            <SelectControl
              id="feedback-assignee"
              value={item.assignedToUserId ?? ""}
              disabled={busy}
              onValueChange={(value) =>
                patch({ assignedToUserId: value || null })
              }
              placeholder={t("Unassigned")}
              options={(assignees.data ?? []).map((assignee) => ({
                value: assignee.id,
                label: assignee.name,
              }))}
            />
          </div>
        </div>

        <dl className="grid gap-2 rounded-xl border p-3 text-xs sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">{t("Reporter")}</dt>
            <dd>
              <Link
                href={`/admin/users/${item.reporter.id}`}
                className="font-medium hover:underline"
              >
                {item.reporter.name}
              </Link>
              <span className="block text-muted-foreground">
                {item.reporter.email}
              </span>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">{t("Last seen")}</dt>
            <dd>
              {format.dateTime(item.lastSeenAt, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </dd>
          </div>
          {item.route ? (
            <div>
              <dt className="text-muted-foreground">{t("Sanitized route")}</dt>
              <dd className="font-mono">{item.route}</dd>
            </div>
          ) : null}
          {item.errorDigest ? (
            <div>
              <dt className="text-muted-foreground">
                {t("Opaque error digest")}
              </dt>
              <dd className="truncate font-mono">{item.errorDigest}</dd>
            </div>
          ) : null}
        </dl>

        {item.attachmentUrl ? (
          <a
            href={item.attachmentUrl}
            target="_blank"
            rel="noreferrer"
            className="relative block aspect-video overflow-hidden rounded-xl border bg-muted"
          >
            <Image
              src={item.attachmentUrl}
              alt={t("Feedback screenshot")}
              fill
              sizes="(max-width: 768px) 100vw, 36rem"
              className="object-contain"
            />
          </a>
        ) : null}

        {context.length ? (
          <section className="space-y-2">
            <h3 className="text-sm font-medium">
              {t("Redacted technical context")}
            </h3>
            <dl className="grid gap-2 rounded-xl bg-muted/60 p-3 text-xs sm:grid-cols-2">
              {context.map(([key, value]) => (
                <div key={key} className="min-w-0">
                  <dt className="text-muted-foreground">{key}</dt>
                  <dd className="font-mono break-words">{value}</dd>
                </div>
              ))}
            </dl>
          </section>
        ) : null}

        <section className="space-y-2">
          <h3 className="text-sm font-medium">{t("Labels")}</h3>
          <div className="flex flex-wrap gap-2">
            {item.labels.map((entry) => (
              <Badge key={entry.id ?? entry.label} variant="secondary">
                {entry.label}
                <button
                  type="button"
                  aria-label={t("Remove label")}
                  disabled={busy}
                  onClick={() =>
                    removeLabel.mutate({
                      feedbackId: item.id,
                      label: entry.label,
                    })
                  }
                >
                  <XIcon className="size-3" />
                </button>
              </Badge>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={30}
              placeholder={t("Add label")}
            />
            <Button
              variant="outline"
              disabled={busy || !label.trim()}
              onClick={() =>
                addLabel.mutate({ feedbackId: item.id, label: label.trim() })
              }
            >
              <TagIcon /> {t("Add")}
            </Button>
          </div>
        </section>

        <section className="space-y-3">
          <h3 className="text-sm font-medium">{t("Internal timeline")}</h3>
          <ol className="space-y-2 border-l pl-4">
            {item.events.map((event) => (
              <li key={event.id} className="text-xs">
                <p className="font-medium">{event.kind}</p>
                <p className="text-muted-foreground">
                  {event.actorName || t("System")} ·{" "}
                  {event.changedKeys.join(", ") || t("Event")}
                </p>
              </li>
            ))}
            {item.comments.map((entry) => (
              <li key={entry.id} className="rounded-lg bg-muted p-3 text-sm">
                <p className="whitespace-pre-wrap">{entry.body}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {entry.authorName || t("Administrator")}
                </p>
              </li>
            ))}
          </ol>
          <Textarea
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            maxLength={4000}
            rows={3}
            placeholder={t("Add an internal comment")}
          />
          <Button
            disabled={busy || !comment.trim()}
            onClick={() =>
              addComment.mutate({ feedbackId: item.id, body: comment.trim() })
            }
          >
            <MessageSquarePlusIcon /> {t("Add internal comment")}
          </Button>
        </section>
      </div>
    </ScrollArea>
  )
}
