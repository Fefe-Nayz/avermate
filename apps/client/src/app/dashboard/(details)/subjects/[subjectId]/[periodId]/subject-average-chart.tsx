"use client";

import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Period } from "@/types/period";
import { Subject } from "@/types/subject";
import { averageOverTime, getChildren } from "@/utils/average";
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
}: {
  dataKey: string;
  fill: string;
  chartData: ChartDataPoint[];
}) {
  const activeLabel = useActiveTooltipLabel();
  if (!activeLabel) return null;

  const nearestDatum = findNearestDatum(chartData, activeLabel, dataKey);
  if (!nearestDatum || nearestDatum[dataKey] === undefined) return null;

  const value = nearestDatum[dataKey];
  if (value === null) return null;

  return (
    <ReferenceDot
      x={nearestDatum.date}
      y={typeof value === 'number' ? value : undefined}
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
}: CustomTooltipContentProps) {
  if (!active || !label) return null;

  const payload = Object.entries(chartConfig).map(([dataKey, config]) => {
    const nearestDatum = findNearestDatum(chartData, label, dataKey);
    const value = nearestDatum?.[dataKey];
    return {
      dataKey,
      value: value,
      color: config.color,
      name: config.label,
      payload: nearestDatum,
    };
  });

  const validEntries = payload.filter((entry) => entry.value !== null && entry.value !== undefined);

  return (
    <ChartTooltipContent
      active={true}
      label={formatDates.formatShort(new Date(label))}
      payload={validEntries.map((entry) => ({
        name: entry.name,
        value: typeof entry.value === 'number' ? entry.value.toFixed(2) : 'N/A',
        color: entry.color,
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
}: {
  subjectId: string;
  period: Period;
  subjects: Subject[];
  periods: Period[];
}) {
  const formatter = useFormatter();
  const t = useTranslations("Dashboard.Charts.SubjectAverageChart");
  const formatDates = useFormatDates(formatter);

  const { childrenAverage, chartData, chartConfig } = (() => {
    const childrenIds = getChildren(subjects, subjectId);
    const endDate = new Date(period.endAt);
    const startDate = getCumulativeStartDate(periods, period);

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

    const childrenAverage = childrenObjects.map((child, index) => ({
      id: child.id,
      name: child.name,
      average: averageOverTime(subjects, child.id, period, periods),
      color: predefinedColors[index % predefinedColors.length],
    }));

    const mainAverages = averageOverTime(subjects, subjectId, period, periods);

    const chartData = dates.map((date, index) => ({
      date: date.toISOString(),
      average: mainAverages[index],
      ...Object.fromEntries(
        childrenAverage.map((child) => [child.id, child.average[index]])
      ),
    }));

    const chartConfig = {
      average: {
        label: t("average"),
        color: "#2662d9",
      },
      ...Object.fromEntries(
        childrenAverage.map((child) => [
          child.id,
          {
            label: child.name,
            color: child.color,
          },
        ])
      ),
    };

    return { childrenAverage, chartData, chartConfig };
  })();

  return (
    <Card className="p-4">
      <ChartContainer config={chartConfig} className="h-[400px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ left: -30 }}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="date"
              tickLine={false}
              axisLine={false}
              tickMargin={8}
              tickFormatter={(value) => formatDates.formatShort(new Date(value))}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              domain={[0, 20]}
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
                />
              )}
            />

            {childrenAverage?.map((child) => (
              <Line
                key={child.id}
                dataKey={child.id}
                type="monotone"
                stroke={child.color}
                connectNulls={true}
                dot={false}
                activeDot={false}
              />
            ))}

            <Line
              dataKey="average"
              type="monotone"
              stroke="#2662d9"
              strokeWidth={3}
              connectNulls={true}
              dot={false}
              activeDot={false}
            />

            {childrenAverage?.map((child) => (
              <SubjectActiveDot
                key={child.id}
                dataKey={child.id}
                fill={child.color}
                chartData={chartData}
              />
            ))}
            <SubjectActiveDot
              dataKey="average"
              fill="#2662d9"
              chartData={chartData}
            />
          </LineChart>
        </ResponsiveContainer>
      </ChartContainer>
    </Card>
  );
}
