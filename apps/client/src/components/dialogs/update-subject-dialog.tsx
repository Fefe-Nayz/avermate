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
import { PencilIcon } from "@heroicons/react/24/outline";
import { useState, useEffect } from "react";
import { UpdateSubjectForm } from "../forms/update-subject-form";
import { Button } from "../ui/button";
import { useTranslations } from "next-intl";
import * as z from "zod";
import { useSubject } from "@/hooks/use-subject";
import CredenzaContentWrapper from "../credenza/credenza-content-wrapper";
import CredenzaBodyWrapper from "../credenza/credenza-body-wrapper";
import { DropDrawerItem } from "../ui/dropdrawer";

/** match the shape from update-subject-form. */
const updateSubjectSchema = z.object({
  name: z.string().min(1).max(64),
  coefficient: z.number().min(0).max(1000),
  parentId: z.string().max(64).nullable().optional(),
  isMainSubject: z.boolean().optional(),
  isDisplaySubject: z.boolean().optional(),
});
type TUpdateSubject = z.infer<typeof updateSubjectSchema>;

export default function UpdateSubjectCredenza({ subjectId }: { subjectId: string }) {
  const t = useTranslations("Dashboard.Dialogs.UpdateSubject");
  const [open, setOpen] = useState(false);

  const {
    data: subject,
    isPending,
    isError,
  } = useSubject(subjectId);

  // parent-level form data
  const [formData, setFormData] = useState<TUpdateSubject | null>(null);

  useEffect(() => {
    if (open && !isPending && !isError && subject) {
      // Fill from the fetched subject
      setFormData({
        name: subject.name,
        coefficient: subject.coefficient / 100,
        parentId: subject.parentId ?? null,
        isMainSubject: subject.isMainSubject,
        isDisplaySubject: subject.isDisplaySubject,
      });
    } else if (!open) {
      setFormData(null);
    }
  }, [open, subject, isPending, isError]);

  return (
    <Credenza open={open} onOpenChange={setOpen}>
      <CredenzaTrigger asChild>
        <DropDrawerItem className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4" onSelect={(e) => e.preventDefault()}>
          <div className="flex items-center w-full">
            <PencilIcon className="size-4 mr-2" />
            {t("editSubject")}
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
            <UpdateSubjectForm yearId={subject.yearId} subjectId={subject.id} close={() => setOpen(false)} formData={formData} setFormData={setFormData as React.Dispatch<React.SetStateAction<TUpdateSubject>>} />
          )}
        </CredenzaBodyWrapper>
      </CredenzaContentWrapper>
    </Credenza>
  );
}
