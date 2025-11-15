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
import { PercentIcon, PlusCircleIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";

export const GradeEmptyState = ({ className, yearId, parentId, subjectName }: { className?: string, yearId: string, parentId?: string, subjectName?: string }) => {
  const t = useTranslations("Dashboard.Charts.GlobalAverageChart");
  return (
    <Empty className={cn("border border-dashed", className)}>
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <PercentIcon />
        </EmptyMedia>
        <EmptyTitle>{t("noGradesTitle")}</EmptyTitle>
        <EmptyDescription>{t("noGradesDescription")}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <AddGradeDialog yearId={yearId} parentId={parentId}>
          <Button size="sm">
            <PlusCircleIcon className="size-4" />
            {subjectName ? t("addGradeInSubject", { name: subjectName }) : t("addGrade")}
          </Button>
        </AddGradeDialog>
      </EmptyContent>
    </Empty>
  );
};
