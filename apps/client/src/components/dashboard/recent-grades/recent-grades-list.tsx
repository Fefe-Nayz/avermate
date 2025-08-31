"use client";

import { Grade } from "@/types/grade";
import RecentGradeItem from "./recent-grade-item";
import { Button } from "@/components/ui/button";
import { PlusCircleIcon } from "@heroicons/react/24/outline";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";
import { useTranslations } from "next-intl";
import { Period } from "@/types/period";

export default function RecentGradesList({
  recentGrades,
  period,
  yearId,
}: {
  recentGrades: Grade[];
  period: Period;
  yearId: string;
}) {
  const t = useTranslations("Dashboard.Cards.RecentGradesCard");

  if (recentGrades.length === 0)
    return (
      <div className="flex flex-col items-center justify-center gap-6 h-full">
        <p className="text-center">{t("noRecentGrades")}</p>
        <AddGradeDialog yearId={yearId}>
          <Button variant="outline">
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addGrade")}
          </Button>
        </AddGradeDialog>
      </div>
    );

  return (
    <div className="grid grid-cols-1 gap-0.5 overflow-hidden min-w-0">
      {recentGrades.slice(0, 5).map((grade) => (
        <RecentGradeItem key={grade.id} grade={grade} period={period} />
      ))}
    </div>
  );
}
