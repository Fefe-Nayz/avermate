"use client"

import { useMemo, useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { SlidersHorizontalIcon } from "lucide-react"
import { useExtracted, useFormatter } from "next-intl"
import { toast } from "sonner"
import { NumberField, SelectControl } from "@/components/forms/controls"
import { SettingsSection } from "@/components/settings/settings-section"
import { Button } from "@/components/ui/button"
import { Spinner } from "@/components/ui/spinner"
import { PageMeta } from "@/components/shell/page-chrome"
import { FULL_YEAR_PERIOD_ID } from "@avermate/core"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"
import {
  buildPeriodAdjustmentGraph,
  parseAdjustmentPoints,
  periodAdjustmentBaseRatio,
} from "./academic-adjustments-model"

export default function AcademicAdjustmentsPage() {
  const t = useExtracted()
  const { periods, period } = useYear()
  const available = periods.filter(
    (candidate) => candidate.id !== FULL_YEAR_PERIOD_ID
  )
  const [periodId, setPeriodId] = useState(
    period.id === FULL_YEAR_PERIOD_ID ? (available[0]?.id ?? "") : period.id
  )
  const selected =
    available.find((candidate) => candidate.id === periodId) ?? available[0]

  return (
    <>
      <PageMeta title={t("Average adjustments")} backHref="/settings/year" />
      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Average adjustments")}
        </h1>
        <SettingsSection
          id="period-adjustments"
          icon={SlidersHorizontalIcon}
          title={t("Adjustments by period")}
          description={t(
            "Bonus points belong to a term or semester. Changing one never changes another period."
          )}
        >
          {available.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {t("Create a period before adding average adjustments.")}
            </p>
          ) : (
            <SelectControl
              id="adjustment-period"
              aria-label={t("Period")}
              value={selected?.id ?? ""}
              onValueChange={setPeriodId}
              options={available.map((candidate) => ({
                value: candidate.id,
                label: candidate.name,
              }))}
            />
          )}
        </SettingsSection>

        {selected ? (
          <PeriodAdjustmentEditor key={selected.id} periodId={selected.id} />
        ) : null}
      </div>
    </>
  )
}

function PeriodAdjustmentEditor({ periodId }: { periodId: string }) {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const { customAverages, periods, subjects, year, yearId, scale } = useYear()
  const period = periods.find((candidate) => candidate.id === periodId)
  const orderedSubjects = useMemo(
    () =>
      [...subjects]
        .filter((subject) => subject.kind === "subject")
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.name.localeCompare(right.name)
        ),
    [subjects]
  )
  const [general, setGeneral] = useState(
    period?.generalBonus ? String(period.generalBonus) : ""
  )
  const [bySubject, setBySubject] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      orderedSubjects.map((subject) => [
        subject.id,
        subject.periodBonuses?.[periodId]
          ? String(subject.periodBonuses[periodId])
          : "",
      ])
    )
  )

  const generalPoints = parseAdjustmentPoints(general)
  const draftSubjectPoints = useMemo(
    () =>
      Object.fromEntries(
        orderedSubjects.map((subject) => [
          subject.id,
          parseAdjustmentPoints(bySubject[subject.id] ?? ""),
        ])
      ),
    [bySubject, orderedSubjects]
  )
  const previewGraph = useMemo(() => {
    if (!period || !year) return null
    return buildPeriodAdjustmentGraph({
      adjustments: {
        generalPoints,
        subjectPoints: draftSubjectPoints,
      },
      customAverages,
      period,
      subjects,
      year,
    })
  }, [
    customAverages,
    draftSubjectPoints,
    generalPoints,
    period,
    subjects,
    year,
  ])

  const save = useMutation({
    ...orpc.academicAdjustments.replacePeriod.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Average adjustments saved."))
      await queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("The adjustments could not be saved."))
    },
  })

  const generalBase =
    period && year
      ? periodAdjustmentBaseRatio({
          customAverages,
          period,
          subjectId: null,
          subjects,
          year,
        })
      : null
  const generalPreview = previewGraph?.ratio(null) ?? null
  const hasLegacy = Boolean(
    year?.generalBonus || orderedSubjects.some((subject) => subject.bonus)
  )

  return (
    <SettingsSection
      title={period?.name ?? t("Period")}
      description={t(
        "The calculated average stays visible beside the points you add."
      )}
      footer={
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() =>
            save.mutate({
              periodId,
              generalPoints,
              subjects: orderedSubjects.map((subject) => ({
                subjectId: subject.id,
                points: parseAdjustmentPoints(bySubject[subject.id] ?? ""),
              })),
            })
          }
        >
          {save.isPending ? <Spinner className="size-4" /> : null}
          {t("Save")}
        </Button>
      }
    >
      {hasLegacy ? (
        <p className="rounded-lg border border-amber-500/30 bg-amber-500/8 p-3 text-xs leading-relaxed text-muted-foreground">
          {t(
            "This year still has old year-wide bonus values. They are kept for the whole-year view, but are not copied into periods. Enter each period's adjustment explicitly here."
          )}
        </p>
      ) : null}

      <div className="grid gap-3 rounded-lg border p-3 @2xl/main:grid-cols-[minmax(0,1fr)_12rem]">
        <div>
          <p className="text-sm font-medium">{t("General average")}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {generalBase === null
              ? t("No calculated average yet")
              : t("Base: {value}", {
                  value: format.number(generalBase * scale, {
                    maximumFractionDigits: 2,
                  }),
                })}
          </p>
          {generalPreview === null ? null : (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("Preview: {value}", {
                value: format.number(generalPreview * scale, {
                  maximumFractionDigits: 2,
                }),
              })}
            </p>
          )}
        </div>
        <NumberField
          label={t("Bonus points")}
          value={general}
          onValueChange={setGeneral}
          step={0.5}
          suffix={t("pts")}
        />
      </div>

      <div className="flex flex-col gap-2">
        {orderedSubjects.map((subject) => {
          const base =
            period && year
              ? periodAdjustmentBaseRatio({
                  customAverages,
                  period,
                  subjectId: subject.id,
                  subjects,
                  year,
                })
              : null
          const preview = previewGraph?.ratio(subject.id) ?? null
          return (
            <div
              key={subject.id}
              className="grid gap-3 rounded-lg border p-3 @2xl/main:grid-cols-[minmax(0,1fr)_12rem]"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{subject.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {base === null
                    ? t("No calculated average yet")
                    : t("Base: {value}", {
                        value: format.number(base * scale, {
                          maximumFractionDigits: 2,
                        }),
                      })}
                </p>
                {preview === null ? null : (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {t("Preview: {value}", {
                      value: format.number(preview * scale, {
                        maximumFractionDigits: 2,
                      }),
                    })}
                  </p>
                )}
              </div>
              <NumberField
                label={t("Bonus points")}
                value={bySubject[subject.id] ?? ""}
                onValueChange={(value) =>
                  setBySubject((current) => ({
                    ...current,
                    [subject.id]: value,
                  }))
                }
                step={0.5}
                suffix={t("pts")}
              />
            </div>
          )
        })}
      </div>
    </SettingsSection>
  )
}
