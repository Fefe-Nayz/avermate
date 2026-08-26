"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  Link2OffIcon,
  RefreshCwIcon,
  ScrollTextIcon,
  SparklesIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import {
  ChangeSummary,
  PresetCard,
  PresetStatePanel,
  VersionBadge,
  type PresetLinkState,
} from "@/components/presets/preset-ui"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogMedia,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc, rpc } from "@/lib/orpc"
import { invalidateAnnouncementAudience } from "@/lib/announcement-cache"

/**
 * Whether this year still follows an official curriculum.
 *
 * The page answers one question — *is anything about to change under me* — and
 * the previous version buried it. Its status colours were hardcoded emerald
 * and amber, so the screen whose whole job is reassurance ignored the palette
 * the reader chose; and it printed a fixed grid of six counters that read all
 * zeros whenever nothing had changed, which is most of the time.
 *
 * Now: the state first, in the theme's own colours, carrying only the counts
 * that are not zero. Choosing a preset comes second, because it is the rarer
 * act.
 */
export function PresetMembershipClient() {
  const t = useExtracted()
  const { yearId } = useYear()
  const queryClient = useQueryClient()
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<"detach" | "reapply" | null>(
    null
  )
  const status = useQuery(
    orpc.presets.status.queryOptions({ input: { yearId: yearId ?? "" } })
  )
  const presets = useQuery(orpc.presets.list.queryOptions())
  const preview = useQuery({
    ...orpc.presets.previewApply.queryOptions({
      input: {
        yearId: yearId ?? "",
        presetId: selectedPresetId ?? "",
      },
    }),
    enabled: Boolean(yearId && selectedPresetId),
  })

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.presets.status.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      }),
      queryClient.invalidateQueries({ queryKey: orpc.years.list.key() }),
      invalidateAnnouncementAudience(queryClient),
    ])
  }
  const synchronize = useMutation({
    ...orpc.presets.synchronize.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Preset updated."))
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const detach = useMutation({
    ...orpc.presets.detach.mutationOptions(),
    onSuccess: async () => {
      haptic("warning")
      toast.success(t("This year is now customized."))
      setConfirming(null)
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })
  const apply = useMutation({
    mutationFn: async () => {
      if (!yearId || !selectedPresetId || !preview.data) return
      if (
        preview.data.existing.subjects === 0 &&
        preview.data.existing.averages === 0
      ) {
        return rpc.presets.apply({
          yearId,
          presetId: selectedPresetId,
          replaceExisting: false,
        })
      }
      return rpc.presets.reapply({
        yearId,
        presetId: selectedPresetId,
        acknowledgeReplacement: true,
      })
    },
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Preset applied."))
      setConfirming(null)
      setSelectedPresetId(null)
      await refresh()
    },
    onError: (error: Error) => toast.error(error.message),
  })

  const data = status.data
  const linked = data?.state !== "none" && data?.preset ? data.preset : null
  // "none" is a state, not the absence of one. Rendering nothing for it left
  // the page silent for exactly the years that have not chosen anything yet.
  const state: PresetLinkState | null = data ? data.state : null

  const stateCopy: Record<PresetLinkState, { title: string; body: string }> = {
    none: {
      title: t("This year follows no preset"),
      body: t(
        "Its subjects are entirely your own. Linking one brings a ready-made structure and keeps it updated."
      ),
    },
    current: {
      title: t("Up to date"),
      body: t("Nothing will change unless you choose to change it."),
    },
    update_available: {
      title: t("An update is ready"),
      body: t("Read what it does below, then apply it when you want to."),
    },
    customized: {
      title: t("This year is yours"),
      body: t(
        "Your subjects and averages differ from the preset. Official updates will never overwrite them."
      ),
    },
    action_required: {
      title: t("This update needs a decision"),
      body: t(
        "It removes subjects that already hold grades, so nothing has been changed."
      ),
    },
  }

  const replacing =
    (preview.data?.existing.subjects ?? 0) > 0 ||
    (preview.data?.existing.averages ?? 0) > 0

  return (
    <>
      <PageMeta title={t("Year preset")} backHref="/more" />
      <div className="flex flex-col gap-4">
        <div className="hidden md:block">
          <h1 className="flex items-center gap-2.5 text-2xl font-semibold tracking-tight">
            <ScrollTextIcon className="size-5 text-muted-foreground" />
            {t("Year preset")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Keep the official curriculum linked, or make this year completely yours."
            )}
          </p>
        </div>

        {status.isPending ? (
          <div className="flex justify-center py-12">
            <Spinner className="size-5 text-muted-foreground" />
          </div>
        ) : null}

        {state ? (
          <PresetStatePanel
            state={state}
            title={stateCopy[state].title}
            description={stateCopy[state].body}
            badge={
              linked ? (
                <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                  {linked.name}
                  <VersionBadge
                    version={data?.membership?.appliedVersion ?? ""}
                  />
                </span>
              ) : null
            }
            actions={
              <>
                {data?.state === "update_available" ? (
                  <Button
                    size="sm"
                    disabled={synchronize.isPending}
                    onClick={() =>
                      synchronize.mutate({ yearId: yearId as string })
                    }
                  >
                    {synchronize.isPending ? (
                      <Spinner className="size-4" />
                    ) : (
                      <RefreshCwIcon className="size-4" />
                    )}
                    {t("Update to version {version}", {
                      version: String(data.preset?.currentVersion ?? ""),
                    })}
                  </Button>
                ) : null}
                {data?.state !== "customized" && data?.state !== "none" ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setConfirming("detach")}
                  >
                    <Link2OffIcon className="size-4" />
                    {t("Customize this year")}
                  </Button>
                ) : null}
              </>
            }
          >
            {data?.changes ? (
              <ChangeSummary
                emptyLabel={t("This update changes nothing in your year.")}
                counts={[
                  {
                    label: t("subjects"),
                    value: data.changes.subjectsAdded,
                    kind: "add",
                  },
                  {
                    label: t("subjects changed"),
                    value: data.changes.subjectsChanged,
                    kind: "edit",
                  },
                  {
                    label: t("subjects"),
                    value: data.changes.subjectsRemoved,
                    kind: "remove",
                  },
                  {
                    label: t("averages"),
                    value: data.changes.averagesAdded,
                    kind: "add",
                  },
                  {
                    label: t("averages changed"),
                    value: data.changes.averagesChanged,
                    kind: "edit",
                  },
                  {
                    label: t("averages"),
                    value: data.changes.averagesRemoved,
                    kind: "remove",
                  },
                  {
                    label: t("assessment types"),
                    value: data.changes.gradeTypesAdded,
                    kind: "add",
                  },
                  {
                    label: t("assessment types changed"),
                    value: data.changes.gradeTypesChanged,
                    kind: "edit",
                  },
                  {
                    label: t("assessment types"),
                    value: data.changes.gradeTypesRemoved,
                    kind: "remove",
                  },
                ]}
              />
            ) : null}

            {data?.blockers.length ? (
              <ul className="mt-3 flex flex-col gap-1 rounded-lg border border-destructive/25 bg-background/60 px-3 py-2 text-sm">
                {data.blockers.map((blocker) => (
                  <li key={blocker.subjectId}>
                    {t("{name}: {count} grades would be affected", {
                      name: blocker.subjectName,
                      count: String(blocker.gradeCount),
                    })}
                  </li>
                ))}
              </ul>
            ) : null}
          </PresetStatePanel>
        ) : null}

        <SettingsSection
          id="year-template"
          icon={SparklesIcon}
          title={linked ? t("Switch to another preset") : t("Choose a preset")}
          description={t(
            "A preset brings subjects, coefficients, hierarchy and useful custom averages."
          )}
          footer={
            selectedPresetId && preview.data ? (
              <div className="flex w-full flex-wrap items-center gap-3">
                <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                  {replacing
                    ? t(
                        "This replaces {subjects} current subjects and {averages} current averages.",
                        {
                          subjects: String(preview.data.existing.subjects),
                          averages: String(preview.data.existing.averages),
                        }
                      )
                    : t("This year is empty, so nothing can be lost.")}
                </p>
                <Button
                  size="sm"
                  disabled={!preview.data.canReplace || apply.isPending}
                  onClick={() =>
                    replacing ? setConfirming("reapply") : apply.mutate()
                  }
                >
                  {apply.isPending ? (
                    <Spinner className="size-4" />
                  ) : (
                    <SparklesIcon className="size-4" />
                  )}
                  {linked ? t("Reapply preset") : t("Apply preset")}
                </Button>
              </div>
            ) : undefined
          }
        >
          {presets.isPending ? (
            <div className="flex justify-center py-8">
              <Spinner className="size-5 text-muted-foreground" />
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-2 @xl/main:grid-cols-2">
              {presets.data?.map((preset) => (
                <PresetCard
                  key={preset.id}
                  name={preset.name}
                  description={preset.description}
                  version={preset.version}
                  subjectCount={preset.subjectCount}
                  averageCount={preset.averageCount}
                  featured={preset.featured}
                  tags={preset.tags}
                  selected={selectedPresetId === preset.id}
                  onSelect={() =>
                    setSelectedPresetId((current) =>
                      current === preset.id ? null : preset.id
                    )
                  }
                />
              ))}
            </div>
          )}

          {selectedPresetId && preview.data && !preview.data.canReplace ? (
            <p className="flex items-start gap-2 rounded-lg border border-destructive/25 bg-destructive/5 px-3 py-2 text-xs leading-relaxed text-destructive">
              <AlertTriangleIcon className="mt-px size-3.5 shrink-0" />
              {t(
                "This year contains {count} grades. Avermate will not replace subjects that carry student data.",
                { count: String(preview.data.gradeCount) }
              )}
            </p>
          ) : null}
        </SettingsSection>
      </div>

      <AlertDialog
        open={Boolean(confirming)}
        onOpenChange={(open) => !open && setConfirming(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia>
              {confirming === "detach" ? (
                <Link2OffIcon />
              ) : (
                <AlertTriangleIcon />
              )}
            </AlertDialogMedia>
            <AlertDialogTitle>
              {confirming === "detach"
                ? t("Customize this year?")
                : t("Replace this configuration?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirming === "detach"
                ? t(
                    "Nothing is deleted. This year simply stops receiving official preset updates until you explicitly reapply one."
                  )
                : t(
                    "This replaces {subjects} subjects and {averages} averages. The operation is blocked if any grade could be deleted.",
                    {
                      subjects: String(preview.data?.existing.subjects ?? 0),
                      averages: String(preview.data?.existing.averages ?? 0),
                    }
                  )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant={confirming === "reapply" ? "destructive" : "default"}
              disabled={detach.isPending || apply.isPending}
              onClick={() =>
                confirming === "detach"
                  ? detach.mutate({ yearId: yearId as string })
                  : apply.mutate()
              }
            >
              {confirming === "detach" ? t("Customize") : t("Replace and link")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
