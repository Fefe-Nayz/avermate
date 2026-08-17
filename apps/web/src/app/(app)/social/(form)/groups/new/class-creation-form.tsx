"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  BookOpenIcon,
  CalendarRangeIcon,
  CheckIcon,
  LayersIcon,
  WrenchIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { suggestSchoolYear } from "@avermate/core"
import {
  PresetVisualEditor,
  type PresetEditorConfiguration,
  type PresetEditorSubject,
} from "@/components/admin/preset-visual-editor"
import {
  ChoiceField,
  DateField,
  NumberField,
  TextField,
} from "@/components/forms/controls"
import { FormFlow, type FlowStep } from "@/components/forms/form-flow"
import { PickerField, type PickerOption } from "@/components/forms/picker"
import { PresetCard } from "@/components/presets/preset-ui"
import { SocialCallout } from "@/components/social/social-ui"
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { Textarea } from "@/components/ui/textarea"
import { PeriodDraftEditor } from "@/components/year/period-draft-editor"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  periodDraftProblems,
  periodDraftsFromTemplate,
  type PeriodDraft,
} from "@/lib/period-drafts"
import { cn } from "@/lib/utils"
import { randomId } from "@/lib/id"

type SourceMode = "year" | "builder"
type PeriodTemplate =
  "trimesters" | "semesters" | "semesters-cumulative" | "quarters" | "none"
type PeriodMode = PeriodTemplate | "custom"

function emptyConfiguration(subjectName: string): PresetEditorConfiguration {
  return {
    subjects: [
      {
        key: `subject:${randomId().replaceAll("-", "")}`,
        name: subjectName,
        kind: "subject",
        isMain: true,
        coefficient: 1,
        children: [],
      },
    ],
    averages: [],
  }
}

function everySubject(
  subjects: readonly PresetEditorSubject[],
  predicate: (subject: PresetEditorSubject) => boolean
): boolean {
  return subjects.every(
    (subject) => predicate(subject) && everySubject(subject.children, predicate)
  )
}

function modelIsValid(configuration: PresetEditorConfiguration): boolean {
  return (
    configuration.subjects.length > 0 &&
    everySubject(configuration.subjects, (subject) =>
      Boolean(subject.name.trim())
    ) &&
    configuration.averages.every(
      (average) => Boolean(average.name.trim()) && average.entries.length > 0
    )
  )
}

function subjectCount(subjects: readonly PresetEditorSubject[]): number {
  return subjects.reduce(
    (count, subject) => count + 1 + subjectCount(subject.children),
    0
  )
}

function periodDraftsAreValid(
  drafts: readonly PeriodDraft[],
  year: { startsAt: string; endsAt: string }
): boolean {
  return (
    drafts.length <= 12 &&
    periodDraftProblems(drafts, year).length === 0 &&
    drafts.every(
      (draft) =>
        draft.name.trim().length <= 64 &&
        draft.startAt.localeCompare(draft.endAt) < 0
    )
  )
}

/** A class is created together with one immutable academic model. */
export function ClassCreationForm() {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const { now, yearId, years } = useYear()
  const suggestion = useMemo(() => suggestSchoolYear(now, years), [now, years])
  const presets = useQuery(orpc.presets.list.queryOptions())
  const periodTemplates = useQuery(orpc.presets.periodTemplates.queryOptions())

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [source, setSource] = useState<SourceMode>(() =>
    years.length ? "year" : "builder"
  )
  const [selectedYearId, setSelectedYearId] = useState(
    () => years.find((year) => year.id === yearId)?.id ?? years[0]?.id ?? ""
  )
  const [yearName, setYearName] = useState(suggestion.name)
  const [startsAt, setStartsAt] = useState(suggestion.startDay)
  const [endsAt, setEndsAt] = useState(suggestion.endDay)
  const [scale, setScale] = useState(String(suggestion.scale))
  const [passingGrade, setPassingGrade] = useState(
    String(suggestion.scale * 0.5)
  )
  const [periodMode, setPeriodMode] = useState<PeriodMode>("trimesters")
  const [periodDrafts, setPeriodDrafts] = useState<PeriodDraft[]>([])
  const [presetId, setPresetId] = useState<string | null>(null)
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null)
  const [configuration, setConfiguration] = useState<PresetEditorConfiguration>(
    () => emptyConfiguration(t("Subject 1"))
  )
  const [errors, setErrors] = useState<Record<string, string>>({})

  const yearOptions: PickerOption[] = years.map((year) => ({
    value: year.id,
    label: year.name,
    hint: year.archivedAt ? t("Archived") : undefined,
    keywords: `${new Date(year.startsAt).getFullYear()} ${new Date(year.endsAt).getFullYear()}`,
  }))
  const selectedYear = years.find((year) => year.id === selectedYearId)
  const numericScale = Number(scale)
  const datesValid =
    Boolean(startsAt) && Boolean(endsAt) && startsAt.localeCompare(endsAt) < 0
  const scaleValid =
    Number.isFinite(numericScale) && numericScale > 0 && numericScale <= 1000
  const numericPassingGrade = Number(passingGrade)
  const passingGradeValid =
    scaleValid &&
    Number.isFinite(numericPassingGrade) &&
    numericPassingGrade >= 0 &&
    numericPassingGrade <= numericScale

  const periodNames: Record<PeriodTemplate, string[]> = {
    trimesters: [t("Term 1"), t("Term 2"), t("Term 3")],
    semesters: [t("Semester 1"), t("Semester 2")],
    "semesters-cumulative": [t("Semester 1"), t("Full year")],
    quarters: [t("Quarter 1"), t("Quarter 2"), t("Quarter 3"), t("Quarter 4")],
    none: [],
  }
  const periodsValid =
    periodMode !== "custom" ||
    periodDraftsAreValid(periodDrafts, { startsAt, endsAt })

  const choosePeriodMode = (nextMode: PeriodMode) => {
    if (nextMode === "custom" && periodMode !== "custom") {
      const template = periodTemplates.data?.find(
        (candidate) => candidate.id === periodMode
      )
      setPeriodDrafts(
        template
          ? periodDraftsFromTemplate({
              template,
              startsAt,
              endsAt,
              names: periodNames[periodMode],
            })
          : []
      )
    }
    setPeriodMode(nextMode)
  }

  const choosePreset = async (nextPresetId: string | null) => {
    if (!nextPresetId) {
      setPresetId(null)
      setConfiguration(emptyConfiguration(t("Subject 1")))
      return
    }

    setLoadingPresetId(nextPresetId)
    try {
      const preset = await queryClient.fetchQuery(
        orpc.presets.get.queryOptions({ input: { presetId: nextPresetId } })
      )
      setPresetId(nextPresetId)
      setConfiguration(structuredClone(preset.configuration))
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : t("The preset could not be loaded.")
      )
    } finally {
      setLoadingPresetId(null)
    }
  }

  const create = useMutation({
    ...orpc.social.groups.create.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success")
      toast.success(t("Class created."))
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.list.key(),
        }),
        queryClient.invalidateQueries({ queryKey: orpc.years.list.key() }),
      ])
      router.push(`/social/groups/${result.id}`)
    },
    onError: (error) => {
      haptic("error")
      toast.error(error.message || t("The class could not be created."))
    },
  })

  const submit = () => {
    const next: Record<string, string> = {}
    if (name.trim().length < 2) {
      next.name = t("Give the class a name with at least two characters.")
    }
    if (source === "year" && !selectedYearId) {
      next.year = t("Choose one of your years.")
    }
    if (source === "builder") {
      if (!yearName.trim()) next.yearName = t("Give the class year a name.")
      if (!datesValid)
        next.dates = t("The end date must be after the start date.")
      if (!scaleValid) next.scale = t("Enter a valid grading scale.")
      if (!passingGradeValid) {
        next.passingGrade = t("Enter a passing grade within the grading scale.")
      }
      if (periodMode === "custom" && !periodsValid) {
        next.periods = t("Fix the period names and dates before continuing.")
      }
      if (!modelIsValid(configuration)) {
        next.model = t(
          "Add at least one named subject, and complete every custom average."
        )
      }
    }
    setErrors(next)
    if (Object.keys(next).length) {
      haptic("warning")
      return
    }

    create.mutate({
      name: name.trim(),
      description: description.trim(),
      template:
        source === "year"
          ? { mode: "year", yearId: selectedYearId }
          : {
              mode: "builder",
              year: {
                name: yearName.trim(),
                startsAt: new Date(`${startsAt}T00:00:00`),
                endsAt: new Date(`${endsAt}T00:00:00`),
                scale: numericScale,
                defaultOutOf: numericScale,
                passingRatio: numericPassingGrade / numericScale,
                decimals: 2,
              },
              presetId,
              configuration,
              periods:
                periodMode === "custom"
                  ? {
                      mode: "custom",
                      items: periodDrafts.map((draft) => ({
                        name: draft.name.trim(),
                        startsAt: new Date(`${draft.startAt}T00:00:00`),
                        endsAt: new Date(`${draft.endAt}T00:00:00`),
                        isCumulative: draft.isCumulative,
                      })),
                    }
                  : {
                      mode: "template",
                      templateId: periodMode,
                      names: periodNames[periodMode],
                    },
            },
    })
  }

  const identityValid = () => {
    const valid = name.trim().length >= 2
    setErrors((current) => ({
      ...current,
      name: valid
        ? ""
        : t("Give the class a name with at least two characters."),
    }))
    return valid
  }
  const yearSettingsValid = () => {
    const next = {
      yearName: yearName.trim() ? "" : t("Give the class year a name."),
      dates: datesValid ? "" : t("The end date must be after the start date."),
      scale: scaleValid ? "" : t("Enter a valid grading scale."),
      passingGrade: passingGradeValid
        ? ""
        : t("Enter a passing grade within the grading scale."),
    }
    setErrors((current) => ({ ...current, ...next }))
    return !next.yearName && !next.dates && !next.scale && !next.passingGrade
  }
  const modelValid = () => {
    const valid = modelIsValid(configuration)
    setErrors((current) => ({
      ...current,
      model: valid
        ? ""
        : t(
            "Add at least one named subject, and complete every custom average."
          ),
    }))
    return valid
  }
  const periodsStepValid = () => {
    setErrors((current) => ({
      ...current,
      periods: periodsValid
        ? ""
        : t("Fix the period names and dates before continuing."),
    }))
    return periodsValid
  }

  const steps: FlowStep[] = [
    {
      id: "identity",
      title: t("Name the class"),
      description: t("The name classmates will see before joining."),
      summary: name.trim() || null,
      validate: identityValid,
      content: (
        <div className="flex flex-col gap-4">
          <TextField
            label={t("Class name")}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            maxLength={100}
            required
            autoFocus
          />
          <Field>
            <FieldLabel htmlFor="new-class-description">
              {t("Description (optional)")}
            </FieldLabel>
            <Textarea
              id="new-class-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              maxLength={500}
              rows={3}
            />
            <FieldDescription>
              {t("A short description of this class.")}
            </FieldDescription>
          </Field>
        </div>
      ),
    },
    {
      id: "source",
      title: t("Choose the class model"),
      description: t(
        "Every member uses the same subjects, periods and grading scale."
      ),
      summary:
        source === "year"
          ? t("Use one of my years")
          : t("Build the class model"),
      content: (
        <ChoiceField
          value={source}
          onValueChange={setSource}
          choices={[
            {
              value: "year",
              label: t("Use one of my years"),
              description: t(
                "Use its structure as-is. Its grades are never shared."
              ),
              icon: <CalendarRangeIcon className="size-4" />,
              disabled: years.length === 0,
            },
            {
              value: "builder",
              label: t("Build the class model"),
              description: t(
                "Start from a curated preset or configure the structure yourself."
              ),
              icon: <WrenchIcon className="size-4" />,
            },
          ]}
        />
      ),
    },
    {
      id: "existing-year",
      title: t("Choose the model year"),
      description: t(
        "The class copies its structure without changing the year or exposing grades."
      ),
      summary: selectedYear?.name ?? null,
      when: source === "year",
      validate: () => Boolean(selectedYearId),
      content: yearOptions.length ? (
        <PickerField
          label={t("My years")}
          options={yearOptions}
          value={selectedYearId}
          onValueChange={setSelectedYearId}
          layout="page"
          searchable={false}
          error={errors.year}
          required
        />
      ) : (
        <SocialCallout tone="caution" title={t("No year available")}>
          {t("Build a class model instead.")}
        </SocialCallout>
      ),
    },
    {
      id: "year-settings",
      title: t("Set up the class year"),
      description: t(
        "This creates a separate empty year for you and the model classmates can copy."
      ),
      summary: yearName.trim() || null,
      when: source === "builder",
      validate: yearSettingsValid,
      content: (
        <div className="flex flex-col gap-4">
          <TextField
            label={t("Year name")}
            value={yearName}
            onChange={(event) => setYearName(event.target.value)}
            error={errors.yearName}
            maxLength={64}
            required
          />
          <div className="grid grid-cols-2 gap-3">
            <DateField
              label={t("Starts")}
              value={startsAt}
              onValueChange={setStartsAt}
              error={errors.dates}
              required
            />
            <DateField
              label={t("Ends")}
              value={endsAt}
              onValueChange={setEndsAt}
              error={errors.dates}
              required
            />
          </div>
          <NumberField
            label={t("Grades are out of")}
            description={t("20 in France, 100 elsewhere, 4 for a GPA.")}
            value={scale}
            onValueChange={setScale}
            error={errors.scale}
            min={1}
            max={1000}
            required
          />
          <NumberField
            label={t("Passing grade")}
            description={t("The minimum result counted as a pass.")}
            value={passingGrade}
            onValueChange={setPassingGrade}
            error={errors.passingGrade}
            min={0}
            max={scaleValid ? numericScale : 1000}
            required
          />
          <ChoiceField
            label={t("Periods")}
            value={periodMode}
            onValueChange={choosePeriodMode}
            choices={[
              {
                value: "trimesters",
                label: t("Three terms"),
                icon: <CalendarRangeIcon className="size-4" />,
              },
              {
                value: "semesters",
                label: t("Two semesters"),
                icon: <CalendarRangeIcon className="size-4" />,
              },
              {
                value: "semesters-cumulative",
                label: t("Two semesters, cumulative"),
                icon: <CalendarRangeIcon className="size-4" />,
              },
              {
                value: "quarters",
                label: t("Four quarters"),
                icon: <CalendarRangeIcon className="size-4" />,
              },
              {
                value: "none",
                label: t("No split"),
                icon: <LayersIcon className="size-4" />,
              },
              {
                value: "custom",
                label: t("Custom periods"),
                description: t("Set each period name and date."),
                icon: <WrenchIcon className="size-4" />,
              },
            ]}
          />
        </div>
      ),
    },
    {
      id: "periods",
      title: t("Set the class periods"),
      description: t(
        "Start from a common split, then match the names and dates used by the class."
      ),
      summary: t("{count} periods", { count: String(periodDrafts.length) }),
      when: source === "builder" && periodMode === "custom",
      validate: periodsStepValid,
      content: (
        <div className="flex flex-col gap-3">
          {errors.periods ? <FieldError>{errors.periods}</FieldError> : null}
          <PeriodDraftEditor
            value={periodDrafts}
            onChange={setPeriodDrafts}
            year={{ startsAt, endsAt }}
            templates={[]}
            allowAdd={periodDrafts.length < 12}
          />
        </div>
      ),
    },
    {
      id: "starting-point",
      title: t("Choose a starting point"),
      description: t(
        "The next step always lets you review and adapt the complete model."
      ),
      summary:
        presets.data?.find((preset) => preset.id === presetId)?.name ??
        t("Custom model"),
      when: source === "builder",
      content: (
        <div className="grid gap-2 sm:grid-cols-[repeat(2,minmax(0,1fr))]">
          <button
            type="button"
            aria-pressed={presetId === null}
            onClick={() => void choosePreset(null)}
            className={cn(
              "flex min-w-0 flex-col gap-1.5 rounded-xl border p-4 text-left transition-colors",
              presetId === null
                ? "border-primary bg-primary/6 ring-1 ring-primary/30"
                : "bg-card hover:bg-accent/50"
            )}
          >
            <span className="flex items-center gap-2 font-medium">
              <BookOpenIcon className="size-4 text-muted-foreground" />
              <span className="flex-1">{t("Start custom")}</span>
              {presetId === null ? (
                <CheckIcon className="size-4 text-primary" />
              ) : null}
            </span>
            <span className="text-sm leading-relaxed text-muted-foreground">
              {t("Begin with one subject, then build the class structure.")}
            </span>
          </button>
          {presets.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner />
            </div>
          ) : null}
          {presets.data?.map((preset) => (
            <div key={preset.id} className="relative w-full min-w-0">
              <PresetCard
                {...preset}
                selected={presetId === preset.id}
                onSelect={() => void choosePreset(preset.id)}
              />
              {loadingPresetId === preset.id ? (
                <span className="pointer-events-none absolute top-4 right-12">
                  <Spinner className="size-4" />
                </span>
              ) : null}
            </div>
          ))}
        </div>
      ),
    },
    {
      id: "model",
      title: t("Adapt the class model"),
      description: t(
        "Review every subject, coefficient and custom average before creating the class."
      ),
      summary: t("{subjects} subjects · {averages} averages", {
        subjects: String(subjectCount(configuration.subjects)),
        averages: String(configuration.averages.length),
      }),
      when: source === "builder",
      validate: modelValid,
      content: (
        <div className="flex flex-col gap-3">
          {errors.model ? <FieldError>{errors.model}</FieldError> : null}
          <PresetVisualEditor
            value={configuration}
            onChange={setConfiguration}
            showStableKeys={false}
          />
          <SocialCallout title={t("Sharing stays off")}>
            {t(
              "The new year is linked to the class, but its results remain private until you enable sharing."
            )}
          </SocialCallout>
        </div>
      ),
    },
  ]

  return (
    <FormFlow
      title={t("New class")}
      description={t(
        "Create one shared academic model. Every classmate chooses or creates a compatible year."
      )}
      backHref="/social/groups"
      steps={steps}
      onSubmit={submit}
      submitLabel={t("Create class")}
      submitting={create.isPending}
      disabled={
        source === "year"
          ? !selectedYearId
          : loadingPresetId !== null || !modelIsValid(configuration)
      }
      footerNote={t(
        "Creating a class never shares grades. Class comparisons remain opt-in for every member."
      )}
    />
  )
}
