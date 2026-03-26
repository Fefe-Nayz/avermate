import { ChartSettingsSection } from "@/app/profile/settings/chart-settings-section";
import { HapticsSection } from "@/app/profile/settings/haptics-section";
import { LanguageSection } from "@/app/profile/settings/language-section";
import { MokattamThemeSection } from "@/app/profile/settings/mokattam-theme-section";
import { SeasonalThemesSection } from "@/app/profile/settings/seasonal-themes-section";
import { ThemeSection } from "@/app/profile/settings/theme-section";
import { TimelineModeSection } from "@/app/profile/settings/timeline-mode-section";
import { UserIdSection } from "@/app/profile/settings/user-id-section";
import { MobileSettingsAnchor } from "@/components/settings/mobile-settings-anchor";

export function GeneralSettingsContent() {
  return (
    <div className="flex w-full flex-col gap-4 md:gap-8">
      <MobileSettingsAnchor settingId="theme">
        <ThemeSection />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="language">
        <LanguageSection />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="chart-settings">
        <ChartSettingsSection />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="timeline-mode">
        <TimelineModeSection />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="haptics">
        <HapticsSection />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="seasonal-themes">
        <SeasonalThemesSection />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="mokattam-theme">
        <MokattamThemeSection />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="developer-options">
        <UserIdSection />
      </MobileSettingsAnchor>
      {/* USE YEAR WORKSPACE SETTINGS NOW */}
      {/* <PeriodsSection /> */}
      {/* <CustomAveragesSection /> */}
      {/* <OnboardingSection /> */}
      {/* <ResetAccountSection /> */}
    </div>
  );
}
