"use client"

import Link from "next/link"
import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { SubjectGraph } from "@avermate/core"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  BookMarkedIcon,
  CheckIcon,
  FolderIcon,
  GraduationCapIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SigmaIcon,
  SparklesIcon,
  StarIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { PeriodDraftEditor } from "@/components/year/period-draft-editor"
import { PresetCard, PresetStatePanel } from "@/components/presets/preset-ui"
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
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { invalidateAnnouncementAudience } from "@/lib/announcement-cache"
import { orpc, rpc } from "@/lib/orpc"
import {
  dateInputValue,
  periodDraftProblems,
  periodDraftsFromRows,
  type PeriodDraft,
} from "@/lib/period-drafts"
import {
  ACTIVE_YEAR_STORAGE_KEY,
  writeActiveYearCookie,
} from "@/lib/year-selection"
import { cn } from "@/lib/utils"

type ConfigurationStep = "subjects" | "periods"

function configurationHref(yearId: string, step: ConfigurationStep): string {
  return `/onboarding/year/${encodeURIComponent(yearId)}?step=${step}`
}

function formHref(path: string, returnTo: string): string {
  return `${path}${path.includes("?") ? "&" : "?"}returnTo=${encodeURIComponent(returnTo)}`
}

export function YearConfigurationWizard({
  yearId,
  initialStep,
}: {
  yearId: string
  initialStep: ConfigurationStep
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [step, setStep] = useState<ConfigurationStep>(initialStep)

  const status = useQuery(
    orpc.years.configurationStatus.queryOptions({ input: { yearId } })
  )
  const snapshot = useQuery(
    orpc.snapshot.get.queryOptions({ input: { yearId } })
  )
  const presets = useQuery(orpc.presets.list.queryOptions())
  const presetStatus = useQuery(
    orpc.presets.status.queryOptions({ input: { yearId } })
  )
  const periodTemplates = useQuery(orpc.presets.periodTemplates.queryOptions())

  useEffect(() => {
    writeActiveYearCookie(yearId)
    localStorage.setItem(ACTIVE_YEAR_STORAGE_KEY, JSON.stringify(yearId))
  }, [yearId])

  const goTo = (next: ConfigurationStep) => {
    haptic("light")
    setStep(next)
    router.replace(configurationHref(yearId, next), { scroll: false })
  }

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({ input: { yearId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.years.configurationStatus.queryKey({
          input: { yearId },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.presets.status.queryKey({ input: { yearId } }),
      }),
      invalidateAnnouncementAudience(queryClient),
    ])
  }

  const finish = () => {
    writeActiveYearCookie(yearId)
    localStorage.setItem(ACTIVE_YEAR_STORAGE_KEY, JSON.stringify(yearId))
    haptic("success")
    toast.success(t("Year ready."))
    router.replace("/dashboard")
  }

  if (!status.data || !snapshot.data) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-5 text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="pt-safe mx-auto flex min-h-svh w-full max-w-3xl flex-col pr-[max(1rem,var(--spacing-safe-right))] pb-[max(2rem,var(--spacing-safe-bottom))] pl-[max(1rem,var(--spacing-safe-left))]">
      <header className="flex min-h-14 items-center gap-3 border-b py-2">
        <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCapIcon className="size-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">
            {status.data.year.name}
          </p>
          <p className="text-xs text-muted-foreground">
            {t("Configure school year")}
          </p>
        </div>
        <div
          className="flex items-center gap-1"
          aria-label={t("Setup progress")}
        >
          {(["subjects", "periods"] as const).map((item, index) => (
            <button
              key={item}
              type="button"
              onClick={() => goTo(item)}
              aria-current={step === item ? "step" : undefined}
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors",
                step === item
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              )}
            >
              <span className="numeric">{index + 1}</span>
              <span className="hidden sm:inline">
                {item === "subjects" ? t("Subjects") : t("Periods")}
              </span>
            </button>
          ))}
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 py-6">
        {step === "subjects" ? (
          <SubjectsConfigurationStep
            yearId={yearId}
            graph={new SubjectGraph(snapshot.data.subjects)}
            customAverages={snapshot.data.customAverages}
            presets={presets.data ?? []}
            presetStatus={presetStatus.data}
            onChanged={invalidate}
            onNext={() => goTo("periods")}
            returnTo={configurationHref(yearId, "subjects")}
          />
        ) : (
          <PeriodsConfigurationStep
            yearId={yearId}
            year={{
              startsAt: dateInputValue(status.data.year.startsAt),
              endsAt: dateInputValue(status.data.year.endsAt),
            }}
            periods={snapshot.data.periods}
            templates={periodTemplates.data ?? []}
            onChanged={invalidate}
            onBack={() => goTo("subjects")}
            onFinish={finish}
          />
        )}
      </main>
    </div>
  )
}

function SubjectsConfigurationStep({
  yearId,
  graph,
  customAverages,
  presets,
  presetStatus,
  onChanged,
  onNext,
  returnTo,
}: {
  yearId: string
  graph: SubjectGraph
  customAverages: ReadonlyArray<{
    id: string
    name: string
    isMain: boolean
    entries: ReadonlyArray<unknown>
  }>
  presets: ReadonlyArray<{
    id: string
    name: string
    description: string
    tags: string[]
    featured: boolean
    version: number
    subjectCount: number
    averageCount: number
  }>
  presetStatus:
    | {
        state:
          | "none"
          | "current"
          | "update_available"
          | "customized"
          | "action_required"
        preset: { name: string } | null
        membership: { appliedVersion: number } | null
      }
    | undefined
  onChanged: () => Promise<void>
  onNext: () => void
  returnTo: string
}) {
  const t = useExtracted()
  const [showPresets, setShowPresets] = useState(graph.flatten().length === 0)
  const [query, setQuery] = useState("")
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const visiblePresets = useMemo(() => {
    const search = query.trim().toLocaleLowerCase()
    return presets.filter(
      (preset) =>
        !search ||
        preset.name.toLocaleLowerCase().includes(search) ||
        preset.description.toLocaleLowerCase().includes(search) ||
        preset.tags.some((tag) => tag.toLocaleLowerCase().includes(search))
    )
  }, [presets, query])

  const preview = useQuery({
    ...orpc.presets.previewApply.queryOptions({
      input: { yearId, presetId: selectedPresetId ?? "" },
    }),
    enabled: Boolean(selectedPresetId),
  })

  const apply = useMutation({
    mutationFn: async () => {
      if (!selectedPresetId || !preview.data) return
      const empty =
        preview.data.existing.subjects === 0 &&
        preview.data.existing.averages === 0
      return empty
        ? rpc.presets.apply({
            yearId,
            presetId: selectedPresetId,
            replaceExisting: false,
          })
        : rpc.presets.reapply({
            yearId,
            presetId: selectedPresetId,
            acknowledgeReplacement: true,
          })
    },
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Preset applied."))
      setConfirmReplace(false)
      setShowPresets(false)
      setSelectedPresetId(null)
      await onChanged()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The preset could not be applied."))
    },
  })

  const selectedPreview = preview.data
  const replacing = Boolean(
    selectedPreview &&
    (selectedPreview.existing.subjects > 0 ||
      selectedPreview.existing.averages > 0)
  )
  const rows = graph.flatten()

  const requestApply = () => {
    if (!selectedPreview) return
    if (replacing) setConfirmReplace(true)
    else apply.mutate()
  }

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Set up your subjects")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Use a curriculum as a starting point, then make the hierarchy and weights yours."
          )}
        </p>
      </div>

      {presetStatus ? (
        <PresetStatePanel
          state={presetStatus.state}
          title={
            presetStatus.state === "current"
              ? t("Preset up to date")
              : presetStatus.state === "customized"
                ? t("Customized year")
                : presetStatus.state === "update_available"
                  ? t("Preset update available")
                  : presetStatus.state === "action_required"
                    ? t("Preset needs your decision")
                    : t("No linked preset")
          }
          description={
            presetStatus.preset
              ? t("{name} is the starting point for this year.", {
                  name: presetStatus.preset.name,
                })
              : t("Choose a preset below, or build the subject tree yourself.")
          }
          actions={
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setShowPresets((current) => !current)}
            >
              <SparklesIcon className="size-4" />
              {showPresets ? t("Hide presets") : t("Choose a preset")}
            </Button>
          }
        />
      ) : null}

      {showPresets ? (
        <section className="flex flex-col gap-3 rounded-xl border bg-muted/20 p-4">
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("Search presets…")}
              className="pl-9"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {visiblePresets.map((preset) => (
              <PresetCard
                key={preset.id}
                {...preset}
                selected={selectedPresetId === preset.id}
                onSelect={() => setSelectedPresetId(preset.id)}
              />
            ))}
          </div>
          {visiblePresets.length === 0 ? (
            <p className="py-5 text-center text-sm text-muted-foreground">
              {t("No preset matches this search.")}
            </p>
          ) : null}
          {selectedPresetId && selectedPreview ? (
            <div className="flex flex-col gap-2 rounded-xl border bg-card p-3 sm:flex-row sm:items-center">
              <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                {replacing
                  ? t(
                      "This would replace {subjects} subjects and {averages} custom averages.",
                      {
                        subjects: String(selectedPreview.existing.subjects),
                        averages: String(selectedPreview.existing.averages),
                      }
                    )
                  : t(
                      "This year is empty, so the preset can be linked safely."
                    )}
              </p>
              <Button
                type="button"
                size="sm"
                disabled={!selectedPreview.canReplace || apply.isPending}
                onClick={requestApply}
              >
                {apply.isPending ? <Spinner className="size-4" /> : null}
                {replacing ? t("Review replacement") : t("Apply preset")}
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="mr-auto font-semibold">{t("Subject tree")}</h2>
          <Button
            size="sm"
            variant="outline"
            render={
              <Link href={formHref("/subjects/new?kind=category", returnTo)} />
            }
          >
            <FolderIcon className="size-4" />
            {t("Add category")}
          </Button>
          <Button
            size="sm"
            render={<Link href={formHref("/subjects/new", returnTo)} />}
          >
            <PlusIcon className="size-4" />
            {t("Add subject")}
          </Button>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-xl border border-dashed p-8 text-center">
            <BookMarkedIcon className="mx-auto size-6 text-muted-foreground" />
            <p className="mt-3 text-sm font-medium">{t("No subjects yet")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("Choose a preset above or add the first subject manually.")}
            </p>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-xl border bg-card">
            {rows.map((subject, index) => {
              const depth = graph.depthOf(subject.id)
              return (
                <li
                  key={subject.id}
                  className={cn(
                    "flex min-h-14 items-center gap-2 px-3 py-2",
                    index > 0 && "border-t",
                    subject.kind === "category" && "bg-muted/35"
                  )}
                  style={{ paddingInlineStart: `${0.75 + depth * 1.1}rem` }}
                >
                  {subject.kind === "category" ? (
                    <FolderIcon className="size-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <BookMarkedIcon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                      {subject.name}
                      {subject.isMain ? (
                        <StarIcon className="size-3.5 shrink-0 text-primary" />
                      ) : null}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {subject.kind === "category"
                        ? t("Category")
                        : t("Weight {coefficient} · {grades} grades", {
                            coefficient: String(subject.coefficient),
                            grades: String(subject.grades.length),
                          })}
                    </p>
                  </div>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("Add a child to {name}", {
                      name: subject.name,
                    })}
                    render={
                      <Link
                        href={formHref(
                          `/subjects/new?parent=${encodeURIComponent(subject.id)}`,
                          returnTo
                        )}
                      />
                    }
                  >
                    <PlusIcon className="size-4" />
                  </Button>
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("Edit {name}", { name: subject.name })}
                    render={
                      <Link
                        href={formHref(
                          `/subjects/${encodeURIComponent(subject.id)}/edit`,
                          returnTo
                        )}
                      />
                    }
                  >
                    <PencilIcon className="size-4" />
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div className="mr-auto">
            <h2 className="font-semibold">{t("Custom averages")}</h2>
            <p className="text-xs text-muted-foreground">
              {t("Preset averages and your own combinations are visible here.")}
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={rows.length === 0}
            render={
              <Link href={formHref("/settings/averages/new", returnTo)} />
            }
          >
            <PlusIcon className="size-4" />
            {t("New average")}
          </Button>
        </div>
        {customAverages.length === 0 ? (
          <p className="rounded-xl border border-dashed p-5 text-sm text-muted-foreground">
            {t("No custom averages for this year.")}
          </p>
        ) : (
          <ul className="overflow-hidden rounded-xl border bg-card">
            {customAverages.map((average, index) => (
              <li key={average.id} className={cn(index > 0 && "border-t")}>
                <Link
                  href={formHref(
                    `/settings/averages/${encodeURIComponent(average.id)}`,
                    returnTo
                  )}
                  className="flex min-h-14 items-center gap-3 px-3 py-2 hover:bg-accent/60"
                >
                  <SigmaIcon className="size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {average.name}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t("{count} subjects", {
                      count: String(average.entries.length),
                    })}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="mt-auto flex gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={() => history.back()}>
          <ArrowLeftIcon className="size-4" />
          {t("Cancel")}
        </Button>
        <Button type="button" className="ml-auto" onClick={onNext}>
          {t("Continue to periods")}
          <ArrowRightIcon className="size-4" />
        </Button>
      </div>

      <AlertDialog open={confirmReplace} onOpenChange={setConfirmReplace}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogMedia className="bg-caution/10 text-caution">
              <SparklesIcon />
            </AlertDialogMedia>
            <AlertDialogTitle>
              {t("Replace this configuration?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {selectedPreview
                ? t(
                    "This replaces {subjects} subjects and {averages} custom averages. Avermate blocks the operation if a grade, goal or dashboard card would lose its target.",
                    {
                      subjects: String(selectedPreview.existing.subjects),
                      averages: String(selectedPreview.existing.averages),
                    }
                  )
                : t("Review the replacement before continuing.")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={!selectedPreview?.canReplace || apply.isPending}
              onClick={() => apply.mutate()}
            >
              {apply.isPending ? <Spinner className="size-4" /> : null}
              {t("Replace and link")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function PeriodsConfigurationStep({
  yearId,
  year,
  periods,
  templates,
  onChanged,
  onBack,
  onFinish,
}: {
  yearId: string
  year: { startsAt: string; endsAt: string }
  periods: ReadonlyArray<{
    id: string
    name: string
    startAt: Date
    endAt: Date
    isCumulative: boolean
  }>
  templates: ReadonlyArray<{
    id: string
    periods: ReadonlyArray<{
      key: string
      from: number
      to: number
      isCumulative?: boolean
    }>
  }>
  onChanged: () => Promise<void>
  onBack: () => void
  onFinish: () => void
}) {
  const t = useExtracted()
  const [source, setSource] = useState(periods)
  const [drafts, setDrafts] = useState<PeriodDraft[]>(() =>
    periodDraftsFromRows(periods)
  )

  if (source !== periods) {
    setSource(periods)
    setDrafts(periodDraftsFromRows(periods))
  }

  const problems = periodDraftProblems(drafts, year)
  const save = useMutation({
    ...orpc.periods.replaceAll.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      await onChanged()
      onFinish()
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The periods could not be saved."))
    },
  })

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Set exact periods")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "A template is only a starting point. Check the real dates and cumulative rules before finishing."
          )}
        </p>
      </div>

      <PeriodDraftEditor
        value={drafts}
        onChange={setDrafts}
        year={year}
        templates={templates}
      />

      <div className="mt-auto flex gap-2 border-t pt-4">
        <Button type="button" variant="outline" onClick={onBack}>
          <ArrowLeftIcon className="size-4" />
          {t("Subjects")}
        </Button>
        <Button
          type="button"
          className="ml-auto"
          disabled={save.isPending || problems.length > 0}
          onClick={() =>
            save.mutate({
              yearId,
              periods: drafts.map((draft) => ({
                periodId: draft.id,
                name: draft.name.trim(),
                startAt: new Date(`${draft.startAt}T00:00:00`),
                endAt: new Date(`${draft.endAt}T23:59:59`),
                isCumulative: draft.isCumulative,
              })),
            })
          }
        >
          {save.isPending ? (
            <Spinner className="size-4" />
          ) : (
            <CheckIcon className="size-4" />
          )}
          {t("Save and finish")}
        </Button>
      </div>
    </>
  )
}
