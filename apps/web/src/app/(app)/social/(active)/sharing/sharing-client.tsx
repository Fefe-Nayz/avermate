"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AtSignIcon,
  BookOpenIcon,
  EyeIcon,
  GaugeIcon,
  ShieldCheckIcon,
} from "lucide-react"
import { useExtracted, useLocale } from "next-intl"
import { toast } from "sonner"
import {
  SharedAverage,
  SharingState,
  SocialCallout,
  SocialHeading,
  SocialList,
  SocialRow,
  SocialSection,
} from "@/components/social/social-ui"
import { sharingHistoryState } from "@/components/social/sharing-preview"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { SelectControl } from "@/components/forms/controls"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * The locks. Everything a friend can ever see of this account is decided on
 * this one screen, and the preview underneath is the exact server answer a
 * friend receives — not a mock-up of it.
 */
export function SharingClient() {
  const t = useExtracted()
  const locale = useLocale()
  const queryClient = useQueryClient()
  const sharing = useQuery(orpc.social.sharing.get.queryOptions())
  const years = useQuery(orpc.years.list.queryOptions())
  const [handle, setHandle] = useState<string | undefined>(undefined)

  const settings = sharing.data
  const yearId = settings?.sharedYearId ?? settings?.resolvedYear?.id ?? ""
  const subjects = useQuery({
    ...orpc.subjects.list.queryOptions({ input: { yearId } }),
    enabled: Boolean(yearId),
  })

  const handleValue = handle ?? settings?.handle ?? ""

  const update = useMutation({
    ...orpc.social.sharing.update.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await queryClient.invalidateQueries({
        queryKey: orpc.social.sharing.get.key(),
      })
    },
    onError: (error) =>
      toast.error(
        error.message.includes("taken")
          ? t("That handle is already taken.")
          : t("The change could not be saved.")
      ),
  })

  if (sharing.isError) {
    return (
      <SocialCallout tone="caution" title={t("Sharing settings unavailable")}>
        {t("The server could not answer. Refresh, or try again shortly.")}
      </SocialCallout>
    )
  }
  if (sharing.isLoading || !settings) {
    return (
      <div className="flex justify-center py-16">
        <Spinner />
      </div>
    )
  }

  const activeYears = (years.data ?? []).filter((year) => !year.archivedAt)
  const sharedSet = new Set(settings.sharedSubjectIds)
  const leafSubjects = (subjects.data ?? []).filter(
    (subject) => subject.kind !== "category"
  )

  return (
    <div className="flex flex-col gap-4">
      <SocialHeading
        icon={ShieldCheckIcon}
        title={t("Sharing")}
        description={t(
          "Three locks decide what every friend sees: your general average, its history, and your subjects. Each class has its own separate switch."
        )}
      />

      <SocialSection
        icon={AtSignIcon}
        title={t("Your handle")}
        description={t(
          "Friends find you with it. Leave empty to be reachable by invitation link only."
        )}
      >
        <div className="flex gap-2">
          <Input
            value={handleValue}
            onChange={(event) => setHandle(event.target.value)}
            placeholder={t("your-handle")}
            aria-label={t("Your handle")}
            maxLength={32}
          />
          <Button
            type="button"
            variant="outline"
            disabled={
              update.isPending || handleValue === (settings.handle ?? "")
            }
            onClick={() =>
              update.mutate({
                handle: handleValue.trim() ? handleValue.trim() : null,
              })
            }
          >
            {update.isPending ? <Spinner /> : null}
            {t("Save")}
          </Button>
        </div>
      </SocialSection>

      <SocialSection
        icon={GaugeIcon}
        title={t("What friends see")}
        description={t("Changes apply immediately to every friend.")}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("General average")}</p>
            <p className="text-xs text-muted-foreground">
              {t("One number for the whole year.")}
            </p>
          </div>
          <Switch
            checked={settings.shareGeneralAverage}
            disabled={update.isPending}
            onCheckedChange={(checked) =>
              update.mutate({ shareGeneralAverage: checked })
            }
            aria-label={t("Share my general average")}
          />
        </div>

        {/* A third lock, under the first because it is a *widening* of it rather than a
            separate thing to share — and disabled when the first is shut, since a history
            of an average nobody sees is a history of nothing. */}
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("How it changed")}</p>
            <p className="text-xs text-muted-foreground">
              {t(
                "Lets friends draw your average across the year beside their own. It shows when your year dipped, not only where it stands."
              )}
            </p>
          </div>
          <Switch
            checked={settings.shareHistory}
            disabled={update.isPending || !settings.shareGeneralAverage}
            onCheckedChange={(checked) =>
              update.mutate({ shareHistory: checked })
            }
            aria-label={t("Share how my average changed")}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="share-subjects-mode">{t("Subject averages")}</Label>
          <SelectControl
            id="share-subjects-mode"
            value={settings.shareSubjectsMode}
            onValueChange={(value) =>
              update.mutate({
                shareSubjectsMode: value as "all" | "selected" | "none",
              })
            }
            options={[
              { value: "all", label: t("All subjects") },
              { value: "selected", label: t("Only subjects I pick") },
              { value: "none", label: t("No subjects") },
            ]}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="shared-year">{t("Year being shared")}</Label>
          <SelectControl
            id="shared-year"
            value={settings.sharedYearId ?? "__current__"}
            onValueChange={(value) =>
              update.mutate({
                sharedYearId: value === "__current__" ? null : value,
              })
            }
            options={[
              {
                value: "__current__",
                label: settings.resolvedYear
                  ? t("My current year ({name})", {
                      name: settings.resolvedYear.name,
                    })
                  : t("My current year"),
              },
              ...activeYears.map((year) => ({
                value: year.id,
                label: year.name,
              })),
            ]}
          />
        </div>
      </SocialSection>

      {settings.shareSubjectsMode === "selected" ? (
        <SocialSection
          icon={BookOpenIcon}
          title={t("Subjects you share")}
          description={t("Unchecked subjects never leave your account.")}
        >
          {subjects.isLoading ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : leafSubjects.length ? (
            <ul className="flex flex-col gap-1">
              {leafSubjects.map((subject) => {
                const checked = sharedSet.has(subject.id)
                return (
                  <li key={subject.id}>
                    <label className="flex min-h-10 cursor-pointer items-center gap-3 rounded-md px-2 py-1 text-sm hover:bg-accent/50">
                      <Checkbox
                        checked={checked}
                        disabled={update.isPending}
                        onCheckedChange={(next) => {
                          const ids = new Set(settings.sharedSubjectIds)
                          if (next) ids.add(subject.id)
                          else ids.delete(subject.id)
                          update.mutate({ sharedSubjectIds: [...ids] })
                        }}
                      />
                      <span className="min-w-0 truncate">{subject.name}</span>
                    </label>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("The shared year has no subjects yet.")}
            </p>
          )}
        </SocialSection>
      ) : null}

      <SocialSection
        icon={EyeIcon}
        title={t("Exactly what a friend sees")}
        description={t(
          "This preview is the same answer the server gives them."
        )}
      >
        {settings.preview ? (
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("General average")}</span>
              {settings.preview.shareGeneralAverage ? (
                <SharedAverage
                  ratio={settings.preview.generalAverage}
                  scale={settings.preview.year.scale}
                  decimals={settings.preview.year.decimals}
                  locale={locale}
                />
              ) : (
                <SharingState granted={false} label={t("Locked")} />
              )}
            </div>
            {settings.preview.subjects.length ? (
              <SocialList>
                {settings.preview.subjects.map((subject) => (
                  <SocialRow
                    key={subject.id}
                    trailing={
                      <SharedAverage
                        ratio={subject.average}
                        scale={settings.preview!.year.scale}
                        decimals={settings.preview!.year.decimals}
                        locale={locale}
                      />
                    }
                  >
                    <p className="truncate text-sm">{subject.name}</p>
                  </SocialRow>
                ))}
              </SocialList>
            ) : (
              <p className="text-sm text-muted-foreground">
                {t("No subject averages are shared.")}
              </p>
            )}
            {/* The third lock, which the preview claimed to show everything about and
                then left out entirely: the server already sends the curve, so a reader
                turning history on saw the switch move and this panel say nothing. */}
            <div className="flex items-center justify-between gap-3">
              <span className="text-sm">{t("Average over time")}</span>
              {sharingHistoryState(settings.preview.history) === "shared" ? (
                <span className="text-sm text-muted-foreground">
                  {t("{count} points", {
                    count: String(settings.preview.history?.length ?? 0),
                  })}
                </span>
              ) : sharingHistoryState(settings.preview.history) === "empty" ? (
                <span className="text-sm text-muted-foreground">
                  {t("No data yet")}
                </span>
              ) : (
                <SharingState granted={false} label={t("Locked")} />
              )}
            </div>
          </div>
        ) : (
          <SocialCallout title={t("Friends currently see nothing")}>
            {t(
              "All sharing locks are closed, or there is no academic year to share yet."
            )}
          </SocialCallout>
        )}
      </SocialSection>
    </div>
  )
}
