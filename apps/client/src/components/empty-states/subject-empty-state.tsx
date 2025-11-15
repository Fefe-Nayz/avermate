"use client";
import { IconBookOff } from "@tabler/icons-react";
import { OnboardingButton } from "@/components/buttons/dashboard/onboarding-button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { useActiveYearStore } from "@/stores/active-year-store";
import { BookOpenIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export const SubjectEmptyState = ({ className }: { className?: string }) => {
  const t = useTranslations("Dashboard.EmptyStates.SubjectEmptyState");

  const { activeId } = useActiveYearStore();

  return (
    <Empty
      className={cn("border border-dashed", className)}
    >
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <IconBookOff />
        </EmptyMedia>
        <EmptyTitle>{t("noSubjectsTitle")}</EmptyTitle>
        <EmptyDescription>{t("noSubjectsDescription")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <OnboardingButton yearId={activeId} />
      </EmptyContent>
    </Empty>
  );
};
