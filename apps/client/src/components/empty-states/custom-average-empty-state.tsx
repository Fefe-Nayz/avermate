import { IconCalculatorOff } from "@tabler/icons-react";

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
import { PlusCircleIcon } from "lucide-react";
import AddAverageDialog from "@/components/dialogs/add-average-dialog";
import { cn } from "@/lib/utils";

export const CustomAverageEmptyState = ({
  yearId,
  className,
}: {
  yearId: string;
  className?: string;
}) => {
  const t = useTranslations("Settings.Settings.CustomAverages");
  return (
    <Empty className={cn("border border-dashed", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconCalculatorOff />
        </EmptyMedia>
        <EmptyTitle>{t("noCustomAverages")}</EmptyTitle>
        <EmptyDescription>{t("addNewCustomAverage")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <AddAverageDialog yearId={yearId}>
          <Button size="sm">
            <PlusCircleIcon className="size-4" />
            {t("addCustomAverage")}
          </Button>
        </AddAverageDialog>
      </EmptyContent>
    </Empty>
  );
};
