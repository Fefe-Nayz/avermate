import { GeneralSettingsContent } from "@/components/settings/general-settings-content";
import { MobileSettingsHub } from "@/components/settings/mobile-settings-shell";

export default function SettingsPage() {
  return (
    <>
      <div className="hidden md:block">
        <GeneralSettingsContent />
      </div>
      <MobileSettingsHub />
    </>
  );
}
