import { useLayoutEffect, useRef, useState } from "react";
import { Platform } from "react-native";
import { Stack, useRouter } from "expo-router";
import * as Linking from "expo-linking";
import { Empty, Loading, Screen } from "@/components/ui";
import { t } from "@/lib/i18n";
import {
  fragmentFromInvitationUrl,
  parseSocialInvitationFragment,
} from "@/lib/social-invitation-link";
import { holdSocialInvitation } from "@/lib/social-invitation-session";

/**
 * Canonical secret ingestion route. The fragment is scrubbed before any API
 * call and only an unrelated in-memory flow id enters native navigation.
 */
export default function NeutralSocialInvitation() {
  const router = useRouter();
  const linkedUrl = Linking.useURL();
  const handled = useRef(false);
  const [invalid, setInvalid] = useState(false);

  useLayoutEffect(() => {
    if (handled.current) return;
    void (async () => {
      const browserUrl =
        Platform.OS === "web" && typeof window !== "undefined"
          ? window.location.href
          : null;
      const url = linkedUrl ?? browserUrl ?? (await Linking.getInitialURL());
      if (handled.current) return;
      handled.current = true;
      const invitation = parseSocialInvitationFragment(
        fragmentFromInvitationUrl(url),
      );
      if (Platform.OS === "web" && typeof window !== "undefined") {
        window.history.replaceState(
          window.history.state,
          "",
          "/social/invitation",
        );
      }
      if (!invitation) {
        setInvalid(true);
        return;
      }
      const flow = holdSocialInvitation(invitation.kind, invitation.token);
      router.replace({
        pathname: "/social/invitation-process",
        params: { flow },
      });
    })();
  }, [linkedUrl, router]);

  return (
    <>
      <Stack.Screen options={{ title: t("Private social invitation") }} />
      {invalid ? (
        <Screen>
          <Empty
            icon="shield-outline"
            title={t("Invitation unavailable")}
            body={t(
              "The link is invalid, expired or incomplete. No membership or sharing permission was created.",
            )}
          />
        </Screen>
      ) : (
        <Loading />
      )}
    </>
  );
}
