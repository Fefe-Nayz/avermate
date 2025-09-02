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
import { PresetList } from "../onboarding/preset-list";
import { useTranslations } from "next-intl";
import { usePresets } from "@/hooks/use-presets";
import CredenzaBodyWrapper from "../credenza/credenza-body-wrapper";
import CredenzaContentWrapper from "../credenza/credenza-content-wrapper";

interface PresetListState {
  searchTerm: string;
}

const EMPTY_STATE: PresetListState = {
  searchTerm: ""
};

export default function ListPresetsDialog({
  children,
  yearId,
}: {
  children: React.ReactNode;
  yearId: string;
}) {
  const t = useTranslations("Dashboard.Dialogs.ListPresets");
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<PresetListState>(EMPTY_STATE);

  const {
    data: presets,
    isError,
    isLoading,
  } = usePresets();

  return (
    <Credenza
      open={open}
      onOpenChange={(newOpen) => {
        setOpen(newOpen);
        if (!newOpen) {
          setState(EMPTY_STATE);
        }
      }}
    >
      <CredenzaTrigger asChild>{children}</CredenzaTrigger>
      <CredenzaContentWrapper>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBodyWrapper>
          {!isLoading && !isError && presets && (
            <PresetList
              presets={presets}
              close={() => setOpen(false)}
              state={state}
              setState={setState}
              yearId={yearId}
            />
          )}
        </CredenzaBodyWrapper>
      </CredenzaContentWrapper>
    </Credenza>
  );
}
