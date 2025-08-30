"use client";

import AddSubjectDialog from "@/components/dialogs/add-subject-dialog";
import AddPeriodDialog from "@/components/dialogs/add-period-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  EllipsisVerticalIcon,
  PlusCircleIcon,
} from "@heroicons/react/24/outline";
import { useTranslations } from "next-intl";

export default function MoreButton({ yearId }: { yearId: string }) {
  const t = useTranslations("Dashboard.Buttons.MoreButton");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger>
        <Button size="icon" variant="outline">
          <EllipsisVerticalIcon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
          <AddSubjectDialog yearId={yearId}>
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addSubject")}
          </AddSubjectDialog>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
          <AddPeriodDialog yearId={yearId}>
            <PlusCircleIcon className="size-4 mr-2" />
            {t("addPeriod")}
          </AddPeriodDialog>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
