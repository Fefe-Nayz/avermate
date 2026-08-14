function calendarDayTimestamp(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const [year, month, day] = value.split("-").map(Number)
  const date = new Date(year as number, (month as number) - 1, day, 12)
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== (month as number) - 1 ||
    date.getDate() !== day
  ) {
    return null
  }
  return date.getTime()
}

export function widgetTimelineCutoff(
  timelineDate: string | null,
  liveNow: number
): number {
  if (!timelineDate) return liveNow
  const timestamp = calendarDayTimestamp(timelineDate)
  if (timestamp === null) return liveNow
  const cutoff = new Date(timestamp)
  cutoff.setHours(23, 59, 59, 999)
  return cutoff.getTime()
}

export function widgetEvaluationTime(
  timelineDate: string | null,
  liveNow: number,
  periodStart: Date,
  periodEnd: Date
): { from: Date; to: Date; now: Date } {
  const cutoff = widgetTimelineCutoff(timelineDate, liveNow)
  const from = new Date(periodStart)
  const boundedTo = new Date(Math.min(cutoff, periodEnd.getTime()))
  const to = boundedTo > from ? boundedTo : new Date(from.getTime() + 1)
  return { from, to, now: new Date(cutoff) }
}
