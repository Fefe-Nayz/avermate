"use client";

import Link from "next/link";
import { use } from "react";
import { useExtracted } from "next-intl";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "@/components/ui/empty";
import { AverageForm } from "@/components/averages/average-form";
import { useYear } from "@/components/year/year-provider";

export default function EditAveragePage({
  params,
}: {
  params: Promise<{ averageId: string }>;
}) {
  const { averageId } = use(params);
  const t = useExtracted();
  const { customAverages, isLoading } = useYear();
  const average = customAverages.find((item) => item.id === averageId);

  if (!average) {
    if (isLoading) return null;
    return (
      <Empty className="py-16">
        <EmptyHeader>
          <EmptyTitle>{t("Average not found")}</EmptyTitle>
          <EmptyDescription>
            {t("It may have been deleted, or it belongs to another year.")}
          </EmptyDescription>
        </EmptyHeader>
        <Button variant="outline" render={<Link href="/settings/averages" />}>
          {t("Back to custom averages")}
        </Button>
      </Empty>
    );
  }

  return (
    <AverageForm
      mode="edit"
      initial={{
        id: average.id,
        name: average.name,
        isMain: average.isMain,
        entries: average.entries.map((entry) => ({
          subjectId: entry.subjectId,
          coefficient:
            entry.coefficient === null ? "" : String(entry.coefficient),
          includeChildren: entry.includeChildren,
        })),
      }}
    />
  );
}
