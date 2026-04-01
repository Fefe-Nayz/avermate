import { apiClient } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import { readLocalUserSettings } from "@/lib/user-settings-storage";
import { GetSubjectsResponse } from "@/types/get-subjects-response";
import { Grade } from "@/types/grade";
import { filterSubjectsBySnapshotDate } from "@/utils/grades-timeline";
import { useQuery } from "@tanstack/react-query";
import { useTimelineModeState } from "./use-timeline-mode";

// Function to modify grades for April Fools
function modifyGradeForAprilFools(grade: Grade): Grade {
  // Create a deep copy to avoid modifying the original
  const modifiedGrade = JSON.parse(JSON.stringify(grade)) as Grade;

  // Apply April Fools modifications - generate a random low grade between 0 and 8
  if (modifiedGrade.value !== undefined && modifiedGrade.outOf !== undefined) {
    const randomLowValue = Math.floor(
      Math.random() * (modifiedGrade.outOf / 2)
    ); // Random value between 0 and half of the outOf value
    modifiedGrade.value = randomLowValue;
  }

  return modifiedGrade;
}

// Check if today is April 1st and seasonal themes are enabled
function isAprilFoolsActive(): boolean {
  const today = new Date();
  if (today.getMonth() !== 3 || today.getDate() !== 1) return false;
  if (typeof window === "undefined") return false;
  return readLocalUserSettings().settings.seasonalThemesEnabled;
}

export const useSubjects = (yearId: string) => {
  const { isActive, snapshotDate } = useTimelineModeState();

  return useQuery({
    queryKey: queryKeys.subjects.all(yearId),
    queryFn: async () => {
      const res = await apiClient.get(`years/${yearId}/subjects`);
      const data = await res.json<GetSubjectsResponse>();

      if (isAprilFoolsActive()) {
        // Apply April Fools modifications to each subject's grades
        return data.subjects.map((subject) => {
          return {
            ...subject,
            grades: subject.grades.map((grade) => {
              // Create a Grade object that can be passed to the modifier function
              const fullGrade: Grade = {
                ...grade,
                subject: {
                  id: subject.id,
                  name: subject.name,
                  isDisplaySubject: subject.isDisplaySubject,
                  isMainSubject: subject.isMainSubject,
                },
              } as Grade;

              return modifyGradeForAprilFools(fullGrade);
            }),
          };
        });
      }

      return data.subjects;
    },
    select: (subjects) =>
      isActive && snapshotDate
        ? filterSubjectsBySnapshotDate(subjects, snapshotDate)
        : subjects,
    enabled: !!yearId && yearId !== "none",
  });
};
