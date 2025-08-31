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
import { useState } from "react";
import { AddGradeForm, AddGradeSchema } from "../forms/add-grade-form";
import { useTranslations } from "next-intl";

export default function AddGradeDialog({
  children,
  parentId,
  yearId,
}: {
  children: React.ReactNode;
  parentId?: string;
  yearId: string;
}) {
  const t = useTranslations("Dashboard.Dialogs.AddGrade");
  const [open, setOpen] = useState(false);

  // The same defaults you had in the original code
  const EMPTY_FORM_DATA: AddGradeSchema = {
    name: "",
    outOf: undefined,
    value: undefined,
    coefficient: undefined,
    passedAt: undefined, 
    subjectId: parentId || "",
    periodId: null, 
  };

  const [formData, setFormData] = useState<AddGradeSchema>(EMPTY_FORM_DATA);

  return (
    <Credenza
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen);
        if (!newOpen) {
          setFormData(EMPTY_FORM_DATA);
        }
      }}
    >
      <CredenzaTrigger asChild>{children}</CredenzaTrigger>
      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody className="px-4 py-6 max-h-[100%] overflow-auto">
          {open && (
            <AddGradeForm
              close={() => setOpen(false)}
              parentId={parentId}
              formData={formData}
              setFormData={setFormData}
              yearId={yearId}
            />
          )}
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
