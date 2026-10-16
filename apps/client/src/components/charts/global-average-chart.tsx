"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { Period } from "@/types/period";
import { Subject } from "@/types/subject";
import { useTimelineModeState } from "@/hooks/use-timeline-mode";
import { useYearComparison } from "@/hooks/use-year-comparison";
import { average, averageOverTime } from "@/utils/average";
import {
  calculateTrendLineData,
  calculateYAxisDomain,
  getVisibleChartEndDate,
} from "@/utils/chart";
import { BookOpenIcon } from "@heroicons/react/24/outline";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Polygon,
  Radar,
  RadarChart,
  ReferenceDot,
  XAxis,
  YAxis,
  useActiveTooltipLabel,
} from "recharts";

import AddGradeDialog from "../dialogs/add-grade-dialog";
import { SubjectEmptyState } from "../empty-states/subject-empty-state";
import { Button } from "../ui/button";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";
import { GradeEmptyState } from "../empty-states/grade-empty-state";
import { useChartSettings } from "@/hooks/use-chart-settings";
import { startOfDay } from "date-fns";

export interface TickProps {
  x?: number | string;
  y?: number | string;
  cx?: number | string;
  cy?: number | string;
  payload?: { value?: string };
}

function getCumulativeStartDate(
  periods: Period[],
  currentPeriod: Period
): Date {
  if (currentPeriod.id === "full-year") {
    return new Date(currentPeriod.startAt);
  }

  const sorted = [...periods].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );
  const currentIndex = sorted.findIndex((p) => p.id === currentPeriod.id);

  if (currentIndex === -1) {
    return new Date(currentPeriod.startAt);
  }

  if (currentPeriod.isCumulative) {
    return new Date(sorted[0].startAt);
  }

  return new Date(currentPeriod.startAt);
}

interface ChartDataPoint {
  date: string;
  average: number | null;
  referenceAverage?: number | null;
  referenceDate?: string | null;
}

// Recharts positions null radar values at the origin. Give Polygon an actual
// gap instead, so an unmapped subject never looks like a zero average.
function ComparisonRadarShape({
  points = [],
  ...style
}: {
  points?: Array<{ x: number; y: number; value?: number | null }>;
  stroke?: string;
  strokeWidth?: number | string;
  strokeDasharray?: string;
  fill?: string;
  fillOpacity?: number;
}) {
  return (
    <g>
      <Polygon
        {...style}
        points={points.map((point) =>
          point.value == null ? { x: NaN, y: NaN } : point
        )}
        connectNulls={false}
      />
      {points.map((point, index) => point.value == null ? null : (
        <circle key={index} cx={point.x} cy={point.y} r={2.5} fill={style.stroke} />
      ))}
    </g>
  );
}

function findNearestDatum(
  data: ChartDataPoint[],
  targetDate: string
): ChartDataPoint | null {
  let nearestDatum: ChartDataPoint | null = null;
  let minDiff = Infinity;
  const targetTime = new Date(targetDate).getTime();

  data.forEach((datum) => {
    if (datum.average === null) return;

    const datumTime = new Date(datum.date).getTime();
    const diff = Math.abs(datumTime - targetTime);

    if (diff < minDiff) {
      minDiff = diff;
      nearestDatum = datum;
    }
  });

  return nearestDatum;
}

function GlobalActiveDot({ chartData, exactDate = false }: { chartData: ChartDataPoint[]; exactDate?: boolean }) {
  const activeLabel = useActiveTooltipLabel();
  if (!activeLabel) return null;

  const nearestDatum = exactDate
    ? chartData.find((point) => point.date === String(activeLabel))
    : findNearestDatum(chartData, String(activeLabel));
  if (!nearestDatum || nearestDatum.average === null) return null;

  return (
    <ReferenceDot
      x={nearestDatum.date}
      y={nearestDatum.average}
      r={4}
      fill="var(--chart-1)"
      strokeWidth={0}
      opacity={0.8}
    />
  );
}

function CustomTooltipContent({
  active,
  label,
  chartData,
  formatDates,
  currentLabel,
  referenceLabel,
}: {
  active?: boolean;
  label?: string;
  chartData: ChartDataPoint[];
  formatDates: ReturnType<typeof useFormatDates>;
  currentLabel?: string;
  referenceLabel?: string;
}) {
  const selectedDatum = chartData.find((point) => point.date === label);
  const nearestDatum = referenceLabel
    ? selectedDatum
    : label ? findNearestDatum(chartData, label) : undefined;
  const value = nearestDatum?.average ?? null;
  const referenceValue = selectedDatum?.referenceAverage;

  return (
    <ChartTooltipContent
      active={active && !!label}
      label={label ? formatDates.formatShort(new Date(label)) : undefined}
      payload={[
        ...(value !== null
          ? [
              {
                name: currentLabel ?? "Global Average",
                value: value.toFixed(2),
                color: "var(--chart-1)",
                dataKey: "global-average",
                payload: null,
              },
            ]
          : []),
        ...(referenceLabel && referenceValue != null && selectedDatum?.referenceDate
          ? [{
              name: `${referenceLabel} · ${formatDates.formatIntermediate(new Date(`${selectedDatum.referenceDate}T12:00:00`))}`,
              value: referenceValue.toFixed(2),
              color: "var(--chart-2)",
              dataKey: "referenceAverage",
              payload: null,
            }]
          : []),
      ]}
    />
  );
}

export default function GlobalAverageChart({
  subjects,
  period,
  periods,
  yearId,
}: {
  subjects: Subject[];
  period: Period;
  periods: Period[];
  yearId: string;
}) {
  const formatter = useFormatter();
  const t = useTranslations("Dashboard.Charts.GlobalAverageChart");
  const comparisonT = useTranslations("YearComparison");
  const formatDates = useFormatDates(formatter);
  const { settings, isLoaded } = useChartSettings();
  const showTrendLine = isLoaded && settings.showTrendLine;
  const { isActive: timelineEnabled, snapshotDate } = useTimelineModeState();
  const comparison = useYearComparison(period.id);
  const comparisonEnabled = comparison.active && comparison.ready && comparison.currentYear?.id === yearId;
  const currentLabel = comparison.currentYear?.name ?? t("average");
  const referenceLabel = comparison.referenceYear?.name ?? "";
  const chartPeriod = comparisonEnabled && period.id === "full-year" && comparison.currentYear
    ? { ...period, startAt: comparison.currentYear.startDate, endAt: comparison.currentYear.endDate }
    : period;

  // Calculate the start and end dates
  const visibleEndDate = getVisibleChartEndDate(new Date(chartPeriod.endAt), {
    snapshotDate: timelineEnabled ? snapshotDate : null,
  });
  const endDate = comparisonEnabled ? startOfDay(visibleEndDate) : visibleEndDate;
  const periodStartDate = getCumulativeStartDate(periods, chartPeriod);
  const startDate = comparisonEnabled ? startOfDay(periodStartDate) : periodStartDate;
  const chartSubjects = comparisonEnabled
    ? comparison.scopeCurrentSubjects(subjects)
    : subjects;

  // Generate an array of dates
  const dates: Date[] = [];
  for (
    let dt = new Date(startDate);
    dt <= endDate;
    dt.setDate(dt.getDate() + 1)
  ) {
    dates.push(new Date(dt));
  }

  // Calculate the average grades over time
  const averages = averageOverTime(chartSubjects, undefined, chartPeriod, periods);

  const referenceSeries = comparisonEnabled
    ? comparison.getReferenceSeries(dates.map((date) => date.toISOString()))
    : [];
  let currentAverage: number | null = null;
  const baseChartData = dates.map((date, index) => {
    currentAverage = averages[index] ?? currentAverage;
    return {
      date: date.toISOString(),
      average: comparisonEnabled ? currentAverage : averages[index],
      referenceAverage: referenceSeries[index]?.value ?? null,
      referenceDate: referenceSeries[index]?.referenceDate ?? null,
    };
  });
  const hasReferenceData = referenceSeries.some((point) => point.value !== null);

  const trendLine = showTrendLine
    ? calculateTrendLineData(baseChartData, "average", { subdivisions: settings.trendLineSubdivisions })
    : baseChartData.map(() => null);
  const chartData = baseChartData.map((point, index) => ({
    ...point,
    trendLine: trendLine[index],
  }));

  const chartConfig = {
    average: {
      label: comparisonEnabled ? currentLabel : t("average"),
      color: "var(--chart-1)",
    },
    referenceAverage: {
      label: referenceLabel,
      color: "var(--chart-2)",
    },
  };

  // Calculate Y-axis domain based on settings
  const yAxisDomain = calculateYAxisDomain(
    chartData,
    0,
    20,
    ["average", "trendLine", "referenceAverage"],
    settings.autoZoomYAxis
  );

  // Calculate average grades per subject for radar chart
  const subjectAverages = chartSubjects
    .filter((subject) => subject.isMainSubject)
    .map((subject) => {
      const averageGrade = average(subject.id, chartSubjects);
      return {
        subject: subject.name,
        average: comparisonEnabled ? averageGrade : averageGrade ?? 0,
        referenceAverage: comparisonEnabled ? comparison.getReferenceAverage(subject.id) : null,
        fullMark: 20,
      };
    });

  const renderPolarAngleAxis = (props: TickProps) => {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const cx = Number(props.cx ?? 0);
    const cy = Number(props.cy ?? 0);
    const value = props.payload?.value ?? "";

    const radius = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    const angle = Math.atan2(y - cy, x - cx);

    const truncateLength =
      window.innerWidth < 450
        ? 5
        : window.innerWidth < 1024
        ? 10
        : window.innerWidth < 1300
        ? 5
        : window.innerWidth < 2100
        ? 9
        : 12;

    const truncatedLabel =
      value.length > truncateLength
        ? `${value.slice(0, truncateLength)}...`
        : value;

    const labelRadius = radius - truncatedLabel.length * 3 + 10;
    const nx = cx + labelRadius * Math.cos(angle);
    const ny = cy + labelRadius * Math.sin(angle);
    let rotation = (angle * 180) / Math.PI;

    if (rotation > 90) {
      rotation -= 180;
    } else if (rotation < -90) {
      rotation += 180;
    }

    return (
      <text
        x={nx}
        y={ny}
        textAnchor="middle"
        transform={`rotate(${rotation}, ${nx}, ${ny})`}
        fontSize={12}
        fill="#a1a1aa"
      >
        {truncatedLabel}
      </text>
    );
  };

  // Handle if there are no subjects
  if (subjects.length === 0) {
    return <SubjectEmptyState className="col-span-full" />;
  }

  // If all the averages are null
  if (chartData.every((data) => data.average === null) && !hasReferenceData) {
    return <GradeEmptyState className="col-span-full" yearId={yearId} />;
  }

  return (
    <Card className="lg:col-span-5">
      <CardHeader>
        <CardTitle>{t("globalAverageTitle")}</CardTitle>
        {comparisonEnabled && (
          <div className="space-y-2 pt-2 text-xs text-muted-foreground">
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              <span className="flex items-center gap-2"><span aria-hidden="true" className="w-6 border-t-2 border-[var(--chart-1)]" />{currentLabel}</span>
              <span className="flex items-center gap-2"><span aria-hidden="true" className="w-6 border-t-2 border-dashed border-[var(--chart-2)]" />{referenceLabel}</span>
            </div>
            <p>{comparisonT("chartAlignment")}</p>
            {!hasReferenceData && <p>{comparisonT("noChartData")}</p>}
          </div>
        )}
      </CardHeader>

      <CardContent>
        <div className="flex items-start lg:space-x-4 text-sm flex-wrap lg:flex-nowrap h-fit justify-center gap-[10px] flex-col lg:flex-row pt-2">
          <div className="flex flex-col items-center lg:items-start grow min-w-0 my-0 mx-auto w-full lg:w-[60%]">
            <CardDescription className="pb-8">
              {t("areaChartDescription")}
            </CardDescription>
            <ChartContainer config={chartConfig} className="h-[302px] w-full">
              <AreaChart data={chartData} margin={{ left: -20 }}>
                <CartesianGrid vertical={false} />
                <XAxis
                  dataKey="date"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                  tickFormatter={(value) =>
                    formatDates.formatShort(new Date(value))
                  }
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  domain={yAxisDomain}
                  tickMargin={8}
                  tickCount={5}
                />
                <ChartTooltip
                  filterNull={false}
                  cursor={false}
                  content={({ active, label }) => (
                    <CustomTooltipContent
                      active={active}
                      label={label ? label.toString() : undefined}
                      chartData={chartData}
                      formatDates={formatDates}
                      currentLabel={comparisonEnabled ? currentLabel : undefined}
                      referenceLabel={comparisonEnabled ? referenceLabel : undefined}
                    />
                  )}
                />
                <Area
                  dataKey="average"
                  type={comparisonEnabled ? "stepAfter" : "monotone"}
                  fill="var(--chart-1)"
                  stroke="var(--chart-1)"
                  fillOpacity={0.1}
                  strokeWidth={2}
                  connectNulls={true}
                  dot={false}
                  activeDot={false}
                />
                {comparisonEnabled && (
                  <Line
                    dataKey="referenceAverage"
                    type="stepAfter"
                    stroke="var(--chart-2)"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    connectNulls={false}
                    dot={false}
                    activeDot={{ r: 4, fill: "var(--chart-2)", strokeWidth: 0 }}
                  />
                )}
                {showTrendLine ? (
                  <Line
                    dataKey="trendLine"
                    type="monotone"
                    stroke="#64748b"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    connectNulls={true}
                    dot={false}
                    activeDot={false}
                  />
                ) : null}
                <GlobalActiveDot chartData={chartData} exactDate={comparisonEnabled} />
              </AreaChart>
            </ChartContainer>
          </div>

          <Separator
            orientation="vertical"
            className="hidden lg:block h-[360px]"
          />

          <div className="flex flex-col items-center lg:space-y-2 lg:w-[40%] m-auto lg:pt-0 pt-8 w-full">
            <CardDescription>{t("radarChartDescription")}</CardDescription>
            <ChartContainer
              config={chartConfig}
              className="h-[332px] w-full m-auto aspect-auto!"
            >
              <RadarChart data={subjectAverages} outerRadius="90%">
                <PolarGrid />
                <PolarAngleAxis dataKey="subject" tick={renderPolarAngleAxis} />
                <Radar
                  dataKey="average"
                  name={comparisonEnabled ? currentLabel : undefined}
                  shape={comparisonEnabled ? <ComparisonRadarShape /> : undefined}
                  activeDot={comparisonEnabled ? false : undefined}
                  fillOpacity={0.1}
                  stroke="var(--chart-1)"
                  fill="var(--chart-1)"
                  strokeWidth={2}
                />
                {comparisonEnabled && (
                  <Radar
                    dataKey="referenceAverage"
                    name={referenceLabel}
                    shape={<ComparisonRadarShape />}
                    activeDot={false}
                    fillOpacity={0}
                    stroke="var(--chart-2)"
                    fill="var(--chart-2)"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                    connectNulls={false}
                  />
                )}
                <PolarRadiusAxis domain={[0, 20]} stroke="#a1a1aa" />
                <ChartTooltip
                  content={comparisonEnabled
                    ? ({ active, label, payload }) => (
                        <ChartTooltipContent
                          active={active}
                          label={label == null ? undefined : String(label)}
                          payload={payload?.filter((item) => item.value != null).map((item) => ({
                            name: item.dataKey === "referenceAverage" && comparison.referenceCutoffDate
                              ? `${referenceLabel} · ${formatDates.formatIntermediate(new Date(`${comparison.referenceCutoffDate}T12:00:00`))}`
                              : currentLabel,
                            dataKey: String(item.dataKey),
                            value: Number(item.value).toFixed(2),
                            color: item.dataKey === "referenceAverage" ? "var(--chart-2)" : "var(--chart-1)",
                            payload: null,
                          }))}
                        />
                      )
                    : <ChartTooltipContent />}
                />
              </RadarChart>
            </ChartContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
