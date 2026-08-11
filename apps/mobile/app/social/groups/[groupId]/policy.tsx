import { useEffect, useMemo, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChoiceField, SwitchField, TextField } from "@/components/field";
import {
  socialExposureLabel,
  socialMetricLabel,
} from "@/components/social/social-copy";
import { SocialRouteGate } from "@/components/social/social-gate";
import {
  SOCIAL_METRICS,
  type SocialExposure,
  type SocialMetric,
} from "@/components/social/social-model";
import { PrivacyBoundaryNotice } from "@/components/social/social-ui";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";

type Window = "current_academic_year" | "last_90_days" | "last_30_days";
type MetricChoice = {
  selected: boolean;
  required: boolean;
  exposure: SocialExposure;
};

const emptyChoices = () =>
  Object.fromEntries(
    SOCIAL_METRICS.map((metric) => [
      metric,
      { selected: false, required: false, exposure: "aggregate_only" },
    ]),
  ) as Record<SocialMetric, MetricChoice>;

export default function NewGroupPolicyVersion() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const details = useQuery(
    orpc.social.groups.get.queryOptions({ input: { groupId } }),
  );
  const [purpose, setPurpose] = useState("");
  const [audienceDescription, setAudienceDescription] = useState("");
  const [window, setWindow] = useState<Window>("current_academic_year");
  const [rankingsEnabled, setRankingsEnabled] = useState(false);
  const [metrics, setMetrics] = useState(emptyChoices);
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (!details.data) return;
    const policy = details.data.policy;
    setPurpose(policy.purpose);
    setAudienceDescription(policy.audienceDescription);
    setWindow(policy.window);
    setRankingsEnabled(policy.rankingsEnabled);
    const next = emptyChoices();
    for (const field of policy.fields) {
      next[field.fieldKey] = {
        selected: true,
        required: field.required,
        exposure: field.exposure,
      };
    }
    setMetrics(next);
  }, [details.data?.policy.digest]);

  const fields = useMemo(
    () =>
      SOCIAL_METRICS.filter((metric) => metrics[metric].selected).map(
        (fieldKey) => ({
          fieldKey,
          required: metrics[fieldKey].required,
          exposure: metrics[fieldKey].exposure,
        }),
      ),
    [metrics],
  );
  const create = useMutation({
    ...orpc.social.groups.policy.createVersion.mutationOptions(),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.get.queryKey({ input: { groupId } }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.list.queryKey(),
        }),
      ]);
      router.replace(`/social/groups/${groupId}`);
    },
  });
  const updateMetric = (metric: SocialMetric, patch: Partial<MetricChoice>) =>
    setMetrics((current) => ({
      ...current,
      [metric]: { ...current[metric], ...patch },
    }));

  if (details.isLoading) return <Loading />;
  if (details.isError || !details.data || details.data.group.role !== "owner") {
    return (
      <Screen>
        <Empty
          icon="lock-closed-outline"
          title={t("Owner access required")}
          body={t("No policy was changed.")}
        />
      </Screen>
    );
  }

  const valid =
    purpose.trim().length >= 10 &&
    audienceDescription.trim().length >= 3 &&
    fields.length > 0 &&
    acknowledged;

  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: t("New policy version") }} />
        <Screen
          footer={
            <Button
              label={t("Publish version {version}", {
                version: details.data.group.currentPolicyVersion + 1,
              })}
              disabled={!valid || create.isPending}
              loading={create.isPending}
              onPress={() =>
                create.mutate({
                  groupId,
                  expectedRevision: details.data.group.revision,
                  policy: {
                    purpose: purpose.trim(),
                    audienceDescription: audienceDescription.trim(),
                    window,
                    rankingsEnabled,
                    fields,
                  },
                })
              }
            />
          }
        >
          <PrivacyBoundaryNotice />
          <Section title={t("Purpose and audience")}>
            <TextField
              label={t("Purpose")}
              value={purpose}
              onChangeText={setPurpose}
              multiline
              maxLength={500}
            />
            <TextField
              label={t("Who is expected to participate")}
              value={audienceDescription}
              onChangeText={setAudienceDescription}
              maxLength={240}
            />
            <ChoiceField<Window>
              label={t("Time window")}
              value={window}
              onChange={setWindow}
              choices={[
                {
                  value: "current_academic_year",
                  label: t("Current academic year"),
                },
                { value: "last_90_days", label: t("Last 90 days") },
                { value: "last_30_days", label: t("Last 30 days") },
              ]}
            />
          </Section>

          <Section title={t("Derived metrics")}>
            {SOCIAL_METRICS.map((metric) => {
              const choice = metrics[metric];
              const canRank = [
                "normalizedAverage",
                "median",
                "genericGoalProgress",
              ].includes(metric);
              return (
                <Card key={metric} style={{ gap: space.md }}>
                  <SwitchField
                    label={socialMetricLabel(metric)}
                    value={choice.selected}
                    onValueChange={(selected) =>
                      updateMetric(metric, { selected })
                    }
                  />
                  {choice.selected ? (
                    <>
                      <ChoiceField<SocialExposure>
                        label={t("Visibility")}
                        value={choice.exposure}
                        onChange={(exposure) =>
                          updateMetric(metric, { exposure })
                        }
                        choices={[
                          {
                            value: "aggregate_only",
                            label: socialExposureLabel("aggregate_only"),
                          },
                          {
                            value: "member_visible",
                            label: socialExposureLabel("member_visible"),
                          },
                          ...(rankingsEnabled && canRank
                            ? [
                                {
                                  value: "ranking" as const,
                                  label: socialExposureLabel("ranking"),
                                },
                              ]
                            : []),
                        ]}
                      />
                      <SwitchField
                        label={t("Required to participate")}
                        value={choice.required}
                        onValueChange={(required) =>
                          updateMetric(metric, { required })
                        }
                      />
                    </>
                  ) : null}
                </Card>
              );
            })}
            <SwitchField
              label={t("Allow optional named rankings")}
              value={rankingsEnabled}
              onValueChange={setRankingsEnabled}
            />
          </Section>

          <Section title={t("Reconsent impact")}>
            <Note>
              {t(
                "Publishing pauses every membership, clears ranking opt-ins and requires each person to review the new immutable policy before any further sharing.",
              )}
            </Note>
            <SwitchField
              label={t("I understand everyone must consent again")}
              value={acknowledged}
              onValueChange={setAcknowledged}
            />
            {create.isError ? (
              <Problem>{t("The policy could not be published.")}</Problem>
            ) : null}
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
