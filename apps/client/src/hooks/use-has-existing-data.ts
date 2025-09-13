import { useYears } from "@/hooks/use-years";

export function useHasExistingData() {
    const { data: years } = useYears();

    const hasExistingData = years && years.length > 0;

    return hasExistingData;
}
