const DAY = 86_400_000

export interface PeriodDraft {
  key: string
  id?: string
  name: string
  startAt: string
  endAt: string
  isCumulative: boolean
}

export interface PeriodTemplateDefinition {
  id: string
  periods: ReadonlyArray<{
    key: string
    from: number
    to: number
    isCumulative?: boolean
  }>
}

export type PeriodDraftProblem =
  "empty-name" | "invalid-range" | "outside-year" | "overlap"

function utcDay(day: string): number {
  return new Date(`${day}T00:00:00.000Z`).getTime()
}

function isoDay(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}

export function dateInputValue(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value
  const offset = date.getTimezoneOffset() * 60_000
  return new Date(date.getTime() - offset).toISOString().slice(0, 10)
}

export function periodDraftsFromRows(
  rows: ReadonlyArray<{
    id: string
    name: string
    startAt: Date | string
    endAt: Date | string
    isCumulative: boolean
  }>
): PeriodDraft[] {
  return rows.map((period) => ({
    key: period.id,
    id: period.id,
    name: period.name,
    startAt: dateInputValue(period.startAt),
    endAt: dateInputValue(period.endAt),
    isCumulative: period.isCumulative,
  }))
}

/** Split inclusive calendar days so adjacent periods neither overlap nor gap. */
export function periodDraftsFromTemplate({
  template,
  startsAt,
  endsAt,
  names,
}: {
  template: PeriodTemplateDefinition
  startsAt: string
  endsAt: string
  names: readonly string[]
}): PeriodDraft[] {
  const first = utcDay(startsAt)
  const last = utcDay(endsAt)
  const dayCount = Math.max(1, Math.round((last - first) / DAY) + 1)

  return template.periods.map((period, index) => {
    const startIndex = Math.min(
      dayCount - 1,
      Math.max(0, Math.floor(dayCount * period.from))
    )
    const rawEndExclusive =
      index === template.periods.length - 1
        ? dayCount
        : Math.floor(dayCount * period.to)
    const endIndex = Math.min(
      dayCount - 1,
      Math.max(startIndex, rawEndExclusive - 1)
    )

    return {
      key: `${template.id}:${period.key}`,
      name: names[index] ?? `Period ${index + 1}`,
      startAt: isoDay(first + startIndex * DAY),
      endAt: isoDay(first + endIndex * DAY),
      isCumulative: period.isCumulative ?? false,
    }
  })
}

export function periodDraftProblems(
  drafts: readonly PeriodDraft[],
  year: { startsAt: string; endsAt: string }
): PeriodDraftProblem[] {
  const problems = new Set<PeriodDraftProblem>()
  const yearStart = utcDay(year.startsAt)
  const yearEnd = utcDay(year.endsAt)
  const spans = drafts
    .map((draft) => ({
      draft,
      start: utcDay(draft.startAt),
      end: utcDay(draft.endAt),
    }))
    .sort((left, right) => left.start - right.start)

  for (const span of spans) {
    if (!span.draft.name.trim()) problems.add("empty-name")
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end)) {
      problems.add("invalid-range")
      continue
    }
    if (span.end < span.start) problems.add("invalid-range")
    if (span.start < yearStart || span.end > yearEnd) {
      problems.add("outside-year")
    }
  }

  for (let index = 1; index < spans.length; index += 1) {
    const previous = spans[index - 1]
    const current = spans[index]
    if (previous && current && current.start <= previous.end) {
      problems.add("overlap")
    }
  }

  return [...problems]
}
