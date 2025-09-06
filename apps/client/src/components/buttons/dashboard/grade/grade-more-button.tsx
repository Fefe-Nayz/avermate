"use client";

import DeleteGradeDialog from "@/components/dialogs/delete-grade-dialog";
import UpdateGradeDialog from "@/components/dialogs/update-grade-dialog";
import { Button } from "@/components/ui/button";
import { DropDrawer, DropDrawerTrigger, DropDrawerContent, DropDrawerItem, DropDrawerGroup } from "@/components/ui/dropdrawer";
import { Grade } from "@/types/grade";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";

export default function GradeMoreButton({ grade }: { grade: Grade }) {
  return (
    <DropDrawer>
      <DropDrawerTrigger asChild>
        <Button size="icon" variant="outline">
          <EllipsisVerticalIcon className="size-4" />
        </Button>
      </DropDrawerTrigger>

      <DropDrawerContent>
        <DropDrawerGroup>
          {/* Update grade */}
          <UpdateGradeDialog gradeId={grade.id} />

          {/* Delete grade */}
          <DeleteGradeDialog grade={grade} />
        </DropDrawerGroup>
      </DropDrawerContent>
    </DropDrawer>
  );
}
