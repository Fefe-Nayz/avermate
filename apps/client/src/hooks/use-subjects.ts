import { apiClient } from "@/lib/api";
import { GetSubjectsResponse } from "@/types/get-subjects-response";
import { useQuery } from "@tanstack/react-query";
import { Grade } from "@/types/grade";
import { queryKeys } from "@/lib/query-keys";

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

// Check if today is April 1st
function isAprilFoolsDay(): boolean {
  const today = new Date();
  return today.getMonth() === 3 && today.getDate() === 1;
}

export const useSubjects = (yearId: string) =>
  useQuery({
    queryKey: queryKeys.subjects.all(yearId),
    queryFn: async () => {
      const res = await apiClient.get(`years/${yearId}/subjects`);
      const data = await res.json<GetSubjectsResponse>();

      if (isAprilFoolsDay()) {
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
    enabled: !!yearId && yearId !== "none",
  });
