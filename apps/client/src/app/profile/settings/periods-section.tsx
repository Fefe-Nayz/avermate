"use client";

import AddPeriodDialog from "@/components/dialogs/add-period-dialog";
import DeletePeriodDialog from "@/components/dialogs/delete-period-dialog";
import UpdatePeriodDialog from "@/components/dialogs/update-period-dialog";
import ErrorStateCard from "@/components/skeleton/error-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeriods } from "@/hooks/use-periods";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { BookOpenIcon, PlusCircleIcon } from "lucide-react";
import ProfileSection from "../profile-section";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";

export const PeriodsSection = ({ yearId }: { yearId: string }) => {
  const formatter = useFormatter();
  const t = useTranslations("Settings.Settings.Periods");
  const formatDates = useFormatDates(formatter);

  // Fetch period data
  const {
    data: period,
    isError: isPeriodError,
    isPending: isPeriodPending,
  } = usePeriods(yearId);

  if (isPeriodPending) {
    return (
      <Card className={"w-full"}>
        <div className="flex flex-col gap-6">
          <CardHeader className="pb-0">
            <CardTitle>
              <Skeleton className="w-36 h-6" />
            </CardTitle>
            <div>
              <Skeleton className="w-20 h-4" />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="flex flex-col gap-4">
              <div className="px-6 grid gap-4">
                {Array.from({ length: 3 }).map((_, index) => (
                  <div
                    key={index}
                    className="bg-card text-card-foreground flex gap-6 rounded-xl border shadow-sm flex-row p-4 justify-between items-start"
                  >
                    <div className="flex flex-col gap-1 w-full">
                      <span>
                        <Skeleton className="w-full md:w-64 h-6" />
                      </span>
                      <span className="text-muted-foreground text-sm">
                        <Skeleton className="w-full md:w-32 h-4" />
                      </span>
                    </div>
                    <div>
                      <Button size="icon" variant="outline" disabled>
                        <EllipsisVerticalIcon className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-end border-t py-4 px-6">
                <AddPeriodDialog yearId={yearId}>
                  <Button disabled>
                    <PlusCircleIcon className="size-4 mr-2" />
                    {t("addPeriod")}
                  </Button>
                </AddPeriodDialog>
              </div>
            </div>
          </CardContent>
        </div>
      </Card>
    );
  }

  if (isPeriodError) {
    return <div>{<ErrorStateCard />}</div>;
  }

  if (period.length === 0) {
    return (
      <ProfileSection title={t("title")} description={t("description")}>
        <div className="flex flex-col gap-4 justify-center items-center pb-6 px-6 ">
          <BookOpenIcon className="w-12 h-12" />
          <div className="flex flex-col items-center gap-1">
            <h2 className="text-xl font-semibold text-center">
              {t("noPeriods")}
            </h2>
            <p className="text-center">{t("addNewPeriod")}</p>
          </div>
          <AddPeriodDialog yearId={yearId}>
            <Button>
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addPeriod")}
            </Button>
          </AddPeriodDialog>
        </div>
      </ProfileSection>
    );
  }

  return (
    <ProfileSection title={t("title")} description={t("description")}>
      <div className="flex flex-col gap-4">
        <div className="px-6 grid gap-4">
          {period?.map((periodItem) => (
            <div
              key={periodItem.id}
              className="bg-card text-card-foreground flex gap-6 rounded-xl border shadow-sm flex-row p-4 justify-between items-start"
            >
              <div className="flex flex-col gap-1">
                <Label>{periodItem.name}</Label>
                <span className="text-muted-foreground text-sm">
                  {t("from")}{" "}
                  {formatDates.formatIntermediate(new Date(periodItem.startAt))}{" "}
                  {t("to")}{" "}
                  {formatDates.formatIntermediate(new Date(periodItem.endAt))}
                </span>
              </div>
              <div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon" variant="outline">
                      <EllipsisVerticalIcon className="size-4" />
                    </Button>
                  </DropdownMenuTrigger>

                  <DropdownMenuContent className="flex flex-col items-start">
                    {/* Update period */}
                    <DropdownMenuItem
                      asChild
                      onSelect={(e) => e.preventDefault()}
                    >
                      <UpdatePeriodDialog periodId={periodItem.id} />
                    </DropdownMenuItem>

                    {/* Delete period */}
                    <DropdownMenuItem
                      asChild
                      onSelect={(e) => e.preventDefault()}
                    >
                      <DeletePeriodDialog period={periodItem} />
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </div>
          ))}
        </div>
        <div className="flex justify-end border-t py-4 px-6">
          <AddPeriodDialog yearId={yearId}>
            <Button>
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addPeriod")}
            </Button>
          </AddPeriodDialog>
        </div>
      </div>
    </ProfileSection>
  );
};
