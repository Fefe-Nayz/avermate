import { apiClient } from "@/lib/api";
import { Subject } from "@/types/subject";
import { useQuery } from "@tanstack/react-query";

export const useSubject = (subjectId?: string, isVirtualSubject?: boolean) =>
  useQuery({
    queryKey: ["subjects", subjectId],
    queryFn: async () => {
      if (!subjectId) {
        throw new Error("Subject ID is required");
      }
      const res = await apiClient.get(`subjects/${subjectId}`);
      const data = await res.json<{ subject: Subject }>();
      return data.subject;
    },
    enabled: !!subjectId && !isVirtualSubject,
  });
