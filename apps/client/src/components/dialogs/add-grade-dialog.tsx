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
import { AddGradeForm } from "../forms/add-grade-form";
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

  return (
    <Credenza open={open} onOpenChange={setOpen}>
      <CredenzaTrigger asChild>{children}</CredenzaTrigger>
      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody className="px-4 py-6 max-h-[100%] overflow-auto">
          <AddGradeForm yearId={yearId} close={() => setOpen(false)} parentId={parentId} />
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
