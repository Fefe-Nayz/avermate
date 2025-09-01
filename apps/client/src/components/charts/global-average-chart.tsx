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
import {
  Area,
  AreaChart,
  CartesianGrid,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
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
}

function findNearestDatum(data: ChartDataPoint[], targetDate: string): ChartDataPoint | null {
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

function GlobalActiveDot({
  chartData,
}: {
  chartData: ChartDataPoint[];
}) {
  const activeLabel = useActiveTooltipLabel();
  if (!activeLabel) return null;

  const nearestDatum = findNearestDatum(chartData, activeLabel);
  if (!nearestDatum || nearestDatum.average === null) return null;

  return (
    <ReferenceDot
      x={nearestDatum.date}
      y={nearestDatum.average}
      r={4}
      fill="#2662d9"
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
}: {
  active?: boolean;
  label?: string;
  chartData: ChartDataPoint[];
  formatDates: ReturnType<typeof useFormatDates>;
}) {
  if (!active || !label) return null;

  const nearestDatum = findNearestDatum(chartData, label);
  const value = nearestDatum?.average ?? null;

  return (
    <ChartTooltipContent
      active={true}
      label={formatDates.formatShort(new Date(label))}
      payload={
        value !== null
          ? [
              {
                name: "Global Average",
                value: value.toFixed(2),
                color: "#2662d9",
                payload: null,
              },
            ]
          : []
      }
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
  const formatDates = useFormatDates(formatter);

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

  // Calculate average grades per subject for radar chart
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

  const renderPolarAngleAxis = (props: TickProps) => {
    const x = Number(props.x ?? 0);
    const y = Number(props.y ?? 0);
    const cx = Number(props.cx ?? 0);
    const cy = Number(props.cy ?? 0);
    const value = props.payload?.value ?? '';
    
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
  
    const truncatedLabel = value.length > truncateLength
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
  }

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
          <div className="flex flex-col items-center lg:items-start grow min-w-0 my-0 mx-auto w-full lg:w-[60%]">
            <CardDescription className="pb-8">
              {t("areaChartDescription")}
            </CardDescription>
            <ChartContainer config={chartConfig} className="h-[302px] w-full">
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
                  content={({ active, label }) => (
                    <CustomTooltipContent
                      active={active}
                      label={label ? label.toString() : undefined}
                      chartData={chartData}
                      formatDates={formatDates}
                    />
                  )}
                />
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
                <GlobalActiveDot chartData={chartData} />
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
                  fillOpacity={0.1}
                  stroke="#2662d9"
                  fill="#2662d9"
                  strokeWidth={2}
                />
                <PolarRadiusAxis domain={[0, 20]} stroke="#a1a1aa" />
                <ChartTooltip content={<ChartTooltipContent />} />
              </RadarChart>
            </ChartContainer>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
