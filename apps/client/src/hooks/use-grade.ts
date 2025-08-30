import { apiClient } from "@/lib/api";
import { Grade } from "@/types/grade";
import { useQuery } from "@tanstack/react-query";

// Function to modify grades for April Fools
function modifyGradeForAprilFools(grade: Grade): Grade {
  // Create a deep copy to avoid modifying the original
  const modifiedGrade = JSON.parse(JSON.stringify(grade)) as Grade;
  
  // Apply April Fools modifications - generate a random low grade between 0 and 8
  if (modifiedGrade.value !== undefined && modifiedGrade.outOf !== undefined) {
    const randomLowValue = Math.floor(Math.random() * (modifiedGrade.outOf / 2)); // Random value between 0 and half of the outOf value
    modifiedGrade.value = randomLowValue;
}
  
  return modifiedGrade;
}

// Check if today is April 1st
function isAprilFoolsDay(): boolean {
  const today = new Date();
  return today.getMonth() === 3 && today.getDate() === 1;
}

export const useGrade = (gradeId: string) =>
  useQuery({
    queryKey: ["grades", gradeId],
    queryFn: async () => {
      const res = await apiClient.get(`grades/${gradeId}`);
      const data = await res.json<{ grade: Grade }>();
      
      // On April 1st, return modified grades with low values
      if (isAprilFoolsDay()) {
        return modifyGradeForAprilFools(data.grade);
      }
      
      // Otherwise return the actual grades
      return data.grade;
    },
  });
