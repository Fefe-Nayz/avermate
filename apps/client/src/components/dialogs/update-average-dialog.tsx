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
import { BookOpenIcon, PencilIcon } from "@heroicons/react/24/outline";
import React, { useState, useEffect } from "react";
import { UpdateCustomAverageForm } from "../forms/update-average-form";
import { Button } from "../ui/button";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { useAverage } from "@/hooks/use-average";
import CredenzaContentWrapper from "../credenza/credenza-content-wrapper";
import CredenzaBodyWrapper from "../credenza/credenza-body-wrapper";
import { DropDrawerItem } from "../ui/dropdrawer";

// EXACT same shape as your UpdateCustomAverageForm expects:
const updateCustomAverageSchema = z.object({
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
type UpdateCustomAverageData = z.infer<typeof updateCustomAverageSchema>;

export default function UpdateAverageCredenza({ averageId }: { averageId: string }) {
  const t = useTranslations("Dashboard.Dialogs.UpdateAverage");
  const [open, setOpen] = useState(false);

  const {
    data: fetchedAverage,
    isPending,
    isError,
  } = useAverage(averageId);

  // The parent keeps its form state as T | null
  const [formData, setFormData] = useState<UpdateCustomAverageData | null>(null);

  // Load or reset form data on open/close
  useEffect(() => {
    if (open && !isPending && !isError && fetchedAverage) {
      setFormData({
        name: fetchedAverage.name,
        isMainAverage: fetchedAverage.isMainAverage,
        subjects: fetchedAverage.subjects.map((s) => ({
          id: s.id,
          customCoefficient: s.customCoefficient ?? null,
          includeChildren: s.includeChildren ?? false,
        })),
      });
    } else if (!open) {
      setFormData(null);
    }
  }, [open, isPending, isError, fetchedAverage]);

  return (
    <Credenza open={open} onOpenChange={setOpen}>
      <CredenzaTrigger asChild>
        <DropDrawerItem className="w-full sm:!bg-auto sm:!mx-auto sm:!my-auto sm:!rounded-auto max-sm:!bg-transparent max-sm:!mx-0 max-sm:!my-0 max-sm:!rounded-none max-sm:py-4" onSelect={(e) => e.preventDefault()}>
          <div className="flex items-center w-full">
            <PencilIcon className="size-4 mr-2" />
            {t("editAverage")}
          </div>
        </DropDrawerItem>
      </CredenzaTrigger>

      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBodyWrapper>
          {/* Only render the child if formData is non-null */}
          {!isPending && !isError && formData && (
            <UpdateCustomAverageForm
              close={() => setOpen(false)}
              formData={formData}
              averageId={averageId}
              setFormData={setFormData as React.Dispatch<React.SetStateAction<UpdateCustomAverageData>>}
              yearId={fetchedAverage.yearId}
            />
          )}
        </CredenzaBodyWrapper>
      </CredenzaContentWrapper>
    </Credenza>
  );
}
