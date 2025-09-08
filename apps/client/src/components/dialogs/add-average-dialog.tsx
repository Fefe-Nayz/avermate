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
import { AddAverageForm } from "../forms/add-average-form";
import { useTranslations } from "next-intl";

import * as z from "zod";
import CredenzaContentWrapper from "../credenza/credenza-content-wrapper";
import CredenzaBodyWrapper from "../credenza/credenza-body-wrapper";
const addCustomAverageSchema = z.object({
  name: z.string().min(1).max(64),
  subjects: z.array(
    z.object({
      id: z.string().min(1),
      customCoefficient: z.number().min(1).max(1000).nullable().optional(),
      includeChildren: z.boolean().optional(),
    })
  ),
  isMainAverage: z.boolean().default(false).optional(),
});
export type AddCustomAverageSchema = z.infer<typeof addCustomAverageSchema>;

const EMPTY_FORM_DATA: AddCustomAverageSchema = {
  name: "",
  subjects: [{ id: "", customCoefficient: null, includeChildren: false }],
  isMainAverage: false,
};

export default function AddAverageDialog({ children, yearId }: { children: React.ReactNode; yearId: string }) {
  const t = useTranslations("Dashboard.Dialogs.AddAverage");
  const [open, setOpen] = useState(false);
  const [formData, setFormData] = useState<AddCustomAverageSchema>(EMPTY_FORM_DATA);

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
      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBodyWrapper>
          {open && (
            <AddAverageForm
              close={() => setOpen(false)}
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
