import { apiClient } from "@/lib/api";
import { Subject } from "@/types/subject";
import { filterSubjectsBySnapshotDate } from "@/utils/grades-timeline";
import { useQuery } from "@tanstack/react-query";
import { useTimelineModeState } from "./use-timeline-mode";

export const useSubject = (subjectId?: string, isVirtualSubject?: boolean) => {
  const { isActive, snapshotDate } = useTimelineModeState();

  return useQuery({
    queryKey: ["subjects", subjectId],
    queryFn: async () => {
      if (!subjectId) {
        throw new Error("Subject ID is required");
      }
      const res = await apiClient.get(`subjects/${subjectId}`);
      const data = await res.json<{ subject: Subject }>();
      return data.subject;
    },
    select: (subject) =>
      isActive && snapshotDate
        ? filterSubjectsBySnapshotDate([subject], snapshotDate)[0] ?? subject
        : subject,
    enabled: !!subjectId && !isVirtualSubject,
  });
};
