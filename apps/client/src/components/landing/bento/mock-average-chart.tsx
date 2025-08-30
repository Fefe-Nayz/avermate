"use client";

import { type TickProps } from "@/components/charts/global-average-chart";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";
import { SubjectEmptyState } from "@/components/empty-states/subject-empty-state";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartTooltipContent as BaseChartTooltipContent,
  ChartContainer,
  ChartTooltip,
} from "@/components/ui/chart";
import { Separator } from "@/components/ui/separator";
import { useLocalizedSubjects } from "@/data/mock";
import { average, averageOverTime } from "@/utils/average";
import { useFormatDates } from "@/utils/format";
import { BookOpenIcon, PlusCircleIcon } from "@heroicons/react/24/outline";
import { useFormatter, useTranslations } from "next-intl";
import * as React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  Radar,
  RadarChart,
  XAxis,
  YAxis,
} from "recharts";

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{
    value: number;
    name?: string;
    dataKey?: string;
    color?: string;
  }>;
  label?: string;
  className?: string;
  valueFormatter?: (value: number) => string;
}

const CustomTooltipContent: React.FC<CustomTooltipProps> = ({
  active,
  payload,
  label,
  className,
  valueFormatter = (value) => value.toString(),
}) => {
  if (!active || !payload?.length) {
    return null;
  }

  return (
    <BaseChartTooltipContent
      active={active}
      payload={payload.map((item) => ({
        name: item.name,
        value:
          typeof item.value === "number"
            ? valueFormatter(item.value)
            : item.value,
        color: item.color,
      }))}
      label={label}
      className={className}
    />
  );
};

const renderPolarAngleAxis = (props: TickProps) => {
  const x = Number(props.x ?? 0);
  const y = Number(props.y ?? 0);
  const cx = Number(props.cx ?? 0);
  const cy = Number(props.cy ?? 0);

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

  const value = props.payload?.value ?? "";
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

export const MockAverageChart = () => {
  const formatter = useFormatter();
  const t = useTranslations("Landing.Product.Mocks.Charts");
  const localizedSubjects = useLocalizedSubjects();
  const formatDates = useFormatDates(formatter);

  const period = {
    id: "full-year",
    name: t("fullYear"),
    startAt: new Date(new Date().getFullYear(), 8, 1).toISOString(),
    endAt: new Date(new Date().getFullYear() + 1, 5, 30).toISOString(),
    userId: "",
    createdAt: "",
    isCumulative: true,
  };

  // Calculate the start and end dates
  const endDate = new Date(period.endAt);
  const startDate = new Date(period.startAt);

  // Generate an array of dates
  const dates = [];
  for (
    let dt = new Date(startDate);
    dt <= endDate;
    dt.setDate(dt.getDate() + 1)
  ) {
    dates.push(new Date(dt));
  }

  // Calculate the average grades over time
  const averages = averageOverTime(localizedSubjects, undefined, period, []);

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
  const subjectAverages = localizedSubjects
    .filter((subject) => subject.isMainSubject)
    .map((subject) => {
      const averageGrade = average(subject.id, localizedSubjects);
      const validAverage = averageGrade ?? 0;
      return {
        subject: subject.name,
        average: validAverage,
        fullMark: 20,
      };
    });

  const radarData = subjectAverages;

  // Custom dot component
  const CustomDot = ({
    cx,
    cy,
    index,
    stroke,
    activeTooltipIndex,
  }: {
    cx?: number;
    cy?: number;
    index?: number;
    stroke?: string;
    activeTooltipIndex?: number | null;
  }) => {
    if (activeTooltipIndex !== null && index === activeTooltipIndex) {
      return <circle cx={cx} cy={cy} r={4} fill={stroke} opacity={0.8} />;
    }
    return null;
  };

  // handle if there are no subjects
  if (localizedSubjects.length === 0) {
    return <SubjectEmptyState />;
  }

  // if all the averages are null
  if (chartData.every((data) => data.average === null)) {
    return (
      <Card className="lg:col-span-5 flex flex-col justify-center items-center p-6 gap-8 w-full h-full">
        <BookOpenIcon className="w-12 h-12" />
        <div className="flex flex-col items-center gap-1">
          <h2 className="text-xl font-semibold text-center">
            {t("noGradesYet")}
          </h2>
          <p className="text-center">{t("addGradeToStartTracking")}</p>
        </div>
        <AddGradeDialog>
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
        <CardTitle>{t("overallAverage")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-start lg:space-x-4 text-sm flex-wrap lg:flex-nowrap h-fit justify-center gap-[10px] flex-col lg:flex-row pt-2">
          <div className="flex flex-col items-center lg:items-start grow min-w-0 my-0 mx-auto w-[100%] lg:w-[60%]">
            <CardDescription className="pb-8">
              {t("visualizeOverallAverage")}
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
                  content={(props) => (
                    <CustomTooltipContent
                      {...props}
                      label={props.label ? props.label.toString() : undefined}
                      valueFormatter={(value) => value.toFixed(2)}
                    />
                  )}
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
                  fill="#2662d9"
                  stroke="#2662d9"
                  fillOpacity={0.1}
                  strokeWidth={2}
                  connectNulls={true}
                  dot={false}
                  activeDot={false}
                />
              </AreaChart>
            </ChartContainer>
          </div>

          <Separator
            orientation="vertical"
            className="hidden lg:block h-[360px]"
          />

          <div className="flex flex-col items-center lg:space-y-2 lg:w-[40%] m-auto lg:pt-0 pt-8 w-[100%]">
            <CardDescription>{t("visualizeAverageBySubject")}</CardDescription>
            <ChartContainer
              config={chartConfig}
              className="h-[332px] w-[100%] m-auto !aspect-auto"
            >
              <RadarChart data={radarData} outerRadius="90%">
                <PolarGrid />
                <PolarAngleAxis dataKey="subject" tick={renderPolarAngleAxis} />
                <Radar
                  dataKey="average"
                  fillOpacity={0.1}
                  stroke="#2662d9"
                  fill="#2662d9"
                />
                <ChartTooltip
                  cursor={false}
                  content={(props) => (
                    <CustomTooltipContent
                      {...props}
                      label={props.label ? props.label.toString() : undefined}
                      valueFormatter={(value) => value.toFixed(2)}
                    />
                  )}
                />
              </RadarChart>
            </ChartContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
};
