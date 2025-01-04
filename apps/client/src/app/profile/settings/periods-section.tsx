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

export const PeriodsSection = () => {
  const formatter = useFormatter();
  const t = useTranslations("Settings.Settings.Periods");

  // Fetch period data
  const {
    data: period,
    isError: isPeriodError,
    isPending: isPeriodPending,
  } = usePeriods();

  if (isPeriodPending) {
    return (
      <Card className={"p-6 w-full"}>
        <div className="flex flex-col gap-6">
          <CardHeader className="p-0">
            <CardTitle>
              <Skeleton className="w-36 h-6" />
            </CardTitle>
            <div>
              <Skeleton className="w-20 h-4" />
            </div>
          </CardHeader>

          <CardContent className="p-0">
            <div className="flex flex-col gap-4">
              {Array.from({ length: 3 }).map((_, index) => (
                <div
                  key={index}
                  className="flex items-center justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer rounded-lg p-2"
                >
                  <div className="flex flex-col gap-1 w-full">
                    <Label>
                      <Skeleton className="md:w-64 h-6" />
                    </Label>
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
              <div className="flex justify-start">
                <AddPeriodDialog>
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
    return <div>{ErrorStateCard()}</div>;
  }

  if (period.length == 0) {
    return (
      <ProfileSection title={t("title")} description={t("description")}>
        <div className="flex flex-col gap-4 justify-center items-center ">
          <BookOpenIcon className="w-12 h-12" />
          <div className="flex flex-col items-center gap-1">
            <h2 className="text-xl font-semibold text-center">
              {t("noPeriods")}
            </h2>
            <p className="text-center">{t("addNewPeriod")}</p>
          </div>
          <AddPeriodDialog>
            <Button variant="outline">
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
        {period?.map((period) => (
          <div
            key={period.id}
            className="flex items-center justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer rounded-lg p-2"
          >
            <div className="flex flex-col gap-1">
              <Label>{period.name}</Label>
              <span className="text-muted-foreground text-sm">
                {t("from")}{" "}
                {useFormatDates(formatter).formatIntermediate(
                  new Date(period.startAt)
                )}{" "}
                {t("to")}{" "}
                {useFormatDates(formatter).formatIntermediate(
                  new Date(period.endAt)
                )}
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
                    <UpdatePeriodDialog periodId={period.id} />
                  </DropdownMenuItem>

                  {/* Delete period */}
                  <DropdownMenuItem
                    asChild
                    onSelect={(e) => e.preventDefault()}
                  >
                    <DeletePeriodDialog period={period} />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        ))}
        <div className="flex justify-start">
          <AddPeriodDialog>
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
