"use client";

import AddSubjectDialog from "@/components/dialogs/add-subject-dialog";
import AddPeriodDialog from "@/components/dialogs/add-period-dialog";
import { Button } from "@/components/ui/button";
import {
  EllipsisVerticalIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";
import { DropDrawer, DropDrawerTrigger, DropDrawerContent, DropDrawerItem, DropDrawerGroup, DropDrawerSeparator } from "@/components/ui/dropdrawer";
import { BookOpenIcon, CalendarIcon, PlusCircleIcon } from "lucide-react";
import AddGradeDialog from "@/components/dialogs/add-grade-dialog";

export default function MoreButton({ yearId }: { yearId: string }) {
  const t = useTranslations("Dashboard.Buttons.MoreButton");
  const t2 = useTranslations("Dashboard.Pages.GradesPage");

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
          <AddGradeDialog yearId={yearId}>
            <DropDrawerItem className="md:hidden w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4" onSelect={(e) => e.preventDefault()}>
              <div className="flex items-center w-full">
                <PlusCircleIcon className="size-4 mr-2" />
                {t2("addGrade")}
              </div>
            </DropDrawerItem>
          </AddGradeDialog>
          </DropDrawerGroup>

          <DropDrawerGroup>

          {/* Add subject */}
          <AddSubjectDialog yearId={yearId}>
            <DropDrawerItem className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4" onSelect={(e) => e.preventDefault()}>
              <div className="flex items-center w-full">
                <BookOpenIcon className="size-4 mr-2" />
                {t("addSubject")}
              </div>
            </DropDrawerItem>
          </AddSubjectDialog>

          {/* Add period */}

          <AddPeriodDialog yearId={yearId}>
            <DropDrawerItem className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4" onSelect={(e) => e.preventDefault()}>
              <div className="flex items-center w-full">
                <CalendarIcon className="size-4 mr-2" />
                {t("addPeriod")}
              </div>
            </DropDrawerItem>
          </AddPeriodDialog>
        </DropDrawerGroup>
      </DropDrawerContent>
    </DropDrawer >
  );
}
