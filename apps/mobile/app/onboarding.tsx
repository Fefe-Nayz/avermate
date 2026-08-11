import { YearSetupWizard } from "@/components/year-setup-wizard";

/** First run and additional years intentionally share one resumable flow. */
export default function OnboardingRoute() {
  return <YearSetupWizard />;
}
