import { useLocalSearchParams } from "expo-router";
import { YearSetupWizard } from "@/components/year-setup-wizard";

export default function ExistingYearSetupRoute() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return <YearSetupWizard yearId={id} />;
}
