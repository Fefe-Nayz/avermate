"use client";

import { Card } from "@/components/ui/card";
import { useTimelineModeState } from "@/hooks/use-timeline-mode";
import { useYearComparison } from "@/hooks/use-year-comparison";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Period } from "@/types/period";
import { Subject } from "@/types/subject";
import { averageOverTime, getChildren } from "@/utils/average";
import {
  calculateTrendLineData,
  calculateYAxisDomain,
  getVisibleChartEndDate,
} from "@/utils/chart";
import React from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceDot,
  XAxis,
  YAxis,
  ResponsiveContainer,
  useActiveTooltipLabel,
} from "recharts";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";
import { useChartSettings } from "@/hooks/use-chart-settings";
import { startOfDay } from "date-fns";

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

const predefinedColors = [
  "#ea5545",
  "#f46a9b",
  "#ef9b20",
  "#edbf33",
  "#ede15b",
  "#bdcf32",
  "#87bc45",
  "#27aeef",
  "#b33dc6",
];

interface ChartDataPoint {
  date: string;
  average: number | null;
  [key: string]: number | string | null; // For dynamic subject data
}

interface ChartConfig {
  [key: string]: {
    label: string;
    color: string;
  };
}

interface CustomTooltipContentProps {
  active?: boolean;
  label?: string;
  chartData: ChartDataPoint[];
  chartConfig: ChartConfig;
  formatDates: ReturnType<typeof useFormatDates>;
  comparisonEnabled: boolean;
}

function findNearestDatum(
  data: ChartDataPoint[],
  targetDate: string,
  dataKey: string
): ChartDataPoint | null {
  let nearestDatum: ChartDataPoint | null = null;
  let minDiff = Infinity;
  const targetTime = new Date(targetDate).getTime();

  data.forEach((datum) => {
    const value = datum[dataKey];
    if (value !== undefined && value !== null) {
      const datumTime = new Date(datum.date).getTime();
      const diff = Math.abs(datumTime - targetTime);
      if (diff < minDiff) {
        minDiff = diff;
        nearestDatum = datum;
      }
    }
  });

  return nearestDatum;
}

function SubjectActiveDot({
  dataKey,
  fill,
  chartData,
  exactDate = false,
}: {
  dataKey: string;
  fill: string;
  chartData: ChartDataPoint[];
  exactDate?: boolean;
}) {
  const activeLabel = useActiveTooltipLabel();
  if (!activeLabel) return null;

  const nearestDatum = exactDate
    ? chartData.find((point) => point.date === String(activeLabel))
    : findNearestDatum(chartData, String(activeLabel), dataKey);
  if (!nearestDatum || nearestDatum[dataKey] === undefined) return null;

  const value = nearestDatum[dataKey];
  if (value === null) return null;

  return (
    <ReferenceDot
      x={nearestDatum.date}
      y={typeof value === "number" ? value : undefined}
      r={4}
      fill={fill}
      strokeWidth={0}
      opacity={0.8}
    />
  );
}

function CustomTooltipContent({
  active,
  label,
  chartData,
  chartConfig,
  formatDates,
  comparisonEnabled,
}: CustomTooltipContentProps) {
  const payload = Object.entries(chartConfig).map(([dataKey, config]) => {
    const nearestDatum = label
      ? comparisonEnabled
        ? chartData.find((point) => point.date === label)
        : findNearestDatum(chartData, label, dataKey)
      : undefined;
    const value = nearestDatum?.[dataKey];
    return {
      dataKey,
      value: value,
      color: config.color,
      name: dataKey === "referenceAverage" && nearestDatum?.referenceDate
        ? `${config.label} · ${formatDates.formatIntermediate(new Date(`${nearestDatum.referenceDate}T12:00:00`))}`
        : config.label,
      payload: nearestDatum,
    };
  });

  const validEntries = payload.filter(
    (entry) => entry.value !== null && entry.value !== undefined
  );

  return (
    <ChartTooltipContent
      active={active && !!label}
      label={label ? formatDates.formatShort(new Date(label)) : undefined}
      payload={validEntries.map((entry) => ({
        name: entry.name,
        value: typeof entry.value === "number" ? entry.value.toFixed(2) : "N/A",
        color: entry.color,
        dataKey: entry.dataKey,
        payload: null,
      }))}
    />
  );
}

export default function SubjectAverageChart({
  subjectId,
  period,
  subjects,
  periods,
  showSubSubjects,
}: {
  subjectId: string;
  period: Period;
  subjects: Subject[];
  periods: Period[];
  showSubSubjects: boolean;
}) {
  const formatter = useFormatter();
  const t = useTranslations("Dashboard.Charts.SubjectAverageChart");
  const comparisonT = useTranslations("YearComparison");
  const formatDates = useFormatDates(formatter);
  const { settings, isLoaded } = useChartSettings();
  const showTrendLine = isLoaded && settings.showTrendLine;
  const { isActive: timelineEnabled, snapshotDate } = useTimelineModeState();
  const comparison = useYearComparison(period.id, subjectId);
  const comparisonEnabled = comparison.active && comparison.ready && !subjectId.startsWith("ca");
  const currentLabel = comparison.currentYear?.name ?? t("average");
  const referenceLabel = comparison.referenceYear?.name ?? "";

  const { childrenAverage, chartData, chartConfig, yAxisDomain, hasReferenceData } = (() => {
    const childrenIds = getChildren(subjects, subjectId);
    const chartPeriod = comparisonEnabled && period.id === "full-year" && comparison.currentYear
      ? { ...period, startAt: comparison.currentYear.startDate, endAt: comparison.currentYear.endDate }
      : period;
    const endDate = startOfDay(
      getVisibleChartEndDate(new Date(chartPeriod.endAt), {
        snapshotDate: timelineEnabled ? snapshotDate : null,
      })
    );
    const startDate = startOfDay(getCumulativeStartDate(periods, chartPeriod));
    const chartSubjects = comparisonEnabled
      ? comparison.scopeCurrentSubjects(subjects)
      : subjects;

    const dates: Date[] = [];
    for (
      let dt = new Date(startDate);
      dt <= endDate;
      dt.setDate(dt.getDate() + 1)
    ) {
      dates.push(new Date(dt));
    }

    const mainSubject = subjects.find((s) => s.id === subjectId);
    let childrenObjects = subjects.filter((subj) =>
      childrenIds.includes(subj.id)
    );

    childrenObjects = childrenObjects.filter(
      (child) => child.depth === (mainSubject?.depth ?? 0) + 1
    );

    const childrenAverage = showSubSubjects
      ? childrenObjects.map((child, index) => ({
      id: child.id,
      name: child.name,
      average: averageOverTime(chartSubjects, child.id, chartPeriod, periods),
      color: predefinedColors[index % predefinedColors.length],
      }))
      : [];

    const mainAverages = averageOverTime(chartSubjects, subjectId, chartPeriod, periods);
    const referenceSeries = comparisonEnabled
      ? comparison.getReferenceSeries(dates.map((date) => date.toISOString()), subjectId)
      : [];
    let currentAverage: number | null = null;
    const childAverages: Record<string, number | null> = {};

    const baseChartData = dates.map((date, index) => {
      currentAverage = mainAverages[index] ?? currentAverage;
      return {
        date: date.toISOString(),
        average: comparisonEnabled ? currentAverage : mainAverages[index],
        referenceAverage: referenceSeries[index]?.value ?? null,
        referenceDate: referenceSeries[index]?.referenceDate ?? null,
        ...Object.fromEntries(
          childrenAverage.map((child) => {
            childAverages[child.id] = child.average[index] ?? childAverages[child.id] ?? null;
            return [child.id, comparisonEnabled ? childAverages[child.id] : child.average[index]];
          })
        ),
      };
    });

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
      ...Object.fromEntries(
        childrenAverage.map((child) => [
          child.id,
          {
            label: comparisonEnabled ? `${child.name} · ${currentLabel}` : child.name,
            color: child.color,
          },
        ])
      ),
      ...(comparisonEnabled ? {
        referenceAverage: {
          label: referenceLabel,
          color: "var(--chart-2)",
        },
      } : {}),
    };

    // Calculate Y-axis domain based on all numeric values in chartData
    const yAxisDomain = calculateYAxisDomain(
      chartData,
      0,
      20,
      "all",
      settings.autoZoomYAxis
    );

    return {
      childrenAverage,
      chartData,
      chartConfig,
      yAxisDomain,
      hasReferenceData: referenceSeries.some((point) => point.value !== null),
    };
  })();

  return (
    <Card className="p-4">
      {comparisonEnabled && (
        <div className="space-y-2 pb-4 text-xs text-muted-foreground">
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            <span className="flex items-center gap-2"><span aria-hidden="true" className="w-6 border-t-2 border-[var(--chart-1)]" />{currentLabel}</span>
            <span className="flex items-center gap-2"><span aria-hidden="true" className="w-6 border-t-2 border-dashed border-[var(--chart-2)]" />{referenceLabel}</span>
          </div>
          <p>{comparisonT("chartAlignment")}</p>
          {!hasReferenceData && <p>{comparisonT("noChartData")}</p>}
        </div>
      )}
      <ChartContainer config={chartConfig} className="h-[400px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ left: -20 }}>
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
                  chartConfig={chartConfig}
                  formatDates={formatDates}
                  comparisonEnabled={comparisonEnabled}
                />
              )}
            />

            {childrenAverage?.map((child) => (
              <Line
                key={child.id}
                dataKey={child.id}
                type={comparisonEnabled ? "stepAfter" : "monotone"}
                stroke={child.color}
                connectNulls={true}
                dot={false}
                activeDot={false}
              />
            ))}

            <Line
              dataKey="average"
              type={comparisonEnabled ? "stepAfter" : "monotone"}
              stroke="var(--chart-1)"
              strokeWidth={3}
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

            {childrenAverage?.map((child) => (
              <SubjectActiveDot
                key={child.id}
                dataKey={child.id}
                fill={child.color}
                chartData={chartData}
                exactDate={comparisonEnabled}
              />
            ))}
            <SubjectActiveDot
              dataKey="average"
              fill="var(--chart-1)"
              chartData={chartData}
              exactDate={comparisonEnabled}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </Card>
  );
}
