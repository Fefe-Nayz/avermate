"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/toast";
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
import { Loader2Icon, CheckIcon, SearchIcon, PlusCircleIcon, SearchX } from "lucide-react";
import { handleError } from "@/utils/error-utils";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Badge } from "../ui/badge";
import AddSubjectDialog from "@/components/dialogs/add-subject-dialog";

export const PresetList = ({
  close,
  presets,
  yearId,
  state,
  setState,
}: {
  close: () => void;
  yearId: string;
  presets: Preset[];
  state: { searchTerm: string };
  setState: React.Dispatch<React.SetStateAction<{ searchTerm: string }>>;
}) => {
  const errorTranslations = useTranslations("Errors");
  const t = useTranslations("Onboarding.Step2.Presets");
  const tStep2 = useTranslations("Onboarding.Step2");
  const queryClient = useQueryClient();
  const [loadingPresetId, setLoadingPresetId] = useState<string | null>(null);

  // Filter presets based on search term
  const filteredPresets = presets.filter(
    (preset) => {
      if (preset.isArchived) return false;
      
      const search = state.searchTerm.toLowerCase();
      if (!search) {
        return preset.featured;
      }
      
      return preset.name.toLowerCase().includes(search) ||
        preset.description.toLowerCase().includes(search);
    }
  );

  // Define the mutation to apply a preset
  const mutation = useMutation<
    any,
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
      toast.success(t("successTitle"), {
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
      handleError(error, errorTranslations, t("errorDescription"));

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
    <div className="flex flex-col space-y-4 mx-1">
      <div className="relative sticky top-0 bg-background z-10 pb-2 pt-1 -mt-1">
        <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder={t("search")}
          value={state.searchTerm}
          onChange={(e) => setState(prev => ({ ...prev, searchTerm: e.target.value }))}
          className="pl-9"
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
        {filteredPresets.length > 0 ? (
          filteredPresets.map((preset) => (
            <Card key={preset.id}>
              <CardHeader>
                <CardTitle className="flex items-center">{preset.name}
                  <span className="ml-2 flex gap-1">
                    {preset.tags.map((tag) => (
                      <Badge key={tag} variant="outline">
                        {tag}
                      </Badge>
                    ))}
                  </span>
                </CardTitle>
                <CardDescription>{preset.description}</CardDescription>
              </CardHeader>
              <CardContent>
                {/* Desktop Button */}
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
          <div className="flex flex-col items-center justify-center text-center py-16 px-4 border-2 border-dashed rounded-xl bg-muted/20 my-2">
            <div className="bg-background p-4 rounded-full shadow-sm border mb-4">
              <SearchX className="size-6 text-muted-foreground opacity-80" />
            </div>
            <p className="text-muted-foreground text-sm max-w-[280px] mx-auto mb-6 leading-relaxed">
              {state.searchTerm
                ? t("noSearchResults", { search: state.searchTerm })
                : t("noPresets")}
            </p>
            <AddSubjectDialog yearId={yearId}>
              <Button variant="outline" className="bg-background hover:bg-muted/50">
                <PlusCircleIcon className="size-4 mr-2" />
                {tStep2("addSubject")}
              </Button>
            </AddSubjectDialog>
          </div>
        )}
      </div>
    </div>
  );
};
