"use client";

import AddPeriodDialog from "@/components/dialogs/add-period-dialog";
import DeletePeriodDialog from "@/components/dialogs/delete-period-dialog";
import UpdatePeriodDialog from "@/components/dialogs/update-period-dialog";
import ErrorStateCard from "@/components/skeleton/error-card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { usePeriods } from "@/hooks/use-periods";
import {
  EllipsisVerticalIcon,
} from "@heroicons/react/24/outline";
import { PlusCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useFormatDates } from "@/utils/format";
import { useFormatter } from "next-intl";
import {
  DropDrawer,
  DropDrawerTrigger,
  DropDrawerContent,
  DropDrawerGroup,
} from "@/components/ui/dropdrawer";

interface PeriodsStepProps {
  yearId: string;
}

export default function PeriodsStep({ yearId }: PeriodsStepProps) {
  const formatter = useFormatter();
  const t = useTranslations("Onboarding.Step1");
  const formatDates = useFormatDates(formatter);

  const shouldQuery = yearId && yearId !== "new";
  const {
    data: periods,
    isError: periodsIsError,
    isPending: periodsIsPending,
  } = usePeriods(shouldQuery ? yearId : "");

  if (!shouldQuery) {
    return (
      <div className="flex flex-col gap-4 items-center justify-center h-full min-h-[400px]">
        <p className="text-muted-foreground text-center">
          {t("needsYearFirst")}
        </p>
      </div>
    );
  }

  if (periodsIsPending) {
    return (
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

  if (!periods || periods.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center space-y-8 h-full min-h-[400px]">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
          <p className="text-muted-foreground text-center max-w-2xl">
            {t.rich("periodsDescription", {
              bold: (chunks) => <b className="text-foreground">{chunks}</b>,
            })}
          </p>
        </div>
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
      <div className="text-center md:text-left">
        <h2 className="text-2xl font-bold text-primary">{t("title")}</h2>
      </div>

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
            <DropDrawer>
              <DropDrawerTrigger asChild>
                <Button size="icon" variant="outline">
                  <EllipsisVerticalIcon className="size-4" />
                </Button>
              </DropDrawerTrigger>

              <DropDrawerContent>
                <DropDrawerGroup>
                  <UpdatePeriodDialog periodId={period.id} />
                  <DeletePeriodDialog period={period} />
                </DropDrawerGroup>
              </DropDrawerContent>
            </DropDrawer>
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
