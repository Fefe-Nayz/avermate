import { Stack, useLocalSearchParams } from "expo-router";
import { FriendInvitationDecision } from "./friend-invitations/[token]";
import { GroupInvitationDecision } from "./invitations/[token]";
import { Empty, Screen } from "@/components/ui";
import { t } from "@/lib/i18n";
import { peekSocialInvitation } from "@/lib/social-invitation-session";

/** Only the opaque flow id appears in this route; the secret remains in RAM. */
export default function SocialInvitationProcess() {
  const { flow } = useLocalSearchParams<{ flow: string }>();
  const invitation = peekSocialInvitation(flow);

  if (!invitation) {
    return (
      <Screen>
        <Empty
          icon="shield-outline"
          title={t("Invitation unavailable")}
          body={t(
            "The private continuation expired. Reopen the original link; its secret was not stored on this device.",
          )}
        />
      </Screen>
    );
  }

  return (
    <>
      <Stack.Screen options={{ title: t("Private social invitation") }} />
      {invitation.kind === "friend" ? (
        <FriendInvitationDecision token={invitation.token} flowId={flow} />
      ) : (
        <GroupInvitationDecision token={invitation.token} flowId={flow} />
      )}
    </>
  );
}
