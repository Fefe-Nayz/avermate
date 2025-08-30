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
import { average, averageOverTime } from "@/utils/average";
import { BookOpenIcon, PlusCircleIcon } from "@heroicons/react/24/outline";
import { useState, useCallback } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";
import AddGradeDialog from "../dialogs/add-grade-dialog";
import { SubjectEmptyState } from "../empty-states/subject-empty-state";
import { Button } from "../ui/button";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";

function getCumulativeStartDate(
  periods: Period[],
  currentPeriod: Period
): Date {
  if (currentPeriod.id === "full-year") {
    // full-year => keep your existing logic or just use currentPeriod.startAt
    return new Date(currentPeriod.startAt);
  }

  // Sort by start date
  const sorted = [...periods].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );
  const currentIndex = sorted.findIndex((p) => p.id === currentPeriod.id);

  if (currentIndex === -1) {
    // fallback
    return new Date(currentPeriod.startAt);
  }

  if (currentPeriod.isCumulative) {
    // earliest is from the first period
    return new Date(sorted[0].startAt);
  }

  return new Date(currentPeriod.startAt);
}

export const description = "A simple area chart";

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

  const formatDates = useFormatDates(formatter);

  // Update state to use single index instead of indices
  const [activeTooltipIndex, setActiveTooltipIndex] = useState<number | null>(
    null
  );

  // Update callback to handle single index
  const handleActiveTooltipIndexChange = useCallback((index: number | null) => {
    setActiveTooltipIndex(index);
  }, []);

  // Calculate the start and end dates
  const endDate = new Date(period.endAt);
  const startDate = getCumulativeStartDate(periods, period);

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
  const averages = averageOverTime(subjects, undefined, period, periods);

  const chartData = dates.map((date, index) => ({
    date: date.toISOString(),
    average: averages[index],
  }));

  const chartConfig = {
    average: {
      label: t("average"),
      color: "#2662d9",
    },
  };

  // Calculate average grades per subject for radar chart, only if it is a main subject
  const subjectAverages = subjects
    .filter((subject) => subject.isMainSubject)
    .map((subject) => {
      const averageGrade = average(subject.id, subjects);
      const validAverage = averageGrade ?? 0;
      return {
        subject: subject.name,
        average: validAverage,
        fullMark: 20,
      };
    });

  const radarData = subjectAverages;

  const renderPolarAngleAxis = ({
    payload,
    x,
    y,
    cx,
    cy,
  }: {
    payload: { value: string };
    x: number;
    y: number;
    cx: number;
    cy: number;
  }) => {
    // Calculate the angle in radians between the label position and the center
    const radius = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
    const angle = Math.atan2(y - cy, x - cx);

    // Determine the truncate length based on screen width
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
      payload.value.length > truncateLength
        ? `${payload.value.slice(0, truncateLength)}...`
        : payload.value;

    // Adjust the radius to move the labels inside
    const labelRadius = radius - truncatedLabel.length * 3 + 10;

    // Calculate new label positions
    const nx = cx + labelRadius * Math.cos(angle);
    const ny = cy + labelRadius * Math.sin(angle);

    // Convert angle to degrees for rotation
    let rotation = (angle * 180) / Math.PI;

    // Flip text if rotation is beyond 90 degrees
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

  // Update CustomDot component to use single index
  const CustomDot = (props: any) => {
    const { cx, cy, index, stroke } = props;
    if (activeTooltipIndex !== null && index === activeTooltipIndex) {
      return <circle cx={cx} cy={cy} r={4} fill={stroke} opacity={0.8} />;
    }
    return null;
  };

  // Handle if there are no subjects
  if (subjects.length === 0) {
    return <SubjectEmptyState />;
  }

  // If all the averages are null
  if (chartData.every((data) => data.average === null)) {
    return (
      <Card className="lg:col-span-5 flex flex-col justify-center items-center p-6 gap-8 w-full h-full">
        <BookOpenIcon className="w-12 h-12" />
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-xl font-semibold text-center">
            {t("noGradesTitle")}
          </h2>
          <p className="text-center">{t("noGradesDescription")}</p>
        </div>
        <AddGradeDialog yearId={yearId}>
          <Button variant="outline">
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addGrade")}
          </Button>
        </AddGradeDialog>
      </Card>
    );
  }

  return (
    <Card className="lg:col-span-5">
      <CardHeader>
        <CardTitle>{t("globalAverageTitle")}</CardTitle>
      </CardHeader>

      <CardContent>
        <div className="flex items-start lg:space-x-4 text-sm flex-wrap lg:flex-nowrap h-fit justify-center gap-[10px] flex-col lg:flex-row pt-2">
          {/* Area Chart Section */}
          <div className="flex flex-col items-center lg:items-start grow min-w-0 my-0 mx-auto w-[100%] lg:w-[60%]">
            <CardDescription className="pb-8">
              {t("areaChartDescription")}
            </CardDescription>
            <ChartContainer config={chartConfig} className="h-[302px] w-[100%]">
              <AreaChart data={chartData} margin={{ left: -30 }}>
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
                  domain={[0, 20]}
                  tickMargin={8}
                  tickCount={5}
                />
                <ChartTooltip
                  filterNull={false}
                  cursor={false}
                  content={
                    <ChartTooltipContent
                      chartData={chartData}
                      findNearestNonNull={true}
                      dataKey="average"
                      labelFormatter={(value) => value}
                      valueFormatter={(val) => val.toFixed(2)}
                      onUpdateActiveTooltipIndex={
                        handleActiveTooltipIndexChange
                      }
                    />
                  }
                  labelFormatter={(value) =>
                    formatDates.formatShort(new Date(value))
                  }
                />
                <defs>
                  <linearGradient id="fillAverage" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#2662d9" stopOpacity={0.8} />
                    <stop offset="95%" stopColor="#2662d9" stopOpacity={0.1} />
                  </linearGradient>
                </defs>
                <Area
                  dataKey="average"
                  type="monotone"
                  fill="url(#fillAverage)"
                  stroke="#2662d9"
                  connectNulls={true}
                  activeDot={false}
                  dot={(props) => {
                    const { key, ...rest } = props;
                    return (
                      <CustomDot
                        key={key}
                        {...rest}
                        dataKey="average"
                        activeTooltipIndex={activeTooltipIndex}
                      />
                    );
                  }}
                />
              </AreaChart>
            </ChartContainer>
          </div>

          <Separator
            orientation="vertical"
            className="hidden lg:block h-[360px]"
          />

          {/* Radar Chart Section */}
          <div className="flex flex-col items-center lg:space-y-2 lg:w-[40%] m-auto lg:pt-0 pt-8 w-[100%]">
            <CardDescription>{t("radarChartDescription")}</CardDescription>
            <ChartContainer
              config={chartConfig}
              className="h-[332px] w-[100%] m-auto !aspect-auto"
            >
              <RadarChart data={radarData} outerRadius="90%">
                <PolarGrid />
                <PolarAngleAxis dataKey="subject" tick={renderPolarAngleAxis} />
                <Radar
                  dataKey="average"
                  stroke="#2662d9"
                  fill="#2662d9"
                  fillOpacity={0.6}
                />
                <PolarRadiusAxis domain={[0, 20]} stroke="#a1a1aa" />
                <ChartTooltip
                  content={
                    <ChartTooltipContent
                      valueFormatter={(val) => val.toFixed(2)}
                    />
                  }
                />
              </RadarChart>
            </ChartContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
