import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { SocialRouteGate } from "@/components/social/social-gate";
import {
  Empty,
  Loading,
  Problem,
  Row,
  Card,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc } from "@/lib/orpc";

function reportCategory(value: string): string {
  if (value === "harassment") return t("Harassment");
  if (value === "privacy") return t("Privacy violation");
  if (value === "impersonation") return t("Impersonation");
  if (value === "unsafe_content") return t("Unsafe content");
  return t("Other");
}

function reportStatus(value: string): string {
  if (value === "open") return t("Open");
  if (value === "reviewing") return t("Under review");
  if (value === "resolved") return t("Resolved");
  if (value === "dismissed") return t("Dismissed");
  return t("Closed");
}

export default function SocialReports() {
  const reports = useQuery(orpc.social.reports.mine.queryOptions());
  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: t("Submitted reports") }} />
        <Screen>
          <Section title={t("Moderation status")}>
            {reports.isLoading ? (
              <Loading />
            ) : reports.isError ? (
              <Problem>{t("Report status could not be refreshed.")}</Problem>
            ) : (reports.data?.length ?? 0) === 0 ? (
              <Empty
                icon="shield-checkmark-outline"
                title={t("No submitted reports")}
                body={t(
                  "Safety reports you create appear here without identifying the target.",
                )}
              />
            ) : (
              <Card padded={false}>
                {reports.data?.map((report, index) => (
                  <Row
                    key={report.id}
                    first={index === 0}
                    title={reportCategory(report.category)}
                    subtitle={`${reportStatus(report.status)} · ${new Intl.DateTimeFormat(
                      undefined,
                      {
                        dateStyle: "medium",
                      },
                    ).format(new Date(report.createdAt))}`}
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
