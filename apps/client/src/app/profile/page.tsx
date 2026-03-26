import AvatarSection from "./avatar-section";
import EmailSection from "./email-section";
import NameSection from "./name-section";
import { MobileSettingsAnchor } from "@/components/settings/mobile-settings-anchor";

export default function ProfilePage() {
  return (
    <main className="flex flex-col md:gap-8 gap-4 w-full ">
      <MobileSettingsAnchor settingId="avatar">
        <AvatarSection />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="name">
        <NameSection />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="email">
        <EmailSection />
      </MobileSettingsAnchor>
    </main>
  );
}
