"use client";

import {
  Credenza,
  CredenzaBody,
  CredenzaContent,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from "@/components/ui/credenza";
import { useGrade } from "@/hooks/use-grade";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useState, useEffect } from "react";
import { UpdateGradeForm } from "../forms/update-grade-form";
import { Button } from "../ui/button";
import { useTranslations } from "next-intl";
import { Grade } from "@/types/grade";
import * as z from "zod";
import CredenzaContentWrapper from "../credenza/credenza-content-wrapper";
import CredenzaBodyWrapper from "../credenza/credenza-body-wrapper";
import { DropDrawerItem } from "../ui/dropdrawer";

// Match the shape your UpdateGradeForm expects
const updateGradeSchema = z.object({
  name: z.string().min(1).max(64),
  outOf: z.number().min(0).max(1000),
  value: z.number().min(0).max(1000),
  coefficient: z.number().min(0).max(1000),
  passedAt: z.date(),
  subjectId: z.string().min(1).max(64),
  periodId: z.string().min(1).max(64).nullable(),
});
type UpdateGradeSchema = z.infer<typeof updateGradeSchema>;

export default function UpdateGradeDialog({ gradeId }: { gradeId: string }) {
  const t = useTranslations("Dashboard.Dialogs.UpdateGrade");
  const [open, setOpen] = useState(false);

  const { data: grade, isPending, isError } = useGrade(gradeId);

  // We'll track parent-level form data.
  const [formData, setFormData] = useState<UpdateGradeSchema | null>(null);

  useEffect(() => {
    if (open && !isPending && !isError && grade) {
      setFormData({
        name: grade.name,
        outOf: grade.outOf / 100,
        value: grade.value / 100,
        coefficient: grade.coefficient / 100,
        passedAt: new Date(grade.passedAt),
        subjectId: grade.subjectId,
        periodId: grade.periodId === null ? "full-year" : grade.periodId,
      });
    } else if (!open) {
      // Reset so we start fresh next time
      setFormData(null);
    }
  }, [open, isPending, isError, grade]);

  return (
    <Credenza open={open} onOpenChange={setOpen}>
      <CredenzaTrigger asChild>
        <DropDrawerItem className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4" onSelect={(e) => e.preventDefault()}>
          <div className="flex items-center w-full">
            <PencilIcon className="size-4 mr-2" />
            {t("editGrade")}
          </div>
        </DropDrawerItem>
      </CredenzaTrigger>

      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBodyWrapper>
          {!isPending && !isError && formData && (
            <UpdateGradeForm
              gradeId={grade.id}
              close={() => setOpen(false)}
              formData={formData}
              setFormData={setFormData as React.Dispatch<React.SetStateAction<UpdateGradeSchema>>}
              yearId={grade.yearId}
            />
          )}
        </CredenzaBodyWrapper>
      </CredenzaContentWrapper>
    </Credenza>
  );
}
