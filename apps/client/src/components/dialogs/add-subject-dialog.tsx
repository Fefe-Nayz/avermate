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

  return (
    <Credenza open={open} onOpenChange={setOpen}>
      <CredenzaTrigger className="flex items-center" asChild>
        {children}
      </CredenzaTrigger>

      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody className="px-4 py-6 max-h-[100%] overflow-auto">
          <AddSubjectForm yearId={yearId} close={() => setOpen(false)} parentId={parentId} />
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
