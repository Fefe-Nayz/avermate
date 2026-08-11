"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  AlertTriangleIcon,
  CheckCircle2Icon,
  Link2OffIcon,
  RefreshCwIcon,
  SparklesIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
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
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc, rpc } from "@/lib/orpc"
import { invalidateAnnouncementAudience } from "@/lib/announcement-cache"
import { cn } from "@/lib/utils"

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
  const linked = data?.state !== "none" && data?.preset
  const stateCopy = {
    current: {
      title: t("Preset up to date"),
      description: t("This year follows version {version} of {name}.", {
        version: String(data?.membership?.appliedVersion ?? ""),
        name: data?.preset?.name ?? "",
      }),
      className: "border-emerald-500/30 bg-emerald-500/8",
      icon: <CheckCircle2Icon className="size-5 text-emerald-600" />,
    },
    update_available: {
      title: t("Preset update available"),
      description: t(
        "Review the changes below, then update when you are ready."
      ),
      className: "border-primary/30 bg-primary/6",
      icon: <RefreshCwIcon className="size-5 text-primary" />,
    },
    customized: {
      title: t("Customized year"),
      description: t(
        "Your subject or average configuration differs from the preset. Official updates will never overwrite it."
      ),
      className: "border-amber-500/30 bg-amber-500/8",
      icon: <Link2OffIcon className="size-5 text-amber-600" />,
    },
    action_required: {
      title: t("Update needs your decision"),
      description: t(
        "The new preset removes subjects that already contain grades, so Avermate has not changed anything."
      ),
      className: "border-destructive/30 bg-destructive/6",
      icon: <AlertTriangleIcon className="size-5 text-destructive" />,
    },
  } as const
  const copy =
    data?.state && data.state !== "none" ? stateCopy[data.state] : null

  return (
    <>
      <PageMeta title={t("Year preset")} backHref="/more" />
      <div className="flex flex-col gap-4">
        <div>
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
            {t("Year preset")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Keep the official curriculum linked, or make this year completely yours."
            )}
          </p>
        </div>

        {copy ? (
          <section className={cn("rounded-xl border p-4", copy.className)}>
            <div className="flex items-start gap-3">
              {copy.icon}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="font-semibold">{copy.title}</h2>
                  {linked ? (
                    <Badge variant="outline">
                      {linked.name} · v{data?.membership?.appliedVersion}
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {copy.description}
                </p>
              </div>
            </div>

            {data?.changes ? (
              <div className="mt-4 grid grid-cols-2 gap-2 text-sm @md/main:grid-cols-3">
                {[
                  [t("Subjects added"), data.changes.subjectsAdded],
                  [t("Subjects changed"), data.changes.subjectsChanged],
                  [t("Subjects removed"), data.changes.subjectsRemoved],
                  [t("Averages added"), data.changes.averagesAdded],
                  [t("Averages changed"), data.changes.averagesChanged],
                  [t("Averages removed"), data.changes.averagesRemoved],
                ].map(([label, value]) => (
                  <div
                    key={String(label)}
                    className="rounded-lg bg-background/70 px-3 py-2"
                  >
                    <span className="numeric block font-semibold">{value}</span>
                    <span className="text-xs text-muted-foreground">
                      {label}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}

            {data?.blockers.length ? (
              <ul className="mt-4 rounded-lg border border-destructive/20 bg-background/70 px-3 py-2 text-sm">
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

            <div className="mt-4 flex flex-wrap gap-2">
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
              {data?.state === "current" ||
              data?.state === "update_available" ||
              data?.state === "action_required" ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setConfirming("detach")}
                >
                  <Link2OffIcon className="size-4" /> {t("Customize this year")}
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        <SettingsSection
          title={linked ? t("Choose another preset") : t("Choose a preset")}
          description={
            data?.state === "customized"
              ? t(
                  "Reapplying replaces the current subject and average configuration only when no grades can be lost."
                )
              : t(
                  "A preset includes subjects, coefficients, hierarchy and useful custom averages."
                )
          }
        >
          <div className="grid gap-2 @xl/main:grid-cols-2">
            {presets.data?.map((preset) => (
              <button
                key={preset.id}
                type="button"
                className={cn(
                  "rounded-xl border p-3 text-left transition-colors",
                  selectedPresetId === preset.id
                    ? "border-primary bg-primary/6 ring-1 ring-primary/30"
                    : "hover:bg-accent/50"
                )}
                onClick={() => setSelectedPresetId(preset.id)}
              >
                <span className="flex items-center gap-2 text-sm font-medium">
                  <SparklesIcon className="size-4 text-primary" />
                  <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                  <Badge variant="secondary">v{preset.version}</Badge>
                </span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {preset.description}
                </span>
                <span className="mt-2 block text-xs text-muted-foreground">
                  {t("{subjects} subjects · {averages} averages", {
                    subjects: String(preset.subjectCount),
                    averages: String(preset.averageCount),
                  })}
                </span>
              </button>
            ))}
          </div>

          {selectedPresetId ? (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              {preview.isLoading ? (
                <Spinner className="size-4" />
              ) : preview.data ? (
                <div className="flex flex-wrap items-center gap-3">
                  <p className="min-w-0 flex-1 text-muted-foreground">
                    {preview.data.existing.subjects > 0 ||
                    preview.data.existing.averages > 0
                      ? t(
                          "This replaces {subjects} current subjects and {averages} current averages with the selected preset.",
                          {
                            subjects: String(preview.data.existing.subjects),
                            averages: String(preview.data.existing.averages),
                          }
                        )
                      : t(
                          "This year is empty, so the preset can be linked safely."
                        )}
                  </p>
                  <Button
                    size="sm"
                    disabled={!preview.data.canReplace || apply.isPending}
                    onClick={() =>
                      preview.data.existing.subjects > 0 ||
                      preview.data.existing.averages > 0
                        ? setConfirming("reapply")
                        : apply.mutate()
                    }
                  >
                    {apply.isPending ? (
                      <Spinner className="size-4" />
                    ) : (
                      <SparklesIcon className="size-4" />
                    )}
                    {linked ? t("Reapply preset") : t("Apply preset")}
                  </Button>
                  {!preview.data.canReplace ? (
                    <p className="w-full text-xs font-medium text-destructive">
                      {t(
                        "This year contains {count} grades. Avermate will not replace subjects that carry student data.",
                        { count: String(preview.data.gradeCount) }
                      )}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
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
