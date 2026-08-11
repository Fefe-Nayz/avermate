import { YearSetupWizard } from "@/components/onboarding/year-setup-wizard"

export default function NewYearPage() {
  return (
    <YearSetupWizard initialNow={new Date().toISOString()} mode="additional" />
  )
}
