import { useState } from "react";
import { Text, View } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SwitchField } from "@/components/field";
import { socialMetricValue } from "@/components/social/group-policy-ui";
import { socialMetricLabel } from "@/components/social/social-copy";
import { SocialRouteGate } from "@/components/social/social-gate";
import {
  isSocialMetric,
  type SocialMetric,
} from "@/components/social/social-model";
import {
  PrivacyBoundaryNotice,
  SocialMetricCard,
} from "@/components/social/social-ui";
import {
  Card,
  Confirmation,
  Empty,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { numeric, space, type, usePalette } from "@/lib/theme";

function percentileLabel(value: string | null): string {
  if (value === "top_quartile") return t("Top quartile");
  if (value === "upper_middle") return t("Upper-middle quartile");
  if (value === "lower_middle") return t("Lower-middle quartile");
  if (value === "bottom_quartile") return t("Bottom quartile");
  return t("Not participating");
}

export default function GroupMetric() {
  const params = useLocalSearchParams<{ groupId: string; metric: string }>();
  const palette = usePalette();
  const metric: SocialMetric = isSocialMetric(params.metric)
    ? params.metric
    : "normalizedAverage";
  const valid = isSocialMetric(params.metric);
  const details = useQuery({
    ...orpc.social.groups.get.queryOptions({
      input: { groupId: params.groupId },
    }),
    enabled: valid,
  });
  const field = details.data?.policy.fields.find(
    (item) => item.fieldKey === metric,
  );
  const active = details.data?.group.membershipState === "active";
  const policyState = useQuery({
    ...orpc.social.groups.policy.current.queryOptions({
      input: { groupId: params.groupId },
    }),
    enabled: valid && active,
  });
  const stats = useQuery({
    ...orpc.social.groups.stats.queryOptions({
      input: { groupId: params.groupId, metric },
    }),
    enabled: valid && active,
  });
  const rankings = useQuery({
    ...orpc.social.groups.rankings.queryOptions({
      input: { groupId: params.groupId, metric },
    }),
    enabled: valid && active && field?.exposure === "ranking",
    retry: false,
  });
  const [rankingChoice, setRankingChoice] = useState<boolean | null>(null);
  const rankingOptIn = useMutation({
    ...orpc.social.groups.policy.setRankingOptIn.mutationOptions(),
    onSuccess: async (result) => {
      setRankingChoice(result.enabled);
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.rankings.queryKey({
          input: { groupId: params.groupId, metric },
        }),
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.policy.current.queryKey({
          input: { groupId: params.groupId },
        }),
      });
    },
  });

  if (!valid) {
    return (
      <Screen>
        <Empty
          icon="lock-closed-outline"
          title={t("Unavailable metric")}
          body={t("No social data was requested.")}
        />
      </Screen>
    );
  }

  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: socialMetricLabel(metric) }} />
        <Screen>
          <PrivacyBoundaryNotice compact />
          {details.isLoading || stats.isLoading ? (
            <Loading />
          ) : details.isError || !details.data || !field ? (
            <Empty
              icon="lock-closed-outline"
              title={t("This metric is not in the current policy")}
              body={t(
                "The group policy may have changed. Return to the group and review it.",
              )}
            />
          ) : !active ? (
            <Empty
              icon="shield-checkmark-outline"
              title={t("Consent required")}
              body={t(
                "Accept the exact current policy before group statistics become available.",
              )}
            />
          ) : stats.isError || !stats.data ? (
            <Problem>{t("Group statistics could not be refreshed.")}</Problem>
          ) : !stats.data.available ? (
            <Empty
              icon="shield-outline"
              title={t("Protected until the group is large enough")}
              body={
                stats.data.reason === "consent_required"
                  ? t("Consent is required first.")
                  : t(
                      "Only {count} consenting members currently contribute; at least {required} are required.",
                      {
                        count: stats.data.memberCount,
                        required: stats.data.requiredMemberCount,
                      },
                    )
              }
            />
          ) : (
            <>
              <Section title={t("Group aggregate")}>
                <Note>
                  {t(
                    "Built only from members who accepted this metric under policy version {version}.",
                    {
                      version: stats.data.policyVersion,
                    },
                  )}
                </Note>
                {stats.data.summary ? (
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: space.md,
                    }}
                  >
                    <SocialMetricCard
                      label={t("Minimum")}
                      value={`${stats.data.summary.minimum ?? "—"} %`}
                    />
                    <SocialMetricCard
                      label={t("Median")}
                      value={`${stats.data.summary.median ?? "—"} %`}
                    />
                    <SocialMetricCard
                      label={t("Maximum")}
                      value={`${stats.data.summary.maximum ?? "—"} %`}
                    />
                    <SocialMetricCard
                      label={t("Middle half")}
                      value={`${stats.data.summary.lowerQuartile ?? "—"}–${stats.data.summary.upperQuartile ?? "—"} %`}
                    />
                  </View>
                ) : (
                  <Card padded={false}>
                    {stats.data.buckets.map((bucket, index) => (
                      <Row
                        key={bucket.key}
                        first={index === 0}
                        title={socialMetricValue({ band: bucket.key })}
                        subtitle={
                          bucket.suppressed
                            ? t("Protected small bucket")
                            : t("{count} members", { count: bucket.count })
                        }
                      />
                    ))}
                  </Card>
                )}
              </Section>

              {field.exposure === "ranking" ? (
                <Section title={t("Optional ranking")}>
                  <Note>
                    {t(
                      "This is a second opt-in. Under-18 accounts receive only a private percentile band; adult names appear only after the ranking threshold is met.",
                    )}
                  </Note>
                  <SwitchField
                    label={t("Participate in this ranking")}
                    hint={t(
                      "This affects only this metric and can be switched off at any time.",
                    )}
                    value={
                      rankingChoice ??
                      Boolean(
                        policyState.data?.viewerRankingOptIns.includes(metric),
                      )
                    }
                    disabled={rankingOptIn.isPending || policyState.isLoading}
                    onValueChange={(enabled) =>
                      rankingOptIn.mutate({
                        groupId: params.groupId,
                        metric,
                        enabled,
                      })
                    }
                  />
                  {rankingChoice !== null ? (
                    <Confirmation>
                      {rankingChoice
                        ? t("Ranking participation is enabled for this metric.")
                        : t(
                            "Ranking participation is disabled for this metric.",
                          )}
                    </Confirmation>
                  ) : null}
                  {rankingOptIn.isError || rankings.isError ? (
                    <Problem>
                      {t(
                        "Ranking preference or results could not be refreshed.",
                      )}
                    </Problem>
                  ) : rankings.isLoading ? (
                    <Loading />
                  ) : rankings.data && !rankings.data.available ? (
                    <Note>
                      {t(
                        "The named ranking stays hidden until its separate privacy threshold is met.",
                      )}
                    </Note>
                  ) : rankings.data?.mode === "private_percentile" ? (
                    <Card>
                      <Text style={[type.label, { color: palette.textFaint }]}>
                        {t("Your private position")}
                      </Text>
                      <Text style={[type.title, { color: palette.text }]}>
                        {percentileLabel(rankings.data.viewerPercentileBand)}
                      </Text>
                    </Card>
                  ) : rankings.data?.mode === "named_opt_in" ? (
                    <Card padded={false}>
                      {rankings.data.entries.map((entry, index) => (
                        <Row
                          key={entry.membershipId}
                          first={index === 0}
                          title={`${entry.rank}. ${entry.alias}`}
                          trailing={
                            <Text
                              style={[
                                type.heading,
                                numeric,
                                { color: palette.text },
                              ]}
                            >
                              {entry.score} %
                            </Text>
                          }
                        />
                      ))}
                    </Card>
                  ) : null}
                </Section>
              ) : null}
            </>
          )}
        </Screen>
      </>
    </SocialRouteGate>
  );
}
