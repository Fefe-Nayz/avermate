import { apiClient } from "@/lib/api";
import { readLocalUserSettings } from "@/lib/user-settings-storage";
import { Grade } from "@/types/grade";
import { isGradeVisibleAtSnapshot } from "@/utils/grades-timeline";
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

export const useGrade = (gradeId?: string) => {
  const { isActive, snapshotDate } = useTimelineModeState();

  return useQuery({
    queryKey: ["grades", gradeId],
    queryFn: async () => {
      if (!gradeId) {
        throw new Error("Grade ID is required");
      }
      const res = await apiClient.get(`grades/${gradeId}`);
      const data = await res.json<{ grade: Grade }>();

      // On April 1st with seasonal themes enabled, return modified grades with low values
      if (isAprilFoolsActive()) {
        return modifyGradeForAprilFools(data.grade);
      }

      // Otherwise return the actual grades
      return data.grade;
    },
    select: (grade) =>
      isActive && snapshotDate && !isGradeVisibleAtSnapshot(grade, snapshotDate)
        ? null
        : grade,
    enabled: !!gradeId,
  });
};
