import { apiClient } from "@/lib/api";
import { Subject } from "@/types/subject";
import { filterSubjectsBySnapshotDate } from "@/utils/grades-timeline";
import { useQuery } from "@tanstack/react-query";
import { useTimelineModeState } from "./use-timeline-mode";

export const useOrganizedSubject = (
  subjectId: string,
  isVirtualSubject?: boolean
) => {
  const { isActive, snapshotDate } = useTimelineModeState();

  return useQuery({
    queryKey: ["subjects", "organized-by-periods", subjectId],
    queryFn: async () => {
        const res = await apiClient.get(
            `subjects/organized-by-periods/${subjectId}`
        );
        const data = await res.json<{ subject: Subject }>();
        return data.subject;
    },
    select: (subject) =>
      isActive && snapshotDate
        ? filterSubjectsBySnapshotDate([subject], snapshotDate)[0] ?? subject
        : subject,
    enabled: !isVirtualSubject,
  });
};
