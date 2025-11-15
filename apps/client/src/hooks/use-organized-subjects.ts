import { apiClient } from "@/lib/api";
import { GetOrganizedSubjectsResponse } from "@/types/get-organized-subjects-response";
import { useQuery } from "@tanstack/react-query";

export const useOrganizedSubjects = (yearId: string) =>
  useQuery({
    queryKey: ["subjects", "organized-by-periods"],
    queryFn: async () => {
      const res = await apiClient.get(
        `years/${yearId}/subjects/organized-by-periods`
      );
      const data = await res.json<GetOrganizedSubjectsResponse>();
      return data.periods;
    },
    enabled: !!yearId && yearId !== "none",
  });
