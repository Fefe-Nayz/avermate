import DeleteAccount from "./delete-account";
import LinkedAccount from "./linked-account";
import SessionList from "./session-list";
import { MobileSettingsAnchor } from "@/components/settings/mobile-settings-anchor";

export default function AccountPage() {
  return (
    <main className="flex flex-col md:gap-8 gap-4 w-full ">
      <MobileSettingsAnchor settingId="linked-accounts">
        <LinkedAccount />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="sessions">
        <SessionList />
      </MobileSettingsAnchor>
      <MobileSettingsAnchor settingId="delete-account">
        <DeleteAccount />
      </MobileSettingsAnchor>
    </main>
  );
}
