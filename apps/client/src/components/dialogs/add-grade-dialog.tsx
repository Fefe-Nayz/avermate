"use client";

import {
  Credenza,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from "@/components/ui/credenza";
import { useState } from "react";
import { AddGradeForm, AddGradeSchema } from "../forms/add-grade-form";
import { useTranslations } from "next-intl";
import CredenzaContentWrapper from "../credenza/credenza-content-wrapper";
import CredenzaBodyWrapper from "../credenza/credenza-body-wrapper";

interface AddGradeDialogProps {
  children?: React.ReactNode;
  parentId?: string;
  yearId: string;
  /** If provided, the dialog will be controlled externally */
  open?: boolean;
  /** If provided, the dialog will be controlled externally */
  onOpenChange?: (open: boolean) => void;
}

export default function AddGradeDialog({
  children,
  parentId,
  yearId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AddGradeDialogProps) {
  const t = useTranslations("Dashboard.Dialogs.AddGrade");

  // Support both controlled and uncontrolled modes
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

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

  const close = () => {
    setOpen(false);
    setFormData(EMPTY_FORM_DATA);
  };

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
      {children && <CredenzaTrigger asChild>{children}</CredenzaTrigger>}
      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBodyWrapper>
          {open && (
            <AddGradeForm
              close={() => close()}
              parentId={parentId}
              formData={formData}
              setFormData={setFormData}
              yearId={yearId}
            />
          )}
        </CredenzaBodyWrapper>
      </CredenzaContentWrapper>
    </Credenza>
  );
}
