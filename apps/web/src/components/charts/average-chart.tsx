"use client";

import { useMemo } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  XAxis,
  YAxis,
} from "recharts";
import { useFormatter, useExtracted } from "next-intl";
import { trendLine, type SeriesPoint } from "@avermate/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { useYear } from "@/components/year/year-provider";
import { usePreferences } from "@/hooks/use-preferences";

/**
 * The average over time.
 *
 * The y-axis zooms to the data by default rather than spanning 0–20: a year
 * spent between 12 and 14 is a flat line on a full-scale axis, which hides
 * exactly the movement the chart exists to show. The full scale stays one
 * setting away for anyone who wants the honest-looking version.
 */
export function AverageChart({
  title,
  series,
  emptyHint,
  height = 220,
}: {
  title: string;
  series: SeriesPoint[];
  emptyHint?: string;
  height?: number;
}) {
  const t = useExtracted();
  const format = useFormatter();
  const { scale, passingRatio } = useYear();
  const { preferences } = usePreferences();
  const settings = preferences.chartSettings;

  const data = useMemo(() => {
    const trend = settings.showTrend ? trendLine(series) : [];
    return series.map((point, index) => ({
      date: point.date.getTime(),
      value: point.ratio === null ? null : point.ratio * scale,
      trend:
        trend[index]?.ratio === null || trend[index] === undefined
          ? null
          : (trend[index]?.ratio as number) * scale,
    }));
  }, [series, scale, settings.showTrend]);

  const domain = useMemo<[number, number]>(() => {
    if (!settings.autoZoom) return [0, scale];
    const values = data
      .map((point) => point.value)
      .filter((value): value is number => value !== null);
    if (values.length === 0) return [0, scale];

    const min = Math.min(...values);
    const max = Math.max(...values);
    const padding = Math.max((max - min) * 0.2, scale * 0.02);
    return [
      Math.max(0, Number((min - padding).toFixed(2))),
      Math.min(scale, Number((max + padding).toFixed(2))),
    ];
  }, [data, scale, settings.autoZoom]);

  if (series.length < 2) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="py-8 text-center text-sm text-muted-foreground">
            {emptyHint ?? t("Not enough data yet")}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="gap-3 py-4">
      <CardHeader className="px-4">
        <CardTitle className="text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-2">
        <ChartContainer
          config={{
            value: { label: t("Average"), color: "var(--chart-1)" },
            trend: { label: t("Trend"), color: "var(--muted-foreground)" },
          }}
          style={{ height }}
          className="w-full"
        >
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <defs>
                <linearGradient id="average-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--chart-1)" stopOpacity={0.25} />
                  <stop offset="100%" stopColor="var(--chart-1)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.4} />
              <XAxis
                dataKey="date"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickLine={false}
                axisLine={false}
                minTickGap={40}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickFormatter={(value: number) =>
                  format.dateTime(new Date(value), {
                    day: "numeric",
                    month: "short",
                  })
                }
              />
              <YAxis
                domain={domain}
                width={34}
                tickLine={false}
                axisLine={false}
                tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                tickFormatter={(value: number) =>
                  format.number(value, { maximumFractionDigits: 1 })
                }
              />
              <ReferenceLine
                y={passingRatio * scale}
                stroke="var(--muted-foreground)"
                strokeDasharray="4 4"
                opacity={0.5}
              />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => {
                      const point = payload?.[0]?.payload as
                        | { date: number }
                        | undefined;
                      return point
                        ? format.dateTime(new Date(point.date), {
                            day: "numeric",
                            month: "long",
                          })
                        : "";
                    }}
                  />
                }
              />
              <Area
                type="monotone"
                dataKey="value"
                stroke="var(--chart-1)"
                strokeWidth={2}
                fill="url(#average-fill)"
                connectNulls
                dot={settings.showPoints && data.length < 40}
                isAnimationActive={false}
              />
              {settings.showTrend ? (
                <Line
                  type="linear"
                  dataKey="trend"
                  stroke="var(--muted-foreground)"
                  strokeDasharray="5 4"
                  strokeWidth={1.5}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ) : null}
            </AreaChart>
          </ResponsiveContainer>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
