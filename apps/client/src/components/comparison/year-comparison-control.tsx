"use client";

import { ArrowLeftRight } from "lucide-react";
import { useTranslations } from "next-intl";
import { useYearComparisonSettings } from "@/hooks/use-year-comparison";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import YearComparisonDialog from "@/components/dialogs/year-comparison-dialog";

export default function YearComparisonControl() {
  const t = useTranslations("YearComparison");
  const settings = useYearComparisonSettings();
  if (!settings.currentYear || settings.years.length < 2) return null;
  const active = settings.enabled && !!settings.referenceYear;
  const label = active ? t("activeWith", { year: settings.referenceYear!.name }) : t("title");

  return (
    <Tooltip>
      <YearComparisonDialog key={settings.currentYear.id}>
        <TooltipTrigger asChild>
          <Button variant={active ? "secondary" : "ghost"} size="icon" aria-label={label}>
            <ArrowLeftRight aria-hidden="true" />
          </Button>
        </TooltipTrigger>
      </YearComparisonDialog>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
