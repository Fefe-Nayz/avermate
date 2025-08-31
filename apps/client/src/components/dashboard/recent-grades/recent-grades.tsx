"use client";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Grade } from "@/types/grade";
import RecentGradesList from "./recent-grades-list";
import { Period } from "@/types/period";
import { useTranslations } from "next-intl";

export default function RecentGradesCard({
  recentGrades,
  period,
  yearId
}: {
  recentGrades: Grade[];
  period: Period;
  yearId: string;
}) {
  const t = useTranslations("Dashboard.Cards.RecentGradesCard");

  const recentCount = recentGrades.filter(
    (grade) =>
      new Date(grade.createdAt) > new Date(Date.now() - 1000 * 60 * 60 * 24 * 7)
  ).length;

  return (
    <Card className="lg:col-span-2 flex flex-col overflow-hidden min-w-0">
      <CardHeader>
        <CardTitle className="text-l">{t("title")}</CardTitle>
        <CardDescription>{t("description", { recentCount })}</CardDescription>
      </CardHeader>

      <CardContent className="h-full overflow-hidden min-w-0">
        <RecentGradesList recentGrades={recentGrades} period={period} yearId={yearId} />
      </CardContent>
    </Card>
  );
}
