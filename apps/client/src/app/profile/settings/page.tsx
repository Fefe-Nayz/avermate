import { ThemeSection } from "./theme-section";
import { LanguageSection } from "./language-section";

export default function SettingsPage() {
  return (
    <main className="flex flex-col md:gap-8 gap-4 w-full ">
      <ThemeSection />
      <LanguageSection />
      {/* USE YEAR WORKSPACE SETTINGS NOW */}
      {/* <PeriodsSection /> */}
      {/* <CustomAveragesSection /> */}
      {/* <OnboardingSection /> */}
      {/* <ResetAccountSection /> */}
    </main>
  );
}
