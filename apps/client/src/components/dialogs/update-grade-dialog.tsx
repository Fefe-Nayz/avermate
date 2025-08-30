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
import { z } from "zod";

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
        <Button variant="ghost">
          <PencilIcon className="size-4 mr-2" />
          {t("editGrade")}
        </Button>
      </CredenzaTrigger>

      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody className="px-4 py-6 max-h-[100%] overflow-auto">
          {!isPending && !isError && formData && (
            <UpdateGradeForm
              gradeId={grade.id}
              close={() => setOpen(false)}
              formData={formData}
              setFormData={setFormData as React.Dispatch<React.SetStateAction<UpdateGradeSchema>>}
            />
          )}
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
