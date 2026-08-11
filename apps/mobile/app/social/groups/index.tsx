import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { groupTypeLabel } from "@/components/social/social-copy";
import { SocialRouteGate } from "@/components/social/social-gate";
import {
  PrivacyBoundaryNotice,
  SocialNavigation,
} from "@/components/social/social-ui";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";

export default function SocialGroups() {
  const router = useRouter();
  const groups = useQuery(orpc.social.groups.list.queryOptions());

  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: t("Groups and classes") }} />
        <Screen>
          <SocialNavigation current="groups" />
          <PrivacyBoundaryNotice compact />
          <Note>
            {t(
              "Every group has a versioned policy. Joining never starts academic sharing until you accept the exact current fields and choose a school year.",
            )}
          </Note>
          <Button
            label={t("Create a group")}
            icon="add-outline"
            onPress={() => router.push("/social/groups/new")}
          />

          <Section title={t("Your groups")}>
            {groups.isLoading ? (
              <Loading />
            ) : groups.isError ? (
              <Problem>{t("Groups could not be refreshed.")}</Problem>
            ) : (groups.data?.groups.length ?? 0) === 0 ? (
              <Empty
                icon="people-outline"
                title={t("No groups yet")}
                body={t("Create one or open a private invitation link.")}
              />
            ) : (
              <Card padded={false}>
                {groups.data?.groups.map((group, index) => (
                  <Row
                    key={group.id}
                    first={index === 0}
                    title={group.name}
                    subtitle={
                      group.membershipState === "consent_required"
                        ? t("Review updated sharing policy")
                        : `${groupTypeLabel(group.type)} · ${t("{count} members", { count: group.memberCount })}`
                    }
                    onPress={() => router.push(`/social/groups/${group.id}`)}
                  />
                ))}
              </Card>
            )}
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
