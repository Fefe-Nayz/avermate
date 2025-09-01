import { apiClient } from "@/lib/api";
import { GetPresetResponse } from "@/types/get-preset-response";
import { useQuery } from "@tanstack/react-query";

export const usePresets = () => useQuery({
    queryKey: ["presets"],
    queryFn: async () => {
      const res = await apiClient.get("presets");
      const data = await res.json<GetPresetResponse>();
      return data.presets;
    },
  });