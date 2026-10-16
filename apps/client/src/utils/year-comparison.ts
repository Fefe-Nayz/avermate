import type { Period } from "@/types/period";
import type { Subject } from "@/types/subject";
import type { Year } from "@/types/year";
import type { YearComparisonMap, YearComparisonScope, YearComparisonSeriesPoint } from "@/types/year-comparison";
import { average } from "./average";

const DAY = 86_400_000;

export function normalizeComparisonName(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export function getSubjectComparisonPath(subject: Subject, subjects: Subject[]) {
  return subjectPathParts(subject, subjects).join(" / ");
}

function subjectPathParts(subject: Subject, subjects: Subject[]) {
  const byId = new Map(subjects.map((entry) => [entry.id, entry]));
  const parts: string[] = [];
  const seen = new Set<string>();
  let current: Subject | undefined = subject;
  while (current && !seen.has(current.id)) {
    seen.add(current.id);
    parts.unshift(current.name);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return parts;
}

function uniqueMatches<T extends { id: string }>(source: T[], reference: T[], key: (entry: T, entries: T[]) => string) {
  const sourceGroups = new Map<string, T[]>();
  const referenceGroups = new Map<string, T[]>();
  for (const [entries, groups] of [[source, sourceGroups], [reference, referenceGroups]] as const) {
    for (const entry of entries) {
      const normalized = key(entry, entries);
      if (normalized) groups.set(normalized, [...(groups.get(normalized) ?? []), entry]);
    }
  }
  const matches: YearComparisonMap = {};
  for (const [name, entries] of sourceGroups) {
    const targets = referenceGroups.get(name);
    if (entries.length === 1 && targets?.length === 1) matches[entries[0].id] = targets[0].id;
  }
  return matches;
}

/** Only unique names/paths are suggested; ambiguous matches require a user choice. */
export function suggestSubjectMap(source: Subject[], reference: Subject[]): YearComparisonMap {
  const matches = uniqueMatches(source, reference, (subject, subjects) =>
    `${subject.isDisplaySubject}:` + subjectPathParts(subject, subjects).map(normalizeComparisonName).join(" / "));
  const names = uniqueMatches(source, reference, (subject) =>
    `${subject.isDisplaySubject}:` + normalizeComparisonName(subject.name));
  const used = new Set(Object.values(matches));
  for (const [id, target] of Object.entries(names)) {
    if (target && !matches[id] && !used.has(target)) {
      matches[id] = target;
      used.add(target);
    }
  }
  return matches;
}

export function suggestPeriodMap(source: Period[], reference: Period[]): YearComparisonMap {
  const matches = uniqueMatches(source, reference, (period) =>
    `${period.isCumulative}:` + normalizeComparisonName(period.name));
  const sortedSource = [...source].sort((a, b) => calendarDay(a.startAt) - calendarDay(b.startAt));
  const sortedReference = [...reference].sort((a, b) => calendarDay(a.startAt) - calendarDay(b.startAt));
  // Rank is safe only when the complete period structures agree, including cumulative semantics.
  if (source.length !== reference.length || sortedSource.some((period, index) =>
    period.isCumulative !== sortedReference[index].isCumulative)) return matches;
  const used = new Set(Object.values(matches));
  sortedSource.forEach((period, index) => {
    const target = sortedReference[index];
    if (!matches[period.id] && !used.has(target.id)) {
      matches[period.id] = target.id;
      used.add(target.id);
    }
  });
  return matches;
}

/** Deleted subjects/periods must not leave invisible IDs in editable saved mappings. */
export function sanitizeComparisonMap(
  mappings: YearComparisonMap,
  source: Array<{ id: string }>,
  reference: Array<{ id: string }>
): YearComparisonMap {
  const sourceIds = new Set(source.map((entry) => entry.id));
  const referenceIds = new Set(reference.map((entry) => entry.id));
  return Object.fromEntries(Object.entries(mappings)
    .filter(([id]) => sourceIds.has(id))
    .map(([id, target]) => [id, target && referenceIds.has(target) ? target : null]));
}

/** Calendar-day arithmetic avoids DST and leap-year drift from timestamp/year offsets. */
export function calendarDay(value: Date | string): number {
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00`) : new Date(value);
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
}

function dayString(day: number) {
  return Number.isFinite(day) ? new Date(day * DAY).toISOString().slice(0, 10) : "";
}

export type ComparisonRange = {
  start: number;
  end: number;
  period: Period;
  periodIds: string[] | null;
};

export function getComparisonRange(year: Year, periods: Period[], periodId?: string): ComparisonRange | null {
  if (!periodId || periodId === "full-year") {
    return {
      start: calendarDay(year.startDate), end: calendarDay(year.endDate), periodIds: null,
      period: { id: "full-year", name: year.name, startAt: year.startDate, endAt: year.endDate,
        yearId: year.id, isCumulative: false, createdAt: "", userId: "" },
    };
  }
  const sorted = [...periods].sort((a, b) => calendarDay(a.startAt) - calendarDay(b.startAt));
  const index = sorted.findIndex((period) => period.id === periodId);
  if (index === -1) return null;
  const period = sorted[index];
  const relevant = period.isCumulative ? sorted.slice(0, index + 1) : [period];
  return { start: calendarDay(relevant[0].startAt), end: calendarDay(period.endAt), period,
    periodIds: relevant.map((entry) => entry.id) };
}

export function filterComparisonSubjects(subjects: Subject[], range: ComparisonRange, cutoff: number): Subject[] {
  const periodIds = range.periodIds ? new Set(range.periodIds) : null;
  return subjects.map((subject) => ({
    ...subject,
    grades: subject.grades.filter((grade) => {
      const day = calendarDay(grade.passedAt);
      return Number.isFinite(day) && day <= Math.min(cutoff, range.end)
        && (periodIds === null || periodIds.has(grade.periodId));
    }),
  }));
}

export function isGeneralComparisonSubject(subjectId?: string) {
  return !subjectId || ["general-average", "full-year", "global", "GLOBAL_SUBJECT_ID"].includes(subjectId);
}

type ComparisonEngineInput = {
  currentYear: Year;
  referenceYear: Year;
  sourcePeriods: Period[];
  referencePeriods: Period[];
  referenceSubjects: Subject[];
  subjectMap: YearComparisonMap;
  periodMap: YearComparisonMap;
  periodId?: string;
  scope?: YearComparisonScope;
  /** Timeline snapshot, or now when the timeline is disabled. */
  snapshotDate?: Date | string;
  now?: Date;
};

export function createYearComparison(input: ComparisonEngineInput) {
  const sourceRange = getComparisonRange(input.currentYear, input.sourcePeriods, input.periodId);
  const referencePeriodId = !input.periodId || input.periodId === "full-year"
    ? "full-year" : input.periodMap[input.periodId];
  const referenceRange = referencePeriodId
    ? getComparisonRange(input.referenceYear, input.referencePeriods, referencePeriodId) : null;
  const now = calendarDay(input.now ?? new Date());
  const sourceCutoff = sourceRange ? Math.min(sourceRange.end, now, calendarDay(input.snapshotDate ?? input.now ?? new Date())) : NaN;
  const elapsed = sourceRange ? sourceCutoff - sourceRange.start : NaN;
  const referenceCutoff = referenceRange ? Math.min(referenceRange.end, now,
    input.scope === "full-period" ? referenceRange.end : referenceRange.start + elapsed) : NaN;
  const ready = !!sourceRange && !!referenceRange && Number.isFinite(referenceCutoff);
  const filtered = ready && elapsed >= 0
    ? filterComparisonSubjects(input.referenceSubjects, referenceRange!, referenceCutoff) : [];
  const resolveSubject = (subjectId?: string) => isGeneralComparisonSubject(subjectId) ? undefined : input.subjectMap[subjectId!] ?? undefined;
  const hasSubject = (subjectId?: string) => isGeneralComparisonSubject(subjectId) || !!resolveSubject(subjectId);
  return {
    ready, sourceRange, referenceRange, referenceSubjects: filtered,
    referencePeriod: referenceRange?.period,
    sourceCutoff: dayString(sourceCutoff), referenceCutoff: dayString(referenceCutoff),
    scopeCurrentSubjects(subjects: Subject[]): Subject[] {
      if (!ready) return subjects;
      return elapsed < 0 ? subjects.map((subject) => ({ ...subject, grades: [] }))
        : filterComparisonSubjects(subjects, sourceRange!, sourceCutoff);
    },
    getReferenceAverage(subjectId?: string): number | null {
      if (!ready || !hasSubject(subjectId) || elapsed < 0) return null;
      return average(resolveSubject(subjectId), filtered);
    },
    getReferenceSeries(dates: string[], subjectId?: string): YearComparisonSeriesPoint[] {
      const cache = new Map<number, number | null>();
      return dates.map((date) => {
        const day = calendarDay(date);
        const aligned = sourceRange && referenceRange ? referenceRange.start + day - sourceRange.start : NaN;
        const referenceDay = referenceRange ? Math.min(aligned, referenceRange.end, referenceCutoff) : NaN;
        const referenceDate = dayString(referenceDay);
        if (!ready || !hasSubject(subjectId) || !Number.isFinite(day) || day < sourceRange!.start || day > sourceCutoff || elapsed < 0) {
          return { date, referenceDate, value: null };
        }
        if (!cache.has(referenceDay)) {
          cache.set(referenceDay, average(resolveSubject(subjectId), filterComparisonSubjects(input.referenceSubjects, referenceRange!, referenceDay)));
        }
        return { date, referenceDate, value: cache.get(referenceDay) ?? null };
      });
    },
  };
}
