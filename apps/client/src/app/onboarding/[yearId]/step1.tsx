"use client";

import AddPeriodDialog from "@/components/dialogs/add-period-dialog";
import DeletePeriodDialog from "@/components/dialogs/delete-period-dialog";
import UpdatePeriodDialog from "@/components/dialogs/update-period-dialog";
import ErrorStateCard from "@/components/skeleton/error-card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeriods } from "@/hooks/use-periods";
import {
  EllipsisVerticalIcon,
  PlusCircleIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";

export default function Step1({yearId}: {yearId: string}) {
  const formatter = useFormatter();
  const t = useTranslations("Onboarding.Step1");
  const formatDates = useFormatDates(formatter);

  const {
    data: periods,
    isError: periodsIsError,
    isPending: periodsIsPending,
  } = usePeriods(yearId);

  if (periodsIsPending) {
    return (
      <div className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
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
        <div className="flex flex-col items-center justify-center space-y-4">
          <AddPeriodDialog yearId={yearId}>
            <Button variant="outline" disabled>
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addNewPeriod")}
            </Button>
          </AddPeriodDialog>
        </div>
      </div>
    );
  }

  if (periodsIsError) {
    return <ErrorStateCard />;
  }

  // if the period field is empty, we display a message explaining what periods are and how to create them (we also say that they are optional)
  if (!periods || periods.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center space-y-8">
        <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
        <p className="text-muted-foreground text-center">
          {t.rich("periodsDescription", {
            bold: (chunks) => <b className="text-foreground">{chunks}</b>,
          })}
        </p>
        <AddPeriodDialog yearId={yearId}>
          <Button variant="outline">
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addPeriod")}
          </Button>
        </AddPeriodDialog>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
      {periods?.map((period) => (
        <div
          key={period.id}
          className="flex items-center justify-between gap-4 hover:bg-zinc-50 dark:hover:bg-zinc-900 cursor-pointer rounded-lg p-2"
        >
          <div className="flex flex-col gap-1">
            <Label>{period.name}</Label>
            <span className="text-muted-foreground text-sm">
              {t("from")}{" "}
              {formatDates.formatIntermediate(new Date(period.startAt))}{" "}
              {t("to")} {formatDates.formatIntermediate(new Date(period.endAt))}
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
                <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                  <UpdatePeriodDialog periodId={period.id} />
                </DropdownMenuItem>

                {/* Delete period */}
                <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
                  <DeletePeriodDialog period={period} />
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ))}
      <div className="flex flex-col items-center justify-center space-y-4">
        <AddPeriodDialog yearId={yearId}>
          <Button variant="outline">
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addNewPeriod")}
          </Button>
        </AddPeriodDialog>
      </div>
    </div>
  );
}
