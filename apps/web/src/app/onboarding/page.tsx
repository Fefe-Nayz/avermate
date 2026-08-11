import { YearSetupWizard } from "@/components/onboarding/year-setup-wizard"

export default function OnboardingPage() {
  return <YearSetupWizard initialNow={new Date().toISOString()} mode="first" />
}
