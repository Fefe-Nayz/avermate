"use client";

import { useState, useCallback } from "react";
import AddSubjectDialog from "@/components/dialogs/add-subject-dialog";
import AddPeriodDialog from "@/components/dialogs/add-period-dialog";
import { Button } from "@/components/ui/button";
import {
  EllipsisVerticalIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { DropDrawer, DropDrawerTrigger, DropDrawerContent, DropDrawerItem, DropDrawerGroup } from "@/components/ui/dropdrawer";
import { BookOpenIcon, CalendarIcon, PlusCircleIcon } from "lucide-react";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";

export default function MoreButton({ yearId }: { yearId: string }) {
  const t = useTranslations("Dashboard.Buttons.MoreButton");
  const t2 = useTranslations("Dashboard.Pages.GradesPage");

  // DropDrawer state - controlled so we can hide it when dialogs open
  const [dropDrawerOpen, setDropDrawerOpen] = useState(false);

  // Dialog states - managed outside DropDrawer so they survive transitions
  const [gradeDialogOpen, setGradeDialogOpen] = useState(false);
  const [subjectDialogOpen, setSubjectDialogOpen] = useState(false);
  const [periodDialogOpen, setPeriodDialogOpen] = useState(false);

  // Open a dialog and hide the DropDrawer
  const openDialog = useCallback((setDialogOpen: (open: boolean) => void) => {
    setDropDrawerOpen(false); // Hide the DropDrawer
    setDialogOpen(true); // Open the dialog
  }, []);

  // Handle dialog close - reopen the DropDrawer so user can dismiss it
  const handleGradeDialogChange = useCallback((open: boolean) => {
    setGradeDialogOpen(open);
    if (!open) {
      // Dialog closed - reopen the DropDrawer
      setDropDrawerOpen(true);
    }
  }, []);

  const handleSubjectDialogChange = useCallback((open: boolean) => {
    setSubjectDialogOpen(open);
    if (!open) {
      // Dialog closed - reopen the DropDrawer
      setDropDrawerOpen(true);
    }
  }, []);

  const handlePeriodDialogChange = useCallback((open: boolean) => {
    setPeriodDialogOpen(open);
    if (!open) {
      // Dialog closed - reopen the DropDrawer
      setDropDrawerOpen(true);
    }
  }, []);

  return (
    <>
      {/* Dialogs rendered OUTSIDE DropDrawer - they survive viewport transitions */}
      <AddGradeDialog
        yearId={yearId}
        open={gradeDialogOpen}
        onOpenChange={handleGradeDialogChange}
      />
      <AddSubjectDialog
        yearId={yearId}
        open={subjectDialogOpen}
        onOpenChange={handleSubjectDialogChange}
      />
      <AddPeriodDialog
        yearId={yearId}
        open={periodDialogOpen}
        onOpenChange={handlePeriodDialogChange}
      />

      <DropDrawer open={dropDrawerOpen} onOpenChange={setDropDrawerOpen}>
        <DropDrawerTrigger asChild>
          <Button size="icon" variant="outline">
            <EllipsisVerticalIcon className="size-4" />
          </Button>
        </DropDrawerTrigger>

        <DropDrawerContent>
          <DropDrawerGroup>
            {/* Add grade */}
            <DropDrawerItem
              className="md:hidden w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4"
              onClick={() => openDialog(setGradeDialogOpen)}
            >
              <div className="flex items-center w-full">
                <PlusCircleIcon className="size-4 mr-2" />
                {t2("addGrade")}
              </div>
            </DropDrawerItem>
          </DropDrawerGroup>

          <DropDrawerGroup>
            {/* Add subject */}
            <DropDrawerItem
              className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4"
              onClick={() => openDialog(setSubjectDialogOpen)}
            >
              <div className="flex items-center w-full">
                <BookOpenIcon className="size-4 mr-2" />
                {t("addSubject")}
              </div>
            </DropDrawerItem>

            {/* Add period */}
            <DropDrawerItem
              className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4"
              onClick={() => openDialog(setPeriodDialogOpen)}
            >
              <div className="flex items-center w-full">
                <CalendarIcon className="size-4 mr-2" />
                {t("addPeriod")}
              </div>
            </DropDrawerItem>
          </DropDrawerGroup>
        </DropDrawerContent>
      </DropDrawer>
    </>
  );
}
