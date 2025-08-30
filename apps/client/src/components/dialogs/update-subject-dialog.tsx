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
import { apiClient } from "@/lib/api";
import { Subject } from "@/types/subject";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { UpdateSubjectForm } from "../forms/update-subject-form";
import { Button } from "../ui/button";
import { useTranslations } from "next-intl";
import { z } from "zod";

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
  } = useQuery({
    queryKey: ["subject", subjectId],
    queryFn: async () => {
      const res = await apiClient.get(`subjects/${subjectId}`);
      const data = await res.json<{ subject: Subject }>();
      return data.subject;
    },
  });

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
        <Button variant="ghost" className="w-full flex justify-start">
          <PencilIcon className="size-4 mr-2" />
          {t("editSubject")}
        </Button>
      </CredenzaTrigger>

      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody className="px-4 py-6 max-h-[100%] overflow-auto">
          {!isPending && !isError && formData && (
            <UpdateSubjectForm subjectId={subject.id} close={() => setOpen(false)} formData={formData} setFormData={setFormData as React.Dispatch<React.SetStateAction<TUpdateSubject>>} />
          )}
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
