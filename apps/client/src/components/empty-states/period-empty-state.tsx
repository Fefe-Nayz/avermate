import { IconCalendarOff, IconCalendarPlus } from "@tabler/icons-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { useTranslations } from "next-intl";
import AddPeriodDialog from "@/components/dialogs/add-period-dialog";
import { cn } from "@/lib/utils";

export const PeriodEmptyState = ({
  yearId,
  className,
}: {
  yearId: string;
  className?: string;
}) => {
  const t = useTranslations("Settings.Settings.Periods");
  return (
    <Empty className={cn("border border-dashed", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconCalendarOff />
        </EmptyMedia>
        <EmptyTitle>{t("noPeriods")}</EmptyTitle>
        <EmptyDescription>{t("addNewPeriod")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <AddPeriodDialog yearId={yearId}>
          <Button size="sm">
            <IconCalendarPlus className="size-4" />
            {t("addPeriod")}
          </Button>
        </AddPeriodDialog>
      </EmptyContent>
    </Empty>
  );
};
