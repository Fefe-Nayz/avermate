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
import { getChildren } from "@/utils/average";
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
import { PartialGrade } from "@/types/grade";
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

function getRelevantPeriodIds(period: Period, periods: Period[]): string[] {
    if (period.id === "full-year") {
        return [];
    }

    const sorted = [...periods].sort(
        (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
    );
    const currentIndex = sorted.findIndex((p) => p.id === period.id);

    if (currentIndex === -1) {
        return [period.id];
    }

    if (period.isCumulative) {
        return sorted.slice(0, currentIndex + 1).map((p) => p.id);
    }

    return [period.id];
}

interface GradeDataPoint {
    date: string;
    grade: number | null;
    gradeName: string | null;
    subjectName: string | null;
    value: number | null;
    outOf: number | null;
    [key: string]: string | number | null;
}

interface ChartConfig {
    [key: string]: {
        label: string;
        color: string;
    };
}

function findNearestDatum(
    data: GradeDataPoint[],
    targetDate: string
): GradeDataPoint | null {
    let nearestDatum: GradeDataPoint | null = null;
    let minDiff = Infinity;
    const targetTime = new Date(targetDate).getTime();

    data.forEach((datum) => {
        if (datum.grade === null) return;

        const datumTime = new Date(datum.date).getTime();
        const diff = Math.abs(datumTime - targetTime);

        if (diff < minDiff) {
            minDiff = diff;
            nearestDatum = datum;
        }
    });

    return nearestDatum;
}

function GradeActiveDot({ chartData }: { chartData: GradeDataPoint[] }) {
    const activeLabel = useActiveTooltipLabel();
    if (!activeLabel) return null;

    const nearestDatum = findNearestDatum(chartData, String(activeLabel));
    if (!nearestDatum || nearestDatum.grade === null) return null;

    return (
        <ReferenceDot
            x={nearestDatum.date}
            y={nearestDatum.grade}
            r={5}
            fill="var(--chart-1)"
            strokeWidth={0}
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
    chartData: GradeDataPoint[];
    formatDates: ReturnType<typeof useFormatDates>;
    currentLabel?: string;
    referenceLabel?: string;
}) {
    const nearestDatum = label ? findNearestDatum(chartData, label) : undefined;
    const hasValidData = !!(nearestDatum && nearestDatum.grade !== null);
    const selectedDatum = chartData.find((point) => point.date === label);
    const referenceAverage = selectedDatum?.referenceAverage;

    return (
        <ChartTooltipContent
            active={active && !!label}
            label={label ? formatDates.formatShort(new Date(label)) : undefined}
            payload={[
                ...(hasValidData
                    ? [
                        {
                            name: currentLabel
                                ? `${currentLabel} · ${nearestDatum.subjectName ?? ""} · ${formatDates.formatIntermediate(new Date(nearestDatum.date))}`
                                : nearestDatum.subjectName || "",
                            value: currentLabel
                                ? `${nearestDatum.grade!.toFixed(2)}/20 (${nearestDatum.value! / 100}/${nearestDatum.outOf! / 100})`
                                : `${nearestDatum.value! / 100}/${nearestDatum.outOf! / 100}`,
                            color: "var(--chart-1)",
                            dataKey: "grade",
                            payload: null,
                        },
                    ]
                    : []),
                ...(referenceLabel && typeof referenceAverage === "number" && selectedDatum?.referenceDate
                    ? [{
                        name: `${referenceLabel} · ${formatDates.formatIntermediate(new Date(`${selectedDatum.referenceDate}T12:00:00`))}`,
                        value: `${referenceAverage.toFixed(2)}/20`,
                        color: "var(--chart-2)",
                        dataKey: "referenceAverage",
                        payload: null,
                    }]
                    : []),
            ]}
        />
    );
}

export default function SubjectGradesChart({
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
    const t = useTranslations("Dashboard.Charts.SubjectGradesChart");
    const comparisonT = useTranslations("YearComparison");
    const formatDates = useFormatDates(formatter);
    const { settings, isLoaded } = useChartSettings();
    const showTrendLine = isLoaded && settings.showTrendLine;
    const { isActive: timelineEnabled, snapshotDate } = useTimelineModeState();
    const comparison = useYearComparison(period.id, subjectId);
    const comparisonEnabled = comparison.active && comparison.ready;
    const currentLabel = comparison.currentYear?.name ?? t("grades");
    const referenceLabel = comparisonT("referenceAverage", { year: comparison.referenceYear?.name ?? "" });

    const { chartData, chartConfig, yAxisDomain, hasGrades, hasReferenceData } = React.useMemo(() => {
        const chartPeriod = comparisonEnabled && period.id === "full-year" && comparison.currentYear
            ? { ...period, startAt: comparison.currentYear.startDate, endAt: comparison.currentYear.endDate }
            : period;
        const visibleEndDate = getVisibleChartEndDate(new Date(chartPeriod.endAt), {
            snapshotDate: timelineEnabled ? snapshotDate : null,
        });
        const endDate = comparisonEnabled ? startOfDay(visibleEndDate) : visibleEndDate;
        const periodStartDate = getCumulativeStartDate(periods, chartPeriod);
        const startDate = comparisonEnabled ? startOfDay(periodStartDate) : periodStartDate;
        const chartSubjects = comparisonEnabled
            ? comparison.scopeCurrentSubjects(subjects)
            : subjects;
        const childrenIds = getChildren(subjects, subjectId);
        const allSubjectIds = [subjectId, ...childrenIds];
        const relevantPeriodIds = getRelevantPeriodIds(period, periods);

        // Collect all grades from the subject and its children
        const allGrades: (PartialGrade & { subjectName: string })[] = [];

        for (const sid of allSubjectIds) {
            const subj = chartSubjects.find((s) => s.id === sid);
            if (!subj) continue;

            const grades =
                period.id === "full-year"
                    ? subj.grades
                    : subj.grades.filter((g) =>
                        relevantPeriodIds.includes(g.periodId ?? "")
                    );

            for (const grade of grades) {
                allGrades.push({
                    ...grade,
                    subjectName: subj.name,
                });
            }
        }

        // Sort grades by date
        allGrades.sort(
            (a, b) => new Date(a.passedAt).getTime() - new Date(b.passedAt).getTime()
        );

        // Generate date range for x-axis
        const dates: Date[] = [];
        for (
            let dt = new Date(startDate);
            dt <= endDate;
            dt.setDate(dt.getDate() + 1)
        ) {
            dates.push(new Date(dt));
        }

        // Create chart data with grades mapped to dates
        const baseChartData: GradeDataPoint[] = dates.map((date) => {
            const dateStr = comparisonEnabled ? startOfDay(date).getTime() : date.toISOString().split("T")[0];
            const gradeOnDate = allGrades.find(
                (g) => (comparisonEnabled
                    ? startOfDay(new Date(g.passedAt)).getTime()
                    : new Date(g.passedAt).toISOString().split("T")[0]) === dateStr
            );

            if (gradeOnDate) {
                return {
                    date: date.toISOString(),
                    grade: (gradeOnDate.value / gradeOnDate.outOf) * 20,
                    gradeName: gradeOnDate.name,
                    subjectName: gradeOnDate.subjectName,
                    value: gradeOnDate.value,
                    outOf: gradeOnDate.outOf,
                };
            }

            return {
                date: date.toISOString(),
                grade: null,
                gradeName: null,
                subjectName: null,
                value: null,
                outOf: null,
            };
        });

        const trendLine = showTrendLine
            ? calculateTrendLineData(baseChartData, "grade", { subdivisions: settings.trendLineSubdivisions })
            : baseChartData.map(() => null);
        const referenceSeries = comparisonEnabled
            ? comparison.getReferenceSeries(dates.map((date) => date.toISOString()), subjectId)
            : [];
        const chartData = baseChartData.map((point, index) => ({
            ...point,
            trendLine: trendLine[index],
            referenceAverage: referenceSeries[index]?.value ?? null,
            referenceDate: referenceSeries[index]?.referenceDate ?? null,
        }));

        const chartConfig: ChartConfig = {
            grade: {
                label: comparisonEnabled ? currentLabel : t("grades"),
                color: "var(--chart-1)",
            },
            referenceAverage: {
                label: referenceLabel,
                color: "var(--chart-2)",
            },
        };

        const yAxisDomain = calculateYAxisDomain(
            chartData,
            0,
            20,
            ["grade", "trendLine", "referenceAverage"],
            settings.autoZoomYAxis
        );

        return {
            chartData,
            chartConfig,
            yAxisDomain,
            hasGrades: comparisonEnabled ? baseChartData.some((point) => point.grade !== null) : allGrades.length > 0,
            hasReferenceData: referenceSeries.some((point) => point.value !== null),
        };
    }, [
        comparisonEnabled,
        comparison.currentYear,
        comparison.getReferenceSeries,
        comparison.scopeCurrentSubjects,
        currentLabel,
        referenceLabel,
        period,
        periods,
        settings.autoZoomYAxis,
        settings.trendLineSubdivisions,
        showTrendLine,
        snapshotDate,
        subjectId,
        subjects,
        t,
        timelineEnabled,
    ]);

    if (!hasGrades && !hasReferenceData) {
        return (
            <Card className="p-4">
                <div className="h-[400px] flex items-center justify-center text-muted-foreground">
                    {t("noGrades")}
                </div>
            </Card>
        );
    }

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
                                    formatDates={formatDates}
                                    currentLabel={comparisonEnabled ? currentLabel : undefined}
                                    referenceLabel={comparisonEnabled ? referenceLabel : undefined}
                                />
                            )}
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
                        <Line
                            dataKey="grade"
                            type="monotone"
                            stroke="var(--chart-1)"
                            strokeWidth={2}
                            connectNulls={true}
                            dot={{ r: 4, fill: "var(--chart-1)", strokeWidth: 0 }}
                            activeDot={false}
                        />
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
                        <GradeActiveDot chartData={chartData} />
                    </LineChart>
                </ResponsiveContainer>
            </ChartContainer>
        </Card>
    );
}
