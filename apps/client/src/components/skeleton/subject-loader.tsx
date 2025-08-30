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

  const chartConfig = {};

  const chartData = [
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
    {},
  ];

  return (
    <div className="flex flex-col gap-4 md:gap-8 m-auto max-w-[2000px]">
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
          </Button>{" "}
          <Button size="icon" variant="outline" disabled>
            <EllipsisVerticalIcon className="size-4" />
          </Button>
        </div>
      </div>

      <Separator />

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-4 4xl:grid-cols-5">
        {Array.from({ length: 5 }).map((_, index) => (
          <Card key={index} className="p-6 rounded-lg">
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 justify-between">
                <Skeleton className="w-20 h-6" />
                <Skeleton className="w-6 h-6" />
              </div>

              <div className="flex flex-col gap-0.5">
                <Skeleton className="h-[30.5px] md:h-[39.5px]" />

                <div className="text-xs text-muted-foreground font-light ">
                  <Skeleton className="h-4" />
                  <Skeleton className="w-20 h-4 hidden" />
                </div>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Separator />

      {/* Charts of average evolution */}
      <div className="flex flex-col gap-4">
        <h2 className="text-xl font-semibold">
          <Skeleton className="w-96 h-7" />
        </h2>

        <Card className="p-4">
          <ChartContainer config={chartConfig} className="h-[400px] w-[100%]">
            <LineChart data={chartData} margin={{ left: -30 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="date"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                tick={
                  <text className="text-muted-foreground animate-pulse-dimmer rounded-md bg-primary/10 tracking-[-4px] text-lg select-none">
                    ■■■
                  </text>
                }
              />
              <YAxis
                tickLine={false}
                axisLine={false}
                domain={[0, 20]}
                tickMargin={8}
                tickCount={5}
                tick={
                  <text className="text-muted-foreground animate-pulse-dimmer rounded-md bg-primary/10 tracking-[-4px] text-lg select-none">
                    ■■
                  </text>
                }
              />

              <Line
                dataKey="average"
                type="monotone"
                fill="url(#fillAverage)"
                stroke="#2662d9"
                dot={false}
                strokeWidth={3}
                connectNulls={true}
              />
            </LineChart>
          </ChartContainer>
        </Card>
      </div>
    </div>
  );
}
