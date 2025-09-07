"use client";

import DeleteSubjectDialog from "@/components/dialogs/delete-subject-dialog";
import UpdateSubjectDialog from "@/components/dialogs/update-subject-dialog";
import { Button } from "@/components/ui/button";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { Subject } from "@/types/subject";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";
import { PlusCircleIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { DropDrawer, DropDrawerTrigger, DropDrawerContent, DropDrawerItem, DropDrawerGroup } from "@/components/ui/dropdrawer";

export default function SubjectMoreButton({ subject }: { subject: Subject }) {
  const t = useTranslations("Dashboard.Buttons.SubjectMoreButton");

  return (
    <DropDrawer>
      <DropDrawerTrigger asChild>
        <Button size="icon" variant="outline">
          <EllipsisVerticalIcon className="size-4" />
        </Button>
      </DropDrawerTrigger>

      <DropDrawerContent>
        <DropDrawerGroup>
          {/* Add grade */}
          <AddGradeDialog yearId={subject.yearId} parentId={subject.id}>
            <DropDrawerItem className="md:hidden w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4" onSelect={(e) => e.preventDefault()}>
              <div className="flex items-center w-full">
                <PlusCircleIcon className="size-4 mr-2" />
                {t("addGrade")}
              </div>
            </DropDrawerItem>
          </AddGradeDialog>
        </DropDrawerGroup>

        <DropDrawerGroup>
          {/* Update grade */}
          <UpdateSubjectDialog subjectId={subject.id} />

          {/* Delete grade */}
          <DeleteSubjectDialog subject={subject} />
        </DropDrawerGroup>
      </DropDrawerContent>
    </DropDrawer>
  );
}
