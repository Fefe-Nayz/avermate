"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  CalendarClockIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { toast } from "sonner"
import { ChoiceField, TextField } from "@/components/forms/controls"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
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
import { Field, FieldLabel } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

type Tone = "info" | "success" | "warning" | "danger"
interface Draft {
  id?: string
  title: string
  message: string
  tone: Tone
  active: boolean
  startsAt: string
  endsAt: string
}

const emptyDraft = (): Draft => ({
  title: "",
  message: "",
  tone: "info",
  active: true,
  startsAt: "",
  endsAt: "",
})

function localDateTime(value: Date | string | null): string {
  if (!value) return ""
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

function asDate(value: string): Date | null {
  return value ? new Date(value) : null
}

export function AdminAnnouncementsClient() {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<Draft>(emptyDraft)
  const [editing, setEditing] = useState<Draft | null>(null)
  const [renderedAt] = useState(() => Date.now())

  const list = useQuery(orpc.admin.announcements.queryOptions())
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.admin.announcements.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.announcements.active.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.announcements.history.key(),
      }),
    ])

  const create = useMutation({
    ...orpc.admin.createAnnouncement.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Announcement saved."))
      setDraft(emptyDraft())
      void invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const update = useMutation({
    ...orpc.admin.updateAnnouncement.mutationOptions(),
    onSuccess: () => {
      setEditing(null)
      toast.success(t("Announcement updated."))
      void invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const remove = useMutation({
    ...orpc.admin.deleteAnnouncement.mutationOptions(),
    onSuccess: () => {
      toast.success(t("Announcement deleted."))
      void invalidate()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const saveDraft = () =>
    create.mutate({
      title: draft.title.trim(),
      message: draft.message.trim(),
      tone: draft.tone,
      active: draft.active,
      startsAt: asDate(draft.startsAt),
      endsAt: asDate(draft.endsAt),
    })

  return (
    <>
      <PageMeta title={t("Announcements")} backHref="/admin" />
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
            {t("Announcements")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("Publish immediately or schedule a precise visibility window.")}
          </p>
        </div>

        <SettingsSection
          title={t("New announcement")}
          footer={
            <Button
              size="sm"
              disabled={
                create.isPending || !draft.title.trim() || !draft.message.trim()
              }
              onClick={saveDraft}
            >
              {create.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <PlusIcon className="size-4" />
              )}
              {draft.active ? t("Publish or schedule") : t("Save draft")}
            </Button>
          }
        >
          <AnnouncementFields draft={draft} onChange={setDraft} />
        </SettingsSection>

        <ul className="flex flex-col gap-2">
          {list.data?.map((announcement) => {
            const starts = announcement.startsAt
              ? new Date(announcement.startsAt).getTime()
              : null
            const ends = announcement.endsAt
              ? new Date(announcement.endsAt).getTime()
              : null
            const state = !announcement.active
              ? t("Inactive")
              : starts && starts > renderedAt
                ? t("Scheduled")
                : ends && ends < renderedAt
                  ? t("Expired")
                  : t("Visible")
            return (
              <li
                key={announcement.id}
                className="rounded-xl border bg-card p-4"
              >
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate font-medium">
                        {announcement.title}
                      </p>
                      <Badge
                        variant={announcement.active ? "secondary" : "outline"}
                      >
                        {state}
                      </Badge>
                      <Badge variant="outline">{announcement.tone}</Badge>
                    </div>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
                      {announcement.message}
                    </p>
                    <p className="mt-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                      <CalendarClockIcon className="size-3.5" />
                      {announcement.startsAt
                        ? t("Starts {date}", {
                            date: format.dateTime(
                              new Date(announcement.startsAt),
                              {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }
                            ),
                          })
                        : t("Starts immediately")}
                      {" · "}
                      {announcement.endsAt
                        ? t("ends {date}", {
                            date: format.dateTime(
                              new Date(announcement.endsAt),
                              {
                                dateStyle: "medium",
                                timeStyle: "short",
                              }
                            ),
                          })
                        : t("no expiry")}
                    </p>
                  </div>
                  <Switch
                    checked={announcement.active}
                    aria-label={t("Active")}
                    onCheckedChange={(active) =>
                      update.mutate({ announcementId: announcement.id, active })
                    }
                  />
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Edit")}
                    onClick={() =>
                      setEditing({
                        id: announcement.id,
                        title: announcement.title,
                        message: announcement.message,
                        tone: announcement.tone as Tone,
                        active: announcement.active,
                        startsAt: localDateTime(announcement.startsAt),
                        endsAt: localDateTime(announcement.endsAt),
                      })
                    }
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="text-destructive"
                    aria-label={t("Delete")}
                    disabled={remove.isPending}
                    onClick={() =>
                      remove.mutate({ announcementId: announcement.id })
                    }
                  >
                    <Trash2Icon className="size-4" />
                  </Button>
                </div>
              </li>
            )
          })}
        </ul>

        {list.data?.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {t("No announcements yet.")}
          </p>
        ) : null}
      </div>

      <Dialog
        open={Boolean(editing)}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("Edit announcement")}</DialogTitle>
            <DialogDescription>
              {t(
                "Changes are reflected in the inbox and active banner immediately."
              )}
            </DialogDescription>
          </DialogHeader>
          {editing ? (
            <AnnouncementFields draft={editing} onChange={setEditing} />
          ) : null}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t("Cancel")}
            </Button>
            <Button
              disabled={
                !editing?.title.trim() ||
                !editing.message.trim() ||
                update.isPending
              }
              onClick={() => {
                if (!editing?.id) return
                update.mutate({
                  announcementId: editing.id,
                  title: editing.title.trim(),
                  message: editing.message.trim(),
                  tone: editing.tone,
                  active: editing.active,
                  startsAt: asDate(editing.startsAt),
                  endsAt: asDate(editing.endsAt),
                })
              }}
            >
              {update.isPending ? <Spinner className="size-4" /> : null}
              {t("Save changes")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

function AnnouncementFields({
  draft,
  onChange,
}: {
  draft: Draft
  onChange: (draft: Draft) => void
}) {
  const t = useExtracted()
  return (
    <>
      <TextField
        label={t("Title")}
        value={draft.title}
        maxLength={120}
        onChange={(event) => onChange({ ...draft, title: event.target.value })}
      />
      <Field>
        <FieldLabel>{t("Message")}</FieldLabel>
        <Textarea
          value={draft.message}
          maxLength={2000}
          rows={4}
          onChange={(event) =>
            onChange({ ...draft, message: event.target.value })
          }
        />
      </Field>
      <ChoiceField
        label={t("Tone")}
        choices={[
          { value: "info", label: t("Info") },
          { value: "success", label: t("Good news") },
          { value: "warning", label: t("Heads up") },
          { value: "danger", label: t("Problem") },
        ]}
        value={draft.tone}
        onValueChange={(tone) => onChange({ ...draft, tone })}
        columns={2}
      />
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField
          label={t("Starts (optional)")}
          type="datetime-local"
          value={draft.startsAt}
          onChange={(event) =>
            onChange({ ...draft, startsAt: event.target.value })
          }
        />
        <TextField
          label={t("Ends (optional)")}
          type="datetime-local"
          value={draft.endsAt}
          min={draft.startsAt || undefined}
          onChange={(event) =>
            onChange({ ...draft, endsAt: event.target.value })
          }
        />
      </div>
      <label className="flex items-center justify-between gap-3 rounded-lg border p-3 text-sm font-medium">
        <span>
          {t("Active")}
          <span className="mt-0.5 block text-xs font-normal text-muted-foreground">
            {t(
              "Inactive announcements stay as drafts regardless of their schedule."
            )}
          </span>
        </span>
        <Switch
          checked={draft.active}
          onCheckedChange={(active) => onChange({ ...draft, active })}
        />
      </label>
    </>
  )
}
