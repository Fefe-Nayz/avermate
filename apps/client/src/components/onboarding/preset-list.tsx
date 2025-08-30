"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiClient } from "@/lib/api";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Preset } from "@/types/get-preset-response";
import {
  Card,
  CardContent,
  CardDescription,
  CardTitle,
  CardHeader,
} from "@/components/ui/card";
import { Loader2Icon, CheckIcon, SearchIcon } from "lucide-react";
import { handleError } from "@/utils/error-utils";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";

export const PresetList = ({
  close,
  presets,
  yearId,
}: {
  close: () => void;
  presets: Preset[];
  yearId: string;
}) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Onboarding.Step2.Presets");
  const toaster = useToast();
  const queryClient = useQueryClient();

  // Add search state
  const [searchTerm, setSearchTerm] = useState("");
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null);

  // Filter presets based on search term
  const filteredPresets = presets.filter(
    (preset) =>
      preset.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      preset.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  // Define the mutation to apply a preset
  const mutation = useMutation<
    any, // Replace 'any' with your expected response type
    Error,
    { presetId: string }
  >({
    mutationKey: ["set-preset"],
    mutationFn: async ({ presetId }) => {
      const res = await apiClient.post(`presets/${presetId}?yearId=${yearId}`);
      const data = await res.json();
      return data;
    },
    onSuccess: (data) => {
      toaster.toast({
        title: t("successTitle"),
        description: t("successDescription"),
      });

      close();

      // Invalidate and refetch relevant queries
      queryClient.invalidateQueries({
        queryKey: ["subjects"],
      });

      // Reset loading state
      setLoadingPresetId(null);
    },
    onError: (error) => {
      handleError(error, toaster, errorTranslations, t("errorDescription"));

      // Reset loading state
      setLoadingPresetId(null);
    },
  });

  // Handle the button click to apply a preset
  const handleClick = (preset: Preset) => {
    setLoadingPresetId(preset.id);
    mutation.mutate({ presetId: preset.id });
  };

  return (
    <div className="space-y-4 mx-1">
      <div className="relative">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("search")}
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="pl-9"
        />
      </div>

      <div className="grid grid-cols-1 gap-4">
        {filteredPresets.length > 0 ? (
          filteredPresets.map((preset) => (
            <Card key={preset.id}>
              <CardHeader>
                <CardTitle>{preset.name}</CardTitle>
                <CardDescription>{preset.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  onClick={() => handleClick(preset)}
                  disabled={loadingPresetId !== null}
                >
                  {loadingPresetId === preset.id && (
                    <Loader2Icon className="animate-spin mr-2 size-4" />
                  )}
                  {t("select")}
                  {loadingPresetId === preset.id && (
                    <CheckIcon className="ml-1 size-4" />
                  )}
                </Button>
              </CardContent>
            </Card>
          ))
        ) : (
          <div className="text-center py-8">
            <p className="text-muted-foreground text-sm">
              {searchTerm
                ? t("noSearchResults", { search: searchTerm })
                : t("noPresets")}
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
