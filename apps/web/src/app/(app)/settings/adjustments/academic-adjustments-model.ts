import {
  generalAverageSource,
  restrictToPeriod,
  SubjectGraph,
  type CustomAverage,
  type Period,
  type Subject,
  type Year,
} from "@avermate/core"

export function parseAdjustmentPoints(value: string): number {
  const parsed = Number.parseFloat(value.replace(",", "."))
  return Number.isFinite(parsed) ? parsed : 0
}

/** Build the exact graph represented by one row of the period editor. */
export function buildPeriodAdjustmentGraph({
  adjustments,
  customAverages,
  period,
  subjects,
  year,
}: {
  adjustments?: {
    generalPoints: number
    subjectPoints: Readonly<Record<string, number>>
  }
  customAverages: readonly CustomAverage[]
  period: Period
  subjects: readonly Subject[]
  year: Year
}): SubjectGraph {
  const periodSubjects = subjects.map((subject) => ({
    ...subject,
    bonus:
      adjustments?.subjectPoints[subject.id] ??
      subject.periodBonuses?.[period.id] ??
      0,
  }))
  const nominated = year.mainAverageId
    ? customAverages.find((average) => average.id === year.mainAverageId)
    : undefined

  return new SubjectGraph(restrictToPeriod(periodSubjects, period, year), {
    scale: year.scale,
    generalBonus: adjustments?.generalPoints ?? period.generalBonus ?? 0,
    ...(nominated
      ? {
          general: generalAverageSource(
            new SubjectGraph(periodSubjects),
            nominated
          ),
        }
      : {}),
  })
}

/**
 * Re-evaluate without the one adjustment shown beside the reading. Subtracting
 * from an already-clamped ratio cannot recover a base above/below the scale.
 */
export function periodAdjustmentBaseRatio({
  customAverages,
  period,
  subjectId,
  subjects,
  year,
}: {
  customAverages: readonly CustomAverage[]
  period: Period
  subjectId: string | null
  subjects: readonly Subject[]
  year: Year
}): number | null {
  return buildPeriodAdjustmentGraph({
    adjustments: {
      generalPoints: subjectId === null ? 0 : (period.generalBonus ?? 0),
      subjectPoints: Object.fromEntries(
        subjects.map((subject) => [
          subject.id,
          subject.id === subjectId
            ? 0
            : (subject.periodBonuses?.[period.id] ?? 0),
        ])
      ),
    },
    customAverages,
    period,
    subjects,
    year,
  }).ratio(subjectId)
}
