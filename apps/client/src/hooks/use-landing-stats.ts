import { apiClient } from "@/lib/api";
import { GetSocialResponse } from "@/types/get-social-response";
import { useQuery } from "@tanstack/react-query";

export const useLandingStats = () => useQuery({
    queryKey: ["landing"],
    queryFn: async () => {
      const res = await apiClient.get("landing");
      const data = await res.json<GetSocialResponse>();
      return data;
    },
  });