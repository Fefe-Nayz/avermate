"use client";

import {
  Credenza,
  CredenzaDescription,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from "@/components/ui/credenza";
import { usePeriods } from "@/hooks/use-periods";
import { useState } from "react";
import { AddPeriodForm } from "../forms/add-period-form";
import { useTranslations } from "next-intl";
import * as z from "zod";
import CredenzaBodyWrapper from "../credenza/credenza-body-wrapper";
import CredenzaContentWrapper from "../credenza/credenza-content-wrapper";

interface AddPeriodCredenzaProps {
  children?: React.ReactNode;
  yearId: string;
  /** If provided, the dialog will be controlled externally */
  open?: boolean;
  /** If provided, the dialog will be controlled externally */
  onOpenChange?: (open: boolean) => void;
}

export default function AddPeriodCredenza({
  children,
  yearId,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: AddPeriodCredenzaProps) {
  const t = useTranslations("Dashboard.Dialogs.AddPeriod");

  // Support both controlled and uncontrolled modes
  const [internalOpen, setInternalOpen] = useState(false);
  const isControlled = controlledOpen !== undefined;
  const open = isControlled ? controlledOpen : internalOpen;
  const setOpen = isControlled ? controlledOnOpenChange! : setInternalOpen;

  // Fetch existing periods to prevent overlapping
  const { data: periods, isError, isPending } = usePeriods(yearId);

  // 1) Mirror the same shape as the AddPeriodForm's defaultValues
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
          // Reset ONLY if truly closed
          setFormData(EMPTY_FORM_DATA);
        }
      }}
    >
      {children && (
        <CredenzaTrigger className="flex items-center" asChild>
          {children}
        </CredenzaTrigger>
      )}

      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBodyWrapper>
          {!isPending && !isError && open && (
            <AddPeriodForm
              periods={periods}
              close={() => close()}
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