import AddGradeDialog from "@/components/dialogs/add-grade-dialog";
import { Button } from "@/components/ui/button";
import { PlusCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export const AddGradeButton = ({ yearId, subjectId, disabled }: { yearId: string; subjectId?: string; disabled?: boolean }) => {
  const t = useTranslations("Dashboard.Pages.GradesPage"); // Initialize t

  return (
    <AddGradeDialog yearId={yearId} parentId={subjectId}>
      <div>
        <div className="hidden md:flex">
          <Button disabled={disabled}>
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addGrade")}
          </Button>
        </div>

        <div className="flex md:hidden">
          <Button size="icon" disabled={disabled}>
            <PlusCircleIcon className="size-4" />
          </Button>
        </div>
      </div>
    </AddGradeDialog>
  );
};
