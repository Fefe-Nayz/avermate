import { useMemo, useState } from "react";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
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
import { Button, Card, Note, Problem, Screen, Section } from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";

type GroupType = "friends" | "study_group" | "class";
type Window = "current_academic_year" | "last_90_days" | "last_30_days";
type MetricChoice = {
  selected: boolean;
  required: boolean;
  exposure: SocialExposure;
};

const initialMetrics = Object.fromEntries(
  SOCIAL_METRICS.map((metric) => [
    metric,
    {
      selected: metric === "normalizedAverage",
      required: false,
      exposure: "aggregate_only",
    },
  ]),
) as Record<SocialMetric, MetricChoice>;

export default function NewSocialGroup() {
  const router = useRouter();
  const { year, years } = useYear();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [type, setType] = useState<GroupType>("study_group");
  const [classSelfDeclared, setClassSelfDeclared] = useState(false);
  const [alias, setAlias] = useState("");
  const [sharedYearId, setSharedYearId] = useState(year?.id ?? "");
  const [purpose, setPurpose] = useState("");
  const [audienceDescription, setAudienceDescription] = useState("");
  const [window, setWindow] = useState<Window>("current_academic_year");
  const [rankingsEnabled, setRankingsEnabled] = useState(false);
  const [metrics, setMetrics] = useState(initialMetrics);
  const [accepted, setAccepted] = useState(false);

  const selectedFields = useMemo(
    () =>
      SOCIAL_METRICS.filter((metric) => metrics[metric].selected).map(
        (fieldKey) => ({ fieldKey, ...metrics[fieldKey] }),
      ),
    [metrics],
  );
  const valid =
    name.trim().length >= 2 &&
    alias.trim().length > 0 &&
    purpose.trim().length >= 10 &&
    audienceDescription.trim().length >= 3 &&
    Boolean(sharedYearId) &&
    selectedFields.length > 0 &&
    accepted &&
    (type !== "class" || classSelfDeclared);

  const create = useMutation({
    ...orpc.social.groups.create.mutationOptions(),
    onSuccess: async (result) => {
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.replace(`/social/groups/${result.group.id}`);
    },
  });

  const updateMetric = (metric: SocialMetric, patch: Partial<MetricChoice>) => {
    setMetrics((current) => ({
      ...current,
      [metric]: { ...current[metric], ...patch },
    }));
  };

  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: t("Create a group") }} />
        <Screen
          footer={
            <Button
              label={t("Create with this policy")}
              disabled={!valid || create.isPending}
              loading={create.isPending}
              onPress={() =>
                create.mutate({
                  name: name.trim(),
                  description: description.trim(),
                  type,
                  classSelfDeclared: type === "class" && classSelfDeclared,
                  alias: alias.trim(),
                  sharedYearId,
                  accepted: true,
                  channel: "mobile",
                  policy: {
                    purpose: purpose.trim(),
                    audienceDescription: audienceDescription.trim(),
                    window,
                    rankingsEnabled,
                    fields: selectedFields.map(
                      ({ fieldKey, required, exposure }) => ({
                        fieldKey,
                        required,
                        exposure,
                      }),
                    ),
                  },
                })
              }
            />
          }
        >
          <PrivacyBoundaryNotice />
          <Section title={t("Group identity")}>
            <TextField
              label={t("Group name")}
              value={name}
              onChangeText={setName}
              maxLength={100}
            />
            <TextField
              label={t("Description")}
              value={description}
              onChangeText={setDescription}
              maxLength={500}
              multiline
            />
            <ChoiceField<GroupType>
              label={t("Group type")}
              value={type}
              onChange={setType}
              choices={[
                { value: "friends", label: t("Friends group") },
                { value: "study_group", label: t("Study group") },
                { value: "class", label: t("Self-declared class") },
              ]}
            />
            {type === "class" ? (
              <SwitchField
                label={t("I confirm this class is self-declared")}
                hint={t(
                  "It is not an official enrolment record or school-verified directory.",
                )}
                value={classSelfDeclared}
                onValueChange={setClassSelfDeclared}
              />
            ) : null}
            <TextField
              label={t("Your group alias")}
              value={alias}
              onChangeText={setAlias}
              maxLength={60}
              placeholder={t("A name group members will see")}
            />
            <ChoiceField<string>
              label={t("School year used for your derived metrics")}
              value={sharedYearId}
              onChange={setSharedYearId}
              choices={years.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
            />
          </Section>

          <Section title={t("Version 1 sharing policy")}>
            <TextField
              label={t("Purpose")}
              value={purpose}
              onChangeText={setPurpose}
              maxLength={500}
              multiline
              placeholder={t("Why these aggregated metrics help this group")}
            />
            <TextField
              label={t("Who is expected to join")}
              value={audienceDescription}
              onChangeText={setAudienceDescription}
              maxLength={240}
              placeholder={t("For example: students in the same study project")}
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
            <Note>
              {t(
                "Aggregate-only is the default. Raw grades, subjects, comments and dates can never be selected.",
              )}
            </Note>
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
                        hint={t(
                          "People who decline a required field cannot activate membership under this policy.",
                        )}
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
              hint={t(
                "Still off for every member until a separate opt-in; privacy thresholds always apply.",
              )}
              value={rankingsEnabled}
              onValueChange={(enabled) => {
                setRankingsEnabled(enabled);
                if (!enabled) {
                  setMetrics(
                    (current) =>
                      Object.fromEntries(
                        SOCIAL_METRICS.map((metric) => [
                          metric,
                          {
                            ...current[metric],
                            exposure:
                              current[metric].exposure === "ranking"
                                ? "aggregate_only"
                                : current[metric].exposure,
                          },
                        ]),
                      ) as Record<SocialMetric, MetricChoice>,
                  );
                }
              }}
            />
          </Section>

          <Section title={t("Your consent")}>
            <SwitchField
              label={t("I accept every required field in version 1")}
              hint={t(
                "Changing the policy creates a new immutable version and requires consent again.",
              )}
              value={accepted}
              onValueChange={setAccepted}
            />
            {create.isError ? (
              <Problem>{t("The group could not be created.")}</Problem>
            ) : null}
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
