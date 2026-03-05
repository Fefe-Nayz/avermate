"use client";

import DeleteYearDialog from "@/components/dialogs/delete-year-dialog";
import ErrorStateCard from "@/components/skeleton/error-card";
import { Skeleton } from "@/components/ui/skeleton";
import { useYears } from "@/hooks/use-years";
import React from "react";
import { useTranslations } from "next-intl";
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default function DeleteYearSection({ yearId }: { yearId: string }) {
  const { data, isPending, isError } = useYears();
  const year = data?.find((year) => year.id === yearId);
  const t = useTranslations("Dashboard.Pages.YEAR_SETTINGS_PAGE.DELETE_YEAR_SECTION");

  if (isPending) {
    return (
      <Card className="border-destructive/40 gap-0">
        <CardHeader className="pb-6">
          <CardTitle>
            <Skeleton className="h-6 w-44" />
          </CardTitle>
          <CardDescription>
            <Skeleton className="h-4 w-72" />
          </CardDescription>
        </CardHeader>
        <div className="flex justify-end rounded-b-xl border-t border-destructive/30 bg-destructive/10 px-6 pt-6 pb-6 -mb-6">
          <Skeleton className="h-9 w-36 rounded-md" />
        </div>
      </Card>
    );
  }
  if (isError || !year) return <div>{ErrorStateCard()}</div>;

  return (
    <Card className="border-destructive/40 gap-0">
      <CardHeader className="pb-6">
        <CardTitle>{t("DELETE_YEAR_SECTION_TITLE")}</CardTitle>
        <CardDescription>{t("DELETE_YEAR_SECTION_DESCRIPTION")}</CardDescription>
      </CardHeader>
      <div className="flex justify-end rounded-b-xl border-t border-destructive/30 bg-destructive/10 px-6 pt-6 pb-6 -mb-6">
        <DeleteYearDialog year={year} />
      </div>
    </Card>
  );
}

