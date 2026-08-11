"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CalendarRangeIcon,
  CheckIcon,
  GraduationCapIcon,
  LayersIcon,
  SparklesIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { ChoiceField, DateField, NumberField, TextField } from "@/components/forms/controls"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  ACTIVE_YEAR_STORAGE_KEY,
  writeActiveYearCookie,
} from "@/lib/year-selection"
import { cn } from "@/lib/utils"

type Step = "year" | "preset" | "periods"
type SetupMode = "first" | "additional"
type PeriodTemplate =
  "trimesters" | "semesters" | "semesters-cumulative" | "quarters" | "none"

function defaultYearRange(initialNow: string) {
  const now = new Date(initialNow)
  const startYear =
    now.getUTCMonth() >= 7 ? now.getUTCFullYear() : now.getUTCFullYear() - 1
  return {
    name: `${startYear}–${startYear + 1}`,
    start: `${startYear}-09-01`,
    end: `${startYear + 1}-07-15`,
  }
}

/** Shared first-run and additional-year setup, without duplicating product rules. */
export function YearSetupWizard({
  initialNow,
  mode,
}: {
  initialNow: string
  mode: SetupMode
}) {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const user = useAuthenticatedUser()
  const defaults = useMemo(() => defaultYearRange(initialNow), [initialNow])

  const [step, setStep] = useState<Step>("year")
  const [name, setName] = useState(defaults.name)
  const [startsAt, setStartsAt] = useState(defaults.start)
  const [endsAt, setEndsAt] = useState(defaults.end)
  const [scale, setScale] = useState("20")
  const [presetId, setPresetId] = useState<string | null>(null)
  const [template, setTemplate] = useState<PeriodTemplate>("trimesters")
  const setupKey = useRef(crypto.randomUUID())

  const yearsOptions = orpc.years.list.queryOptions()
  const existing = useQuery({ ...yearsOptions, enabled: mode === "first" })
  const presets = useQuery(orpc.presets.list.queryOptions())
  const setupYear = useMutation(orpc.presets.setupYear.mutationOptions())

  useEffect(() => {
    if (mode === "first" && (existing.data?.length ?? 0) > 0) {
      router.replace("/dashboard")
    }
  }, [existing.data, mode, router])

  const periodNames: Record<PeriodTemplate, string[]> = {
    trimesters: [t("Term 1"), t("Term 2"), t("Term 3")],
    semesters: [t("Semester 1"), t("Semester 2")],
    "semesters-cumulative": [t("Semester 1"), t("Full year")],
    quarters: [t("Quarter 1"), t("Quarter 2"), t("Quarter 3"), t("Quarter 4")],
    none: [],
  }

  const finish = async () => {
    try {
      haptic("light")
      const created = await setupYear.mutateAsync({
        idempotencyKey: setupKey.current,
        year: {
          name: name.trim(),
          startsAt: new Date(`${startsAt}T00:00:00`),
          endsAt: new Date(`${endsAt}T23:59:59`),
          scale: Number.parseFloat(scale) || 20,
          defaultOutOf: Number.parseFloat(scale) || 20,
          passingRatio: 0.5,
          decimals: 2,
        },
        presetId,
        periodTemplateId: template,
        periodNames: periodNames[template],
      })

      writeActiveYearCookie(created.id)
      localStorage.setItem(ACTIVE_YEAR_STORAGE_KEY, JSON.stringify(created.id))
      await queryClient.invalidateQueries()
      haptic("success")
      toast.success(mode === "first" ? t("You are ready.") : t("Year created."))
      router.replace("/dashboard")
    } catch (error) {
      haptic("error")
      toast.error(
        error instanceof Error
          ? error.message
          : t("The year could not be created.")
      )
    }
  }

  const steps: Step[] = ["year", "preset", "periods"]
  const index = steps.indexOf(step)
  const busy = setupYear.isPending
  const datesValid =
    Boolean(startsAt) && Boolean(endsAt) && startsAt.localeCompare(endsAt) < 0

  return (
    <div className="pt-safe mx-auto flex min-h-svh w-full max-w-lg flex-col px-4 pb-10">
      <header className="flex h-14 items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCapIcon className="size-4" aria-hidden />
        </span>
        <span className="text-sm font-semibold">Avermate</span>
        <div className="ml-auto flex gap-1" aria-label={t("Setup progress")}>
          {steps.map((item, position) => (
            <span
              key={item}
              className={cn(
                "h-1 w-6 rounded-full transition-colors",
                position <= index ? "bg-primary" : "bg-muted"
              )}
            />
          ))}
        </div>
      </header>

      <main className="flex flex-1 flex-col gap-6 pt-4">
        {step === "year" ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {mode === "first"
                  ? t("Hello {name}", {
                      name: user.name.split(" ")[0] ?? "",
                    })
                  : t("New school year")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  "Set the calendar and grading scale first. Subjects and periods come next."
                )}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <TextField
                label={t("Year name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
              <div className="grid grid-cols-2 gap-3">
                <DateField
                  label={t("Starts")}
                  value={startsAt}
                  onValueChange={setStartsAt}
                />
                <DateField
                  label={t("Ends")}
                  value={endsAt}
                  onValueChange={setEndsAt}
                />
              </div>
              <NumberField
                label={t("Grades are out of")}
                description={t("20 in France, 100 elsewhere, 4 for a GPA.")}
                value={scale}
                onValueChange={setScale}
                min={1}
              />
            </div>

            <div className="mt-auto flex gap-2">
              {mode === "additional" ? (
                <Button
                  variant="outline"
                  size="lg"
                  onClick={() => router.back()}
                >
                  <ArrowLeftIcon className="size-4" />
                  {t("Cancel")}
                </Button>
              ) : null}
              <Button
                size="lg"
                className="flex-1"
                disabled={!name.trim() || !datesValid}
                onClick={() => setStep("preset")}
              >
                {t("Continue")}
                <ArrowRightIcon className="size-4" />
              </Button>
            </div>
          </>
        ) : null}

        {step === "preset" ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("Start from a template?")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  "Templates include subjects, coefficients and useful averages. Everything stays editable."
                )}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setPresetId(null)}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                  presetId === null
                    ? "border-primary bg-primary/6 ring-1 ring-primary/40"
                    : "border-border bg-card hover:bg-accent/50"
                )}
              >
                <LayersIcon className="mt-0.5 size-4 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {t("Start from scratch")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("Add your own subjects one by one")}
                  </span>
                </span>
                {presetId === null ? (
                  <CheckIcon className="size-4 text-primary" />
                ) : null}
              </button>

              {presets.isLoading ? (
                <div className="flex justify-center py-6">
                  <Spinner className="size-5 text-muted-foreground" />
                </div>
              ) : null}
              {presets.data?.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setPresetId(preset.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                    presetId === preset.id
                      ? "border-primary bg-primary/6 ring-1 ring-primary/40"
                      : "border-border bg-card hover:bg-accent/50"
                  )}
                >
                  <SparklesIcon className="mt-0.5 size-4 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">
                      {preset.name}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {t("{count} subjects", {
                        count: String(preset.subjectCount),
                      })}
                    </span>
                  </span>
                  {presetId === preset.id ? (
                    <CheckIcon className="size-4 text-primary" />
                  ) : null}
                </button>
              ))}
            </div>

            <div className="mt-auto flex gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setStep("year")}
              >
                <ArrowLeftIcon className="size-4" />
              </Button>
              <Button
                size="lg"
                className="flex-1"
                onClick={() => setStep("periods")}
              >
                {t("Continue")}
                <ArrowRightIcon className="size-4" />
              </Button>
            </div>
          </>
        ) : null}

        {step === "periods" ? (
          <>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">
                {t("How is your year split?")}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t("Periods can be edited individually after setup.")}
              </p>
            </div>

            <ChoiceField
              choices={[
                {
                  value: "trimesters",
                  label: t("Three terms"),
                  description: t("The usual French lycée and collège layout"),
                  icon: <CalendarRangeIcon className="size-4" />,
                },
                {
                  value: "semesters",
                  label: t("Two semesters"),
                  description: t("Each one starts from a clean slate"),
                  icon: <CalendarRangeIcon className="size-4" />,
                },
                {
                  value: "semesters-cumulative",
                  label: t("Two semesters, cumulative"),
                  description: t("The second one includes the first"),
                  icon: <CalendarRangeIcon className="size-4" />,
                },
                {
                  value: "quarters",
                  label: t("Four quarters"),
                  description: t("Four equal parts across the school year"),
                  icon: <CalendarRangeIcon className="size-4" />,
                },
                {
                  value: "none",
                  label: t("No split"),
                  description: t("One average for the whole year"),
                  icon: <LayersIcon className="size-4" />,
                },
              ]}
              value={template}
              onValueChange={setTemplate}
            />

            <div className="mt-auto flex gap-2">
              <Button
                variant="outline"
                size="lg"
                onClick={() => setStep("preset")}
              >
                <ArrowLeftIcon className="size-4" />
              </Button>
              <Button
                size="lg"
                className="flex-1"
                disabled={busy}
                onClick={finish}
              >
                {busy ? <Spinner className="size-4" /> : null}
                {t("Finish")}
                <CheckIcon className="size-4" />
              </Button>
            </div>
          </>
        ) : null}
      </main>
    </div>
  )
}
