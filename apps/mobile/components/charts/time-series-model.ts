import type { Grade, SeriesPoint, Subject } from "@avermate/core";
import { gradeRatio, segmentedTrendLine } from "@avermate/core";

const DAY_IN_MS = 86_400_000;

export interface SerializableChartPoint {
  detail?: string;
  id: string;
  timestamp: number;
  value: number;
}

export interface SerializableChartSeries {
  color: string;
  hidden?: boolean;
  id: string;
  label: string;
  /** How the run between samples is drawn. Dots always render for "none". */
  line?: "full" | "faint" | "none";
  points: SerializableChartPoint[];
  /** The series the dashed trend follows, as the web subject page flags it. */
  primary?: boolean;
}

export interface SerializableTimeSeriesModel {
  autoZoom: boolean;
  domain: readonly [number, number];
  maximumScale: number;
  maximumZoom: number;
  series: SerializableChartSeries[];
  yDomain: readonly [number, number];
}

export interface TimeSeriesInput {
  color: string;
  hidden?: boolean;
  id: string;
  label: string;
  line?: "full" | "faint" | "none";
  points: ReadonlyArray<{
    date: Date;
    detail?: string;
    id?: string;
    value: number | null;
  }>;
  primary?: boolean;
}

function safeDomain(values: readonly number[]): readonly [number, number] {
  if (values.length === 0) return [0, DAY_IN_MS];
  const start = Math.min(...values);
  const end = Math.max(...values);
  return start === end
    ? [start - DAY_IN_MS / 2, end + DAY_IN_MS / 2]
    : [start, end];
}

/**
 * The JSON-safe boundary passed into the Expo DOM runtime. Dates and domain
 * objects never cross the async bridge, and invalid/missing samples disappear
 * without affecting another series.
 */
export function createSerializableTimeSeriesModel(input: {
  autoZoom?: boolean;
  maximumScale: number;
  series: readonly TimeSeriesInput[];
}): SerializableTimeSeriesModel {
  const series = input.series.map((item) => ({
    color: item.color,
    hidden: item.hidden,
    id: item.id,
    label: item.label,
    line: item.line,
    primary: item.primary,
    points: item.points.flatMap((point, index): SerializableChartPoint[] => {
      const timestamp = point.date.getTime();
      if (
        point.value === null ||
        !Number.isFinite(point.value) ||
        !Number.isFinite(timestamp)
      ) {
        return [];
      }
      return [
        {
          detail: point.detail,
          id: point.id ?? `${item.id}:${timestamp}:${index}`,
          timestamp,
          value: point.value,
        },
      ];
    }),
  }));
  const rows = series.flatMap((item) => item.points);
  const domain = safeDomain(rows.map((point) => point.timestamp));
  const values = rows.map((point) => point.value);
  const yDomain: readonly [number, number] = (() => {
    if (!input.autoZoom || values.length === 0) return [0, input.maximumScale];
    const minimum = Math.min(...values);
    const maximum = Math.max(...values);
    const padding = Math.max(
      (maximum - minimum) * 0.12,
      input.maximumScale * 0.025,
    );
    const start = Math.max(0, minimum - padding);
    const end = Math.min(input.maximumScale, maximum + padding);
    if (start !== end) return [start, end];
    return [
      Math.max(0, start - input.maximumScale * 0.025),
      Math.min(input.maximumScale, end + input.maximumScale * 0.025),
    ];
  })();
  const periodDays = Math.max(1, (domain[1] - domain[0]) / DAY_IN_MS);

  return {
    autoZoom: input.autoZoom ?? false,
    domain,
    maximumScale: input.maximumScale,
    maximumZoom: Math.max(1, Math.min(64, periodDays / 2)),
    series,
    yDomain,
  };
}

export function averageSeriesInput(input: {
  color: string;
  id: string;
  label: string;
  primary?: boolean;
  scale: number;
  series: readonly SeriesPoint[];
}): TimeSeriesInput {
  return {
    color: input.color,
    id: input.id,
    label: input.label,
    primary: input.primary,
    points: input.series.map((point, index) => ({
      date: point.date,
      id: `${input.id}:${point.date.getTime()}:${index}`,
      value: point.ratio === null ? null : point.ratio * input.scale,
    })),
  };
}

/**
 * The dashed trend the web charts draw when `showTrend` is on, computed with
 * the exact same core segments (`segmentedTrendLine`) over ratio space and
 * mapped back onto the chart's scale.
 *
 * Which samples feed it mirrors the web outcome for every mobile chart:
 * a series flagged `primary` wins (the web subject page flags the subject's
 * own average); otherwise the first full-line series — mobile callers seat
 * the principal average first where the web flags it; otherwise the chart is
 * a dots-only grade cloud and, like the web grade chart, every visible
 * sample is pooled chronologically into one trend source.
 */
export function createTrendChartSeries(input: {
  maximumScale: number;
  series: readonly SerializableChartSeries[];
  subdivisions: number;
}): SerializableChartSeries | null {
  if (!(input.maximumScale > 0)) return null;
  const populated = input.series.filter((item) => item.points.length > 0);
  const principal =
    populated.find((item) => item.primary) ??
    populated.find((item) => (item.line ?? "full") === "full");
  const source = principal
    ? principal.points
    : populated
        .flatMap((item) => item.points)
        .sort((left, right) => left.timestamp - right.timestamp);
  if (source.length < 2) return null;

  const trend = segmentedTrendLine(
    source.map((point) => ({
      date: new Date(point.timestamp),
      ratio: point.value / input.maximumScale,
    })),
    input.subdivisions,
  );
  const points = trend.flatMap((point, index): SerializableChartPoint[] => {
    const timestamp = point.date.getTime();
    if (point.ratio === null || !Number.isFinite(timestamp)) return [];
    return [
      {
        id: `trend:${timestamp}:${index}`,
        timestamp,
        value: point.ratio * input.maximumScale,
      },
    ];
  });
  if (points.length < 2) return null;

  return { color: "", id: "__trend__", label: "", points };
}

/** Actual assessments grouped into irregular, independently focused series. */
export function gradeSeriesInputs(input: {
  colors: readonly string[];
  /** Draw a faint run between results instead of dots alone. */
  connect?: boolean;
  grades: readonly Grade[];
  scale: number;
  subjects: readonly Subject[];
}): TimeSeriesInput[] {
  const subjectNames = new Map(
    input.subjects.map((subject) => [subject.id, subject.name]),
  );
  const grouped = new Map<string, Grade[]>();
  for (const grade of input.grades) {
    const list = grouped.get(grade.subjectId);
    if (list) list.push(grade);
    else grouped.set(grade.subjectId, [grade]);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) =>
      (subjectNames.get(left) ?? left).localeCompare(
        subjectNames.get(right) ?? right,
      ),
    )
    .map(([subjectId, grades], seriesIndex) => ({
      color: input.colors[seriesIndex % input.colors.length] ?? "#5B8FF9",
      id: subjectId,
      label: subjectNames.get(subjectId) ?? subjectId,
      line: (input.connect ? "faint" : "none") as "faint" | "none",
      points: grades
        .slice()
        .sort(
          (left, right) => left.passedAt.getTime() - right.passedAt.getTime(),
        )
        .map((grade) => {
          const ratio = gradeRatio(grade);
          return {
            date: grade.passedAt,
            detail: `${grade.name} · ${grade.value} / ${grade.outOf}`,
            id: grade.id,
            value: ratio === null ? null : ratio * input.scale,
          };
        }),
    }));
}
