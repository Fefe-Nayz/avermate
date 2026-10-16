"use client";

import { useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useYearComparisonSettings } from "@/hooks/use-year-comparison";
import { Credenza, CredenzaDescription, CredenzaHeader, CredenzaTitle, CredenzaTrigger } from "@/components/ui/credenza";
import CredenzaContentWrapper from "@/components/credenza/credenza-content-wrapper";
import YearComparisonForm from "@/components/forms/year-comparison-form";

export default function YearComparisonDialog({ children }: { children: ReactNode }) {
  const t = useTranslations("YearComparison");
  const settings = useYearComparisonSettings();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  return (
    <Credenza open={open} onOpenChange={(next) => { if (!saving) setOpen(next); }}>
      <CredenzaTrigger asChild>{children}</CredenzaTrigger>
      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description", { year: settings.currentYear?.name ?? "" })}</CredenzaDescription>
        </CredenzaHeader>
        {open && <YearComparisonForm close={() => setOpen(false)} onSavingChange={setSaving} />}
      </CredenzaContentWrapper>
    </Credenza>
  );
}
