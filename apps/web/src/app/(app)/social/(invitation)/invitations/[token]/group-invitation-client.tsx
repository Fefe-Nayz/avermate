"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookCopyIcon,
  CalendarRangeIcon,
  LinkIcon,
  SchoolIcon,
} from "lucide-react"
import { useExtracted, useLocale } from "next-intl"
import { toast } from "sonner"
import { ChoiceField } from "@/components/forms/controls"
import {
  SocialCallout,
  SocialEmpty,
  SocialSection,
} from "@/components/social/social-ui"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

type JoinMode = "existing" | "copy"

/** Joining a class always chooses its academic year before membership exists. */
export function GroupInvitationClient({ token }: { token: string }) {
  const t = useExtracted()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const preview = useQuery({
    ...orpc.social.groups.invitations.preview.queryOptions({
      input: { token },
    }),
    retry: false,
  })
  const [modeChoice, setModeChoice] = useState<JoinMode | null>(null)
  const [yearId, setYearId] = useState("")
  const [copyName, setCopyName] = useState<string | null>(null)

  const accept = useMutation({
    ...orpc.social.groups.invitations.accept.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      toast.success(
        result.joined
          ? t("Welcome to the class.")
          : t("You are already a member.")
      )
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: orpc.years.list.key() }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.list.key(),
        }),
      ])
      router.push(`/social/groups/${result.groupId}`)
    },
    onError: (error) =>
      toast.error(error.message || t("This invitation can no longer be used.")),
  })

  if (preview.isLoading) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }
  const data = preview.data
  if (!data) {
    return (
      <div className="mx-auto w-full max-w-md py-10">
        <SocialEmpty
          icon={LinkIcon}
          title={t("This invitation is no longer valid")}
          description={t(
            "It may have expired, been revoked, or the class is gone."
          )}
          action={
            <Button
              variant="outline"
              onClick={() => router.push("/social/groups")}
            >
              {t("Go to classes")}
            </Button>
          }
        />
      </div>
    )
  }

  const template = data.group.classTemplate
  const mode = modeChoice ?? (data.compatibleYears.length ? "existing" : "copy")
  const selectedYearId = yearId || data.compatibleYears[0]?.id || ""
  const resolvedCopyName = copyName ?? template?.yearName ?? data.group.name
  const date = (value: Date) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
      new Date(value)
    )

  return (
    <div className="mx-auto w-full max-w-lg py-10">
      <SocialSection
        icon={SchoolIcon}
        title={data.group.name}
        description={data.group.description || undefined}
      >
        <p className="text-sm text-muted-foreground">
          {data.inviter
            ? t("{name} invites you to this class. {count} people are in.", {
                name: data.inviter.name,
                count: String(data.group.memberCount),
              })
            : t("{count} people are in this class.", {
                count: String(data.group.memberCount),
              })}
        </p>

        {template ? (
          <div className="rounded-lg border bg-muted/40 px-4 py-3">
            <p className="text-sm font-medium">{template.yearName}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("{start} – {end} · /{scale}", {
                start: date(template.startsAt),
                end: date(template.endsAt),
                scale: String(template.scale),
              })}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t(
                "{subjects} subjects · {averages} custom averages · {periods} periods",
                {
                  subjects: String(template.subjectCount),
                  averages: String(template.averageCount),
                  periods: String(template.periodCount),
                }
              )}
            </p>
          </div>
        ) : (
          <SocialCallout tone="caution" title={t("Class setup incomplete")}>
            {t("The owner must choose a model year before anyone can join.")}
          </SocialCallout>
        )}

        {data.alreadyMember ? (
          <Button
            variant="outline"
            onClick={() => router.push("/social/groups")}
          >
            {t("You are already a member — open classes")}
          </Button>
        ) : template ? (
          <div className="flex flex-col gap-4">
            <ChoiceField
              label={t("Your year in this class")}
              value={mode}
              onValueChange={setModeChoice}
              choices={[
                ...(data.compatibleYears.length
                  ? [
                      {
                        value: "existing" as const,
                        label: t("Use an existing year"),
                        description: t(
                          "Connect a compatible year without changing it."
                        ),
                        icon: <CalendarRangeIcon className="size-4" />,
                      },
                    ]
                  : []),
                {
                  value: "copy" as const,
                  label: t("Create a new year"),
                  description: t(
                    "Copy the class structure into a separate empty year."
                  ),
                  icon: <BookCopyIcon className="size-4" />,
                },
              ]}
            />

            {mode === "existing" ? (
              <div className="space-y-2">
                <Label>{t("Compatible year")}</Label>
                <div className="grid gap-2">
                  {data.compatibleYears.map((year) => {
                    const selected = year.id === selectedYearId
                    return (
                      <button
                        key={year.id}
                        type="button"
                        aria-pressed={selected}
                        onClick={() => setYearId(year.id)}
                        className={
                          selected
                            ? "rounded-lg border border-primary bg-primary/6 px-3 py-2 text-left ring-1 ring-primary/30"
                            : "rounded-lg border px-3 py-2 text-left hover:bg-accent/50"
                        }
                      >
                        <span className="block text-sm font-medium">
                          {year.name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {t("{start} – {end}", {
                            start: date(year.startsAt),
                            end: date(year.endsAt),
                          })}
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <Label htmlFor="class-copy-name">{t("New year name")}</Label>
                <Input
                  id="class-copy-name"
                  value={resolvedCopyName}
                  onChange={(event) => setCopyName(event.target.value)}
                  maxLength={100}
                />
                <p className="text-xs text-muted-foreground">
                  {t(
                    "This creates a new year. None of your existing years or grades are changed."
                  )}
                </p>
              </div>
            )}

            <SocialCallout title={t("Sharing stays off")}>
              {t(
                "Joining does not publish your results. You can turn sharing on from inside the class."
              )}
            </SocialCallout>

            <Button
              disabled={
                accept.isPending ||
                (mode === "existing"
                  ? !selectedYearId
                  : !resolvedCopyName.trim())
              }
              onClick={() =>
                accept.mutate({
                  token,
                  year:
                    mode === "existing"
                      ? { mode: "existing", yearId: selectedYearId }
                      : { mode: "copy", name: resolvedCopyName.trim() },
                })
              }
            >
              {accept.isPending ? <Spinner /> : <SchoolIcon />}
              {t("Join the class")}
            </Button>
          </div>
        ) : null}
      </SocialSection>
    </div>
  )
}
