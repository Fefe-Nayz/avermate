"use client";

import { CreateYearForm } from "@/components/forms/create-year-form";
import { useTranslations } from "next-intl";
import React from "react";
import { useYears } from "@/hooks/use-years";

interface YearStepProps {
  yearId?: string;
  onYearCreated?: (yearId: string) => void;
}

export default function YearStep({ yearId, onYearCreated }: YearStepProps) {
  const t = useTranslations("Dashboard.Forms.CREATE_YEAR_FORM");
  const { data: years } = useYears();

  // Find the current year data if updating
  const currentYear = years?.find((year) => year.id === yearId);
  const isUpdating = yearId && yearId !== "new" && !!currentYear;

  const initialData = currentYear
    ? {
        name: currentYear.name,
        startDate: currentYear.startDate,
        endDate: currentYear.endDate,
        defaultOutOf: currentYear.defaultOutOf,
      }
    : undefined;

  return (
    <div className="flex flex-col gap-8 w-full max-w-[650px] mx-auto">
      <div className="flex flex-col gap-2 text-center md:text-left">
        <p className="text-lg md:text-xl font-semibold">
          {isUpdating ? t("UPDATE_YEAR_TITLE") : t("CREATE_YEAR_TITLE")}
        </p>
        <p className="text-sm md:text-base text-muted-foreground">
          {isUpdating ? t("UPDATE_YEAR_DESC") : t("CREATE_YEAR_DESC")}
        </p>
      </div>

      <CreateYearForm
        onYearCreated={onYearCreated}
        yearId={isUpdating ? yearId : undefined}
        initialData={initialData}
      />
    </div>
  );
}
