"use client"

import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
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
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import {
  ChoiceField,
  NumberField,
  TextField,
} from "@/components/forms/controls"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/**
 * First run.
 *
 * Four questions, each of which the app cannot guess and none of which it asks
 * twice. Presets exist so a prépa student with twenty weighted sub-subjects is
 * not typing for ten minutes before seeing anything.
 */

type Step = "year" | "preset" | "periods" | "done"

function defaultYearRange(): { start: string; end: string; name: string } {
  const now = new Date()
  // A school year is named for the September it starts in — before summer,
  // that is last year.
  const startYear =
    now.getMonth() >= 7 ? now.getFullYear() : now.getFullYear() - 1
  return {
    name: `${startYear}–${startYear + 1}`,
    start: `${startYear}-09-01`,
    end: `${startYear + 1}-07-15`,
  }
}

export default function OnboardingPage() {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const user = useAuthenticatedUser()

  const defaults = useMemo(() => defaultYearRange(), [])
  const [step, setStep] = useState<Step>("year")
  const [name, setName] = useState(defaults.name)
  const [startsAt, setStartsAt] = useState(defaults.start)
  const [endsAt, setEndsAt] = useState(defaults.end)
  const [scale, setScale] = useState("20")
  const [presetId, setPresetId] = useState<string | null>(null)
  const [template, setTemplate] = useState("trimesters")
  const [yearId, setYearId] = useState<string | null>(null)

  const existing = useQuery(orpc.years.list.queryOptions())
  const presets = useQuery(orpc.presets.list.queryOptions())

  useEffect(() => {
    // Someone who already has a year landed here by accident, or came back with
    // the back button after finishing.
    if ((existing.data?.length ?? 0) > 0 && step === "year" && !yearId) {
      router.replace("/dashboard")
    }
  }, [existing.data, step, yearId, router])

  const createYear = useMutation({
    ...orpc.years.create.mutationOptions(),
    onSuccess: (year) => {
      setYearId(year?.id ?? null)
      haptic("success")
      setStep("preset")
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The year could not be created."))
    },
  })

  const applyPreset = useMutation(orpc.presets.apply.mutationOptions())
  const applyPeriods = useMutation(orpc.presets.applyPeriods.mutationOptions())

  const periodNames: Record<string, string[]> = {
    trimesters: [t("Term 1"), t("Term 2"), t("Term 3")],
    semesters: [t("Semester 1"), t("Semester 2")],
    "semesters-cumulative": [t("Semester 1"), t("Full year")],
    quarters: [t("Quarter 1"), t("Quarter 2"), t("Quarter 3"), t("Quarter 4")],
    none: [],
  }

  const finish = async () => {
    if (!yearId) return
    haptic("light")

    if (presetId) {
      await applyPreset.mutateAsync({
        yearId,
        presetId,
        replaceExisting: false,
      })
    }
    if (template !== "none") {
      await applyPeriods.mutateAsync({
        yearId,
        templateId: template,
        names: periodNames[template] ?? [],
      })
    }

    await queryClient.invalidateQueries()
    haptic("success")
    router.replace("/dashboard")
  }

  const steps: Step[] = ["year", "preset", "periods"]
  const index = steps.indexOf(step)
  const busy =
    createYear.isPending || applyPreset.isPending || applyPeriods.isPending

  return (
    <div className="pt-safe mx-auto flex min-h-svh w-full max-w-lg flex-col px-4 pb-10">
      <header className="flex h-14 items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCapIcon className="size-4" />
        </span>
        <span className="text-sm font-semibold">Avermate</span>
        <div className="ml-auto flex gap-1">
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
                {t("Hello {name}", {
                  name: user.name.split(" ")[0] ?? "",
                })}
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {t(
                  "Let us set up your school year. You can change all of this later."
                )}
              </p>
            </div>

            <div className="flex flex-col gap-4">
              <TextField
                label={t("Year name")}
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <div className="grid grid-cols-2 gap-3">
                <TextField
                  label={t("Starts")}
                  type="date"
                  value={startsAt}
                  onChange={(event) => setStartsAt(event.target.value)}
                />
                <TextField
                  label={t("Ends")}
                  type="date"
                  value={endsAt}
                  onChange={(event) => setEndsAt(event.target.value)}
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

            <Button
              size="lg"
              className="mt-auto"
              disabled={busy || !name.trim()}
              onClick={() =>
                createYear.mutate({
                  name: name.trim(),
                  startsAt: new Date(`${startsAt}T00:00:00`),
                  endsAt: new Date(`${endsAt}T23:59:59`),
                  scale: Number.parseFloat(scale) || 20,
                  defaultOutOf: Number.parseFloat(scale) || 20,
                  passingRatio: 0.5,
                  decimals: 2,
                })
              }
            >
              {busy ? <Spinner className="size-4" /> : null}
              {t("Continue")}
              <ArrowRightIcon className="size-4" />
            </Button>
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
                  "Templates come with the subjects and coefficients already set. Everything stays editable."
                )}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => {
                  haptic("selection")
                  setPresetId(null)
                }}
                className={cn(
                  "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                  presetId === null
                    ? "border-primary bg-primary/6 ring-1 ring-primary/40"
                    : "border-border bg-card hover:bg-accent/50"
                )}
              >
                <LayersIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">
                    {t("Start from scratch")}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {t("Add your own subjects one by one")}
                  </span>
                </span>
                {presetId === null ? (
                  <CheckIcon className="mt-0.5 size-4 text-primary" />
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
                  onClick={() => {
                    haptic("selection")
                    setPresetId(preset.id)
                  }}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3.5 text-left transition-colors",
                    presetId === preset.id
                      ? "border-primary bg-primary/6 ring-1 ring-primary/40"
                      : "border-border bg-card hover:bg-accent/50"
                  )}
                >
                  <SparklesIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
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
                    <CheckIcon className="mt-0.5 size-4 text-primary" />
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
                onClick={() => {
                  haptic("light")
                  setStep("periods")
                }}
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
                {t(
                  "Periods let you see an average per term instead of one running total."
                )}
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
