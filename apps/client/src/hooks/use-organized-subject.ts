import { apiClient } from "@/lib/api";
import { Subject } from "@/types/subject";
import { useQuery } from "@tanstack/react-query";

export const useOrganizedSubject = (subjectId: string, isVirtualSubject?: boolean) => useQuery({
    queryKey: ["subjects", "organized-by-periods", subjectId],
    queryFn: async () => {
        const res = await apiClient.get(
            `subjects/organized-by-periods/${subjectId}`
        );
        const data = await res.json<{ subject: Subject }>();
        return data.subject;
    },
    enabled: !isVirtualSubject,
});