"use client";

import { OnboardingButton } from "@/components/buttons/dashboard/onboarding-button";
import { Card } from "@/components/ui/card";
import { useActiveYearStore } from "@/stores/active-year-store";
import { BookOpenIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export const SubjectEmptyState = () => {
  const t = useTranslations("Dashboard.EmptyStates.SubjectEmptyState");

  const { activeId } = useActiveYearStore();

  return (
    <Card className="lg:col-span-10 flex flex-col justify-center items-center p-6 gap-8 w-full h-[400px] xl:h-[600px]">
      <BookOpenIcon className="w-12 h-12" />
      <div className="flex flex-col items-center gap-1">
        <h2 className="text-xl font-semibold text-center">
          {t("noSubjectsTitle")}
        </h2>
        <p className="text-center">{t("noSubjectsDescription")}</p>
      </div>

      <OnboardingButton yearId={activeId} />
    </Card>
  );
};
