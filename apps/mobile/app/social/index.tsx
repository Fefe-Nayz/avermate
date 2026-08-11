import { Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  SocialRouteGate,
  useSocialEligibility,
} from "@/components/social/social-gate";
import { socialAppIsAccessible } from "@/components/social/social-model";
import {
  PrivacyBoundaryNotice,
  SocialIdentity,
  SocialNavigation,
} from "@/components/social/social-ui";
import {
  Card,
  Empty,
  Loading,
  Row,
  Screen,
  Section,
  Title,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";
import { numeric, space, type, usePalette } from "@/lib/theme";

export default function SocialOverview() {
  const router = useRouter();
  const palette = usePalette();
  const eligibility = useSocialEligibility();
  const friendsEnabled = socialAppIsAccessible(eligibility.data);
  const profile = useQuery({
    ...orpc.social.profile.mine.queryOptions(),
    staleTime: 30_000,
  });
  const friends = useQuery({
    ...orpc.social.friends.list.queryOptions(),
    staleTime: 30_000,
    enabled: friendsEnabled,
  });
  const requests = useQuery({
    ...orpc.social.friends.requests.queryOptions(),
    staleTime: 15_000,
    enabled: friendsEnabled,
  });

  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: t("Social") }} />
        <Screen>
          <SocialNavigation current="overview" />
          <Title subtitle={t("Private by default, useful by mutual choice")}>
            {t("Your social space")}
          </Title>
          <PrivacyBoundaryNotice />

          {profile.isLoading ||
          (friendsEnabled && (friends.isLoading || requests.isLoading)) ? (
            <Loading />
          ) : profile.isError ||
            (friendsEnabled && (friends.isError || requests.isError)) ? (
            <Empty
              icon="cloud-offline-outline"
              title={t("Social data could not be refreshed")}
              body={t("Reconnect before making a sharing decision.")}
            />
          ) : (
            <>
              <Section title={t("Your profile")}>
                <Card style={{ gap: space.md }}>
                  <SocialIdentity
                    displayName={
                      profile.data?.profile?.displayName ?? t("Private profile")
                    }
                    handle={profile.data?.profile?.handle}
                  />
                  <Row
                    first
                    title={t("Review exactly what friends can see")}
                    subtitle={t(
                      "Permissions are field-by-field and reversible",
                    )}
                    onPress={() => router.push("/social/profile")}
                  />
                  {!friendsEnabled ? (
                    <Row
                      title={t("Activate friend features")}
                      subtitle={t(
                        "Groups work without a discoverable friend profile",
                      )}
                      onPress={() => router.push("/social/profile")}
                    />
                  ) : null}
                </Card>
              </Section>

              <View style={{ flexDirection: "row", gap: space.md }}>
                <Card style={{ flex: 1, alignItems: "center", gap: space.xs }}>
                  <Text style={[type.title, numeric, { color: palette.text }]}>
                    {friends.data?.friends.length ?? 0}
                  </Text>
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {t("Friends")}
                  </Text>
                </Card>
                <Card style={{ flex: 1, alignItems: "center", gap: space.xs }}>
                  <Text style={[type.title, numeric, { color: palette.text }]}>
                    {requests.data?.incoming.length ?? 0}
                  </Text>
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {t("Requests")}
                  </Text>
                </Card>
              </View>

              <Section title={t("Connect")}>
                <Card padded={false}>
                  <Row
                    first
                    title={t("Friends and requests")}
                    subtitle={t(
                      "Mutual acceptance, exact handle or private invitation",
                    )}
                    onPress={() => router.push("/social/friends")}
                  />
                  <Row
                    title={t("Groups and classes")}
                    subtitle={t(
                      "Join only after reviewing the current sharing policy",
                    )}
                    onPress={() => router.push("/social/groups")}
                  />
                  <Row
                    title={t("Notifications")}
                    subtitle={t(
                      "Friend, invitation, consent and moderation updates",
                    )}
                    onPress={() => router.push("/social/notifications")}
                  />
                </Card>
              </Section>
            </>
          )}
        </Screen>
      </>
    </SocialRouteGate>
  );
}
