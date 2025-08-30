"use client";

import DeleteSubjectDialog from "@/components/dialogs/delete-subject-dialog";
import UpdateSubjectDialog from "@/components/dialogs/update-subject-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { Subject } from "@/types/subject";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";
import { PlusCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";

export default function SubjectMoreButton({ subject }: { subject: Subject }) {
  const t = useTranslations("Dashboard.Buttons.SubjectMoreButton");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="outline">
          <EllipsisVerticalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent className="flex flex-col items-start">
        {/* Update grade */}
        <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
          <UpdateSubjectDialog subjectId={subject.id} />
        </DropdownMenuItem>

        {/* Add grade */}
        <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
          <AddGradeDialog yearId={subject.yearId} parentId={subject.id}>
            <Button
              className="w-full flex justify-start md:hidden"
              variant="ghost"
            >
              <PlusCircleIcon className="size-4 mr-2" />
              {t("addGrade")}
            </Button>
          </AddGradeDialog>
        </DropdownMenuItem>

        {/* Delete grade */}
        <DropdownMenuItem asChild onSelect={(e) => e.preventDefault()}>
          <DeleteSubjectDialog subject={subject} />
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
