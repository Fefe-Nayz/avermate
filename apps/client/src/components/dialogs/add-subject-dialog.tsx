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
import { AddSubjectForm } from "../forms/add-subject-form";
import { useTranslations } from "next-intl";
import * as z from "zod";
import CredenzaContentWrapper from "../credenza/credenza-content-wrapper";
import CredenzaBodyWrapper from "../credenza/credenza-body-wrapper";

export default function AddSubjectCredenza({
  children,
  parentId,
  yearId,
}: {
  children: React.ReactNode;
  parentId?: string;
  yearId: string;
}) {
  const t = useTranslations("Dashboard.Dialogs.AddSubject");
  const [open, setOpen] = useState(false);

  const AddSubjectSchema = z.object({
    name: z.string().min(1).max(64),
    coefficient: z.number().min(0).max(1000).optional(),
    parentId: z.string().nullable().optional(),
    isMainSubject: z.boolean().optional(),
    isDisplaySubject: z.boolean().optional(),
  });
  type TAddSubject = z.infer<typeof AddSubjectSchema>;

  const EMPTY_FORM_DATA: TAddSubject = {
    name: "",
    parentId: parentId ?? "",
    isDisplaySubject: false,
    isMainSubject: false,
    coefficient: undefined,
  };

  const [formData, setFormData] = useState<TAddSubject>(EMPTY_FORM_DATA);

  const close = () => {
    setOpen(false);
    setFormData(EMPTY_FORM_DATA);
  }

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
      <CredenzaTrigger className="flex items-center" asChild>
        {children}
      </CredenzaTrigger>

      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBodyWrapper>
          {open && (
            <AddSubjectForm
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