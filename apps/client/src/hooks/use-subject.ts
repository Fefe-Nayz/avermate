import { apiClient } from "@/lib/api";
import { Subject } from "@/types/subject";
import { useQuery } from "@tanstack/react-query";

export const useSubject = (subjectId: string, isVirtualSubject?: boolean) => useQuery({
    queryKey: ["subjects", subjectId],
    queryFn: async () => {
        const res = await apiClient.get(`subjects/${subjectId}`);
        const data = await res.json<{ subject: Subject }>();
        return data.subject;
    },
    enabled: !isVirtualSubject,
});