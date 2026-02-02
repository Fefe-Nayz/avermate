"use client";

import { Card } from "@/components/ui/card";
import {
    ChartContainer,
    ChartTooltip,
    ChartTooltipContent,
} from "@/components/ui/chart";
import { Period } from "@/types/period";
import { Subject } from "@/types/subject";
import { getChildren } from "@/utils/average";
import { calculateYAxisDomain } from "@/utils/chart";
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
            fill="#2662d9"
            strokeWidth={0}
        />
    );
}

function CustomTooltipContent({
    active,
    label,
    chartData,
    formatDates,
}: {
    active?: boolean;
    label?: string;
    chartData: GradeDataPoint[];
    formatDates: ReturnType<typeof useFormatDates>;
}) {
    const nearestDatum = label ? findNearestDatum(chartData, label) : undefined;
    const hasValidData = !!(nearestDatum && nearestDatum.grade !== null);

    return (
        <ChartTooltipContent
            active={active && !!label && hasValidData}
            label={label ? formatDates.formatShort(new Date(label)) : undefined}
            payload={
                hasValidData
                    ? [
                        {
                            name: nearestDatum.subjectName || "",
                            value: `${nearestDatum.value! / 100}/${nearestDatum.outOf! / 100}`,
                            color: "#2662d9",
                            dataKey: "grade",
                            payload: null,
                        },
                    ]
                    : []
            }
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
    const formatDates = useFormatDates(formatter);

    const { chartData, chartConfig, yAxisDomain, hasGrades } = React.useMemo(() => {
        const childrenIds = getChildren(subjects, subjectId);
        const allSubjectIds = [subjectId, ...childrenIds];
        const relevantPeriodIds = getRelevantPeriodIds(period, periods);

        // Collect all grades from the subject and its children
        const allGrades: (PartialGrade & { subjectName: string })[] = [];

        for (const sid of allSubjectIds) {
            const subj = subjects.find((s) => s.id === sid);
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

        const hasGrades = allGrades.length > 0;

        // Generate date range for x-axis
        const endDate =
            new Date() < new Date(period.endAt) ? new Date() : new Date(period.endAt);
        const startDate = getCumulativeStartDate(periods, period);

        const dates: Date[] = [];
        for (
            let dt = new Date(startDate);
            dt <= endDate;
            dt.setDate(dt.getDate() + 1)
        ) {
            dates.push(new Date(dt));
        }

        // Create chart data with grades mapped to dates
        const chartData: GradeDataPoint[] = dates.map((date) => {
            const dateStr = date.toISOString().split("T")[0];
            const gradeOnDate = allGrades.find(
                (g) => new Date(g.passedAt).toISOString().split("T")[0] === dateStr
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

        const chartConfig: ChartConfig = {
            grade: {
                label: t("grades"),
                color: "#2662d9",
            },
        };

        // Calculate Y-axis domain (normalized to 20)
        const yAxisDomain = calculateYAxisDomain(
            chartData.filter((d) => d.grade !== null).map((d) => ({ average: d.grade })),
            0,
            20
        );

        return { chartData, chartConfig, yAxisDomain, hasGrades };
    }, [subjectId, period, subjects, periods, t]);

    if (!hasGrades) {
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
                                />
                            )}
                        />
                        <Line
                            dataKey="grade"
                            type="monotone"
                            stroke="#2662d9"
                            strokeWidth={2}
                            connectNulls={true}
                            dot={{ r: 4, fill: "#2662d9", strokeWidth: 0 }}
                            activeDot={false}
                        />
                        <GradeActiveDot chartData={chartData} />
                    </LineChart>
                </ResponsiveContainer>
            </ChartContainer>
        </Card>
    );
}
