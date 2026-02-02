import { Separator } from "@/components/ui/separator";
import {
  ArrowLeftIcon,
  EllipsisVerticalIcon,
} from "@heroicons/react/24/outline";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { ChartContainer } from "../ui/chart";
import { Skeleton } from "../ui/skeleton";
import { PlusCircleIcon } from "lucide-react";

export default function subjectLoader(t: any) {

  const chartConfig = {
    average: {
      label: "Average",
      color: "hsl(var(--primary))",
    },
  };

  const chartData = Array.from({ length: 20 }, (_, i) => ({
    date: `2024-${String(Math.floor(i / 4) + 1).padStart(2, '0')}-${String((i % 4) * 7 + 1).padStart(2, '0')}`,
    average: 10 + Math.random() * 8, // Random values between 10-18 for skeleton
  }));

  return (
    <div className="flex flex-col gap-4 md:gap-8 mx-auto max-w-[2000px]">
      <div>
        <Button className="text-blue-600" variant="link" disabled>
          <ArrowLeftIcon className="size-4 mr-2" />
          {t("back")}
        </Button>
      </div>

      <div className="flex justify-between items-center">
        <Skeleton className="h-9 w-1/2" />

        <div className="flex gap-2 md:gap-4">
          <Button className="md:hidden" size={"icon"} disabled>
            <PlusCircleIcon className="size-4" />
          </Button>
          <Button variant="outline" className="hidden md:flex" disabled>
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addGrade")}
          </Button>
          <Button size="icon" variant="outline" disabled>
            <EllipsisVerticalIcon className="size-4" />
          </Button>
        </div>
      </div>

      <Separator />

      {/* Basic Information Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Card key={index} className="p-6 rounded-lg">
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 justify-between">
                <Skeleton className="w-20 h-6" />
                <Skeleton className="w-6 h-6" />
              </div>

              <div className="flex flex-col gap-0.5">
                <Skeleton className="h-[30.5px] md:h-[39.5px]" />

                <div className="text-xs text-muted-foreground font-light">
                  <Skeleton className="h-4" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      {/* Impact Cards Section */}
      <div className="space-y-2">
        <Skeleton className="h-6 w-32" />
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-4">
          {Array.from({ length: 3 }).map((_, index) => (
            <Card key={index} className="p-6 rounded-lg">
              <div className="flex flex-col gap-2">
                <div className="flex gap-2 justify-between">
                  <Skeleton className="w-20 h-6" />
                  <Skeleton className="w-6 h-6" />
                </div>

                <div className="flex flex-col gap-0.5">
                  <Skeleton className="h-[30.5px] md:h-[39.5px]" />

                  <div className="text-xs text-muted-foreground font-light">
                    <Skeleton className="h-4" />
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>

      <Separator />

      {/* Charts of average evolution */}
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <Skeleton className="w-32 h-7" />
          <div className="inline-flex h-9 items-center justify-center rounded-lg bg-muted p-[3px]">
            <Skeleton className="h-[calc(100%-1px)] w-20 rounded-md" />
            <Skeleton className="h-[calc(100%-1px)] w-16 rounded-md ml-1" />
          </div>
        </div>

        <Card className="p-4">
          <ChartContainer config={chartConfig} className="h-[400px] w-full">
            <LineChart data={chartData} margin={{ left: -30 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={({ x, y }) => (
                  <text
                    x={x}
                    y={y}
                    className="text-muted-foreground animate-pulse rounded-md bg-primary/10 tracking-[-2.5px] text-lg select-none fill-primary/10!"
                  >
                    ■■■
                  </text>
                )}
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                domain={[0, 20]}
                tickMargin={8}
                tickCount={5}
                tick={({ x, y }) => (
                  <text
                    x={x}
                    y={y}
                    className="text-muted-foreground animate-pulse rounded-md bg-primary/10 tracking-[-2.5px] text-lg select-none fill-primary/10!"
                  >
                    ■■
                  </text>
                )}
              />

              <Line
                dataKey="average"
                type="monotone"
                fill="transparent"
                stroke="transparent"
                dot={false}
                strokeWidth={3}
                connectNulls={true}
              />
            </LineChart>
          </ChartContainer>
        </Card>
      </div>

      <Separator />

      {/* Grades Table Skeleton */}
      <div className="w-full">
        <div className="flex items-center py-4 gap-2">
          <div className="relative flex-1 max-w-sm md:max-w-[40%]">
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-10 w-10 md:w-24 ml-auto" />
        </div>

        <div className="overflow-hidden rounded-md border">
          <div className="w-full">
            {/* Table Header */}
            <div className="border-b bg-muted/50">
              <div className="flex">
                <div className="h-12 px-4 text-left align-middle font-medium flex items-center flex-1">
                  <Skeleton className="h-6 w-20" />
                </div>
                <div className="h-12 px-4 text-left align-middle font-medium flex items-center flex-1">
                  <Skeleton className="h-6 w-16" />
                </div>
                <div className="h-12 px-4 text-left align-middle font-medium flex items-center flex-1">
                  <Skeleton className="h-6 w-24" />
                </div>
                <div className="h-12 px-4 text-left align-middle font-medium flex items-center w-16"></div>
              </div>
            </div>
            {/* Table Body */}
            <div>
              {Array.from({ length: 5 }).map((_, index) => (
                <div key={index} className="border-b transition-colors">
                  <div className="flex">
                    <div className="p-4 align-middle flex-1">
                      <Skeleton className="h-5 w-32" />
                    </div>
                    <div className="p-4 align-middle flex-1">
                      <Skeleton className="h-6 w-16 rounded-full" />
                    </div>
                    <div className="p-4 align-middle flex-1">
                      <Skeleton className="h-5 w-24" />
                    </div>
                    <div className="p-4 align-middle flex items-center justify-end w-16">
                      <Skeleton className="h-8 w-8 rounded" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 py-4">
          <Skeleton className="h-9 w-24" />
          <Skeleton className="h-9 w-24" />
        </div>
      </div>
    </div>
  );
}
