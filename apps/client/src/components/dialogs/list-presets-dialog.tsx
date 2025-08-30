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
import { useQuery } from "@tanstack/react-query";
import { apiClient } from "@/lib/api";
import { Preset } from "@/types/get-preset-response";
import { GetPresetResponse } from "@/types/get-preset-response";
import { useTranslations } from "next-intl";

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
  } = useQuery<Preset[], Error>({
    queryKey: ["presets"],
    queryFn: async () => {
      const res = await apiClient.get("presets");
      const data = await res.json<GetPresetResponse>();
      return data.presets;
    },
  });

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
      <CredenzaContent>
        <CredenzaHeader>
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>
        <CredenzaBody className="px-4 py-6 max-h-[100%] overflow-auto">
          {!isLoading && !isError && presets && (
            <PresetList
              presets={presets}
              close={() => setOpen(false)}
              state={state}
              setState={setState}
              yearId={yearId}
            />
          )}
        </CredenzaBody>
      </CredenzaContent>
    </Credenza>
  );
}
