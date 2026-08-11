"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { PlusIcon, Trash2Icon } from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Spinner } from "@/components/ui/spinner"
import { Field, FieldLabel } from "@/components/ui/field"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import { ChoiceField, TextField } from "@/components/forms/controls"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"

export function AdminAnnouncementsClient() {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()

  const [title, setTitle] = useState("")
  const [message, setMessage] = useState("")
  const [tone, setTone] = useState<"info" | "success" | "warning" | "danger">(
    "info"
  )

  const list = useQuery(orpc.admin.announcements.queryOptions())
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.admin.announcements.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.announcements.active.key(),
      }),
    ])

  const create = useMutation({
    ...orpc.admin.createAnnouncement.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Announcement published."))
      setTitle("")
      setMessage("")
      void invalidate()
    },
  })

  const update = useMutation({
    ...orpc.admin.updateAnnouncement.mutationOptions(),
    onSuccess: () => void invalidate(),
  })

  const remove = useMutation({
    ...orpc.admin.deleteAnnouncement.mutationOptions(),
    onSuccess: () => void invalidate(),
  })

  return (
    <>
      <PageMeta title={t("Announcements")} backHref="/admin" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Announcements")}
        </h1>

        <SettingsSection
          title={t("New announcement")}
          footer={
            <Button
              size="sm"
              disabled={create.isPending || !title.trim() || !message.trim()}
              onClick={() =>
                create.mutate({
                  title: title.trim(),
                  message: message.trim(),
                  tone,
                  active: true,
                  startsAt: null,
                  endsAt: null,
                })
              }
            >
              {create.isPending ? (
                <Spinner className="size-4" />
              ) : (
                <PlusIcon className="size-4" />
              )}
              {t("Publish")}
            </Button>
          }
        >
          <TextField
            label={t("Title")}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <Field>
            <FieldLabel htmlFor="announcement-message">
              {t("Message")}
            </FieldLabel>
            <Textarea
              id="announcement-message"
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              rows={3}
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
            value={tone}
            onValueChange={setTone}
            columns={2}
          />
        </SettingsSection>

        <ul className="flex flex-col gap-2">
          {list.data?.map((announcement) => (
            <li
              key={announcement.id}
              className="flex items-start gap-3 rounded-xl border bg-card p-4"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{announcement.title}</p>
                <p className="text-sm text-muted-foreground">
                  {announcement.message}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {announcement.tone}
                  {" · "}
                  {format.dateTime(new Date(announcement.createdAt), {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </p>
              </div>
              <Switch
                checked={announcement.active}
                onCheckedChange={(checked) =>
                  update.mutate({
                    announcementId: announcement.id,
                    active: checked,
                  })
                }
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("Delete")}
                onClick={() =>
                  remove.mutate({ announcementId: announcement.id })
                }
              >
                <Trash2Icon className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}
