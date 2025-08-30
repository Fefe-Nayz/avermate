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
import { useState } from "react";
import { UpdatePeriodForm } from "../forms/update-period-form";
import { Button } from "../ui/button";
import { useTranslations } from "next-intl";
import { usePeriods } from "@/hooks/use-periods";

export default function UpdatePeriodCredenza({
  periodId,
}: {
  periodId: string;
}) {
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
      const data = await res.json<Period>();
      return data;
    },
  });

  const {
    data: periods,
    isPending: isPeriodsPending,
    isError: isPeriodsError,
  } = usePeriods(period?.yearId || "none");

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
          {!isPending && !isError && !isPeriodsPending && !isPeriodsError && (
            <UpdatePeriodForm
              period={period}
              periods={periods}
              close={() => setOpen(false)}
            />
          )}
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
