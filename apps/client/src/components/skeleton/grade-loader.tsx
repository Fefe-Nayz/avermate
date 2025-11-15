import { Separator } from "@/components/ui/separator";
import {
  ArrowLeftIcon,
  EllipsisVerticalIcon,
} from "@heroicons/react/24/outline";
import { Button } from "../ui/button";
import { Card } from "../ui/card";
import { Skeleton } from "../ui/skeleton";

export default function gradeLoader(t: any) {

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

        <Button size="icon" variant="outline" disabled>
          <EllipsisVerticalIcon className="size-4" />
        </Button>
      </div>

      <Separator />

      {/* Basic Information Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4 gap-2 md:gap-4">
        {Array.from({ length: 5 }).map((_, index) => (
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
    </div>
  );
}
