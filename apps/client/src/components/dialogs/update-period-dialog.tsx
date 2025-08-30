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
import { Period } from "@/types/period";
import { PencilIcon } from "@heroicons/react/24/outline";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { UpdatePeriodForm } from "../forms/update-period-form";
import { Button } from "../ui/button";
import { useTranslations } from "next-intl";
import { usePeriods } from "@/hooks/use-periods";
import { z } from "zod";

/** Match the shape from your UpdatePeriodForm. */
const updatePeriodSchema = z.object({
  name: z.string().min(1).max(64),
  dateRange: z.object({
    from: z.date(),
    to: z.date(),
  }),
  isCumulative: z.boolean().optional(),
});
type UpdatePeriodSchema = z.infer<typeof updatePeriodSchema>;

export default function UpdatePeriodCredenza({ periodId }: { periodId: string }) {
  const t = useTranslations("Dashboard.Dialogs.UpdatePeriod");
  const [open, setOpen] = useState(false);

  const {
    data: period,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["period", periodId],
    queryFn: async () => {
      const res = await apiClient.get(`periods/${periodId}`);
      return await res.json<Period>();
    },
  });

  const {
    data: periods,
    isPending: isPeriodsPending,
    isError: isPeriodsError,
  } = usePeriods(period?.yearId || "none");

  // store parent-level form data
  const [formData, setFormData] = useState<UpdatePeriodSchema | null>(null);

  useEffect(() => {
    if (open && period && !isPending && !isError) {
      setFormData({
        name: period.name,
        dateRange: {
          from: new Date(period.startAt),
          to: new Date(period.endAt),
        },
        isCumulative: period.isCumulative ?? false,
      });
    } else if (!open) {
      setFormData(null);
    }
  }, [open, period, isPending, isError]);

  return (
    <Credenza open={open} onOpenChange={setOpen}>
      <CredenzaTrigger asChild>
        <Button variant="ghost">
          <PencilIcon className="size-4 mr-2" />
          {t("editPeriod")}
        </Button>
      </CredenzaTrigger>

      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody className="px-4 py-6 max-h-[100%] overflow-auto">
          {!isPending && !isError && !isPeriodsPending && !isPeriodsError && formData && (
            <UpdatePeriodForm
              periodId={period.id}
              periods={periods}
              close={() => setOpen(false)}
              formData={formData}
              setFormData={setFormData as React.Dispatch<React.SetStateAction<UpdatePeriodSchema>>}
              yearId={period.yearId}
            />
          )}
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
