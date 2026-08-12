import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  Card,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";
import { usePalette } from "@/lib/theme";

/** Moderation at a glance: four counts and two doors. */
export function AdminSocialOverviewScreen() {
  const palette = usePalette();
  const router = useRouter();
  const overview = useQuery(orpc.admin.socialOverview.queryOptions());

  return (
    <>
      <Stack.Screen options={{ title: t("Social moderation") }} />
      <Screen>
        <Note>
          {t("Reports and group holds. Academic figures never appear here.")}
        </Note>
        {overview.isLoading ? (
          <Loading />
        ) : overview.isError ? (
          <Problem>{t("Moderation counts could not be refreshed.")}</Problem>
        ) : (
          <Section title={t("Today")}>
            <Card padded={false}>
              <Row
                first
                title={t("Friendships")}
                trailing={undefined}
                subtitle={String(overview.data?.friendships ?? 0)}
              />
              <Row
                title={t("Groups")}
                subtitle={String(overview.data?.groups ?? 0)}
              />
              <Row
                title={t("Open reports")}
                subtitle={String(overview.data?.openReports ?? 0)}
              />
              <Row
                title={t("Sharing profiles")}
                subtitle={String(overview.data?.profiles ?? 0)}
              />
            </Card>
          </Section>
        )}
        <Section title={t("Queues")}>
          <Card padded={false}>
            <Row
              first
              title={t("Reports")}
              leading={
                <Ionicons
                  name="flag-outline"
                  size={19}
                  color={palette.textMuted}
                />
              }
              onPress={() => router.push("/admin/social/reports")}
            />
            <Row
              title={t("Groups")}
              leading={
                <Ionicons
                  name="people-circle-outline"
                  size={19}
                  color={palette.textMuted}
                />
              }
              onPress={() => router.push("/admin/social/groups")}
            />
          </Card>
        </Section>
      </Screen>
    </>
  );
}
