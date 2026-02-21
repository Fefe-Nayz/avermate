import { ThemeSection } from "./theme-section";
import { LanguageSection } from "./language-section";
import { ChartSettingsSection } from "./chart-settings-section";
import { SeasonalThemesSection } from "./seasonal-themes-section";
import { UserIdSection } from "./user-id-section";

export default function SettingsPage() {
  return (
    <main className="flex flex-col md:gap-8 gap-4 w-full ">
      <ThemeSection />
      <LanguageSection />
      <ChartSettingsSection />
      <SeasonalThemesSection />
      <UserIdSection />
      {/* USE YEAR WORKSPACE SETTINGS NOW */}
      {/* <PeriodsSection /> */}
      {/* <CustomAveragesSection /> */}
      {/* <OnboardingSection /> */}
      {/* <ResetAccountSection /> */}
    </main>
  );
}
