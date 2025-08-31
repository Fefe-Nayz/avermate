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
import { usePeriods } from "@/hooks/use-periods";
import { useState } from "react";
import { AddPeriodForm } from "../forms/add-period-form";
import { useTranslations } from "next-intl";
import { z } from "zod";

export default function AddPeriodCredenza({
  children,
  yearId,
}: {
  children: React.ReactNode;
  yearId: string;
}) {
  const t = useTranslations("Dashboard.Dialogs.AddPeriod");
  const [open, setOpen] = useState(false);

  // Fetch existing periods to prevent overlapping
  const { data: periods, isError, isPending } = usePeriods(yearId);

  // 1) Mirror the same shape as the AddPeriodForm’s defaultValues
  const AddPeriodSchema = z.object({
    name: z.string().min(1).max(64),
    dateRange: z.object({
      from: z.date().optional(),
      to: z.date().optional(),
    }),
    isCumulative: z.boolean().optional(),
  });
  type AddPeriodSchema = z.infer<typeof AddPeriodSchema>;

  // 2) The same default values you had in the form
  const EMPTY_FORM_DATA: AddPeriodSchema = {
    name: "",
    dateRange: {
      from: undefined,
      to: undefined,
    },
    isCumulative: false,
  };

  const [formData, setFormData] = useState<AddPeriodSchema>(EMPTY_FORM_DATA);

  return (
    <Credenza
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen);
        if (!newOpen) {
          // Reset ONLY if truly closed
          setFormData(EMPTY_FORM_DATA);
        }
      }}
    >
      <CredenzaTrigger className="flex items-center" asChild>
        {children}
      </CredenzaTrigger>

      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody className="px-4 py-6 max-h-[100%] overflow-auto">
          {!isPending && !isError && open && (
            <AddPeriodForm
              periods={periods}
              close={() => setOpen(false)}
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