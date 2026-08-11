import { Alert, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { GroupConsentForm } from "@/components/social/group-consent-form";
import {
  GroupPolicySummary,
  socialMetricValue,
} from "@/components/social/group-policy-ui";
import {
  groupTypeLabel,
  socialMetricLabel,
} from "@/components/social/social-copy";
import { SocialRouteGate } from "@/components/social/social-gate";
import { isSocialMetric } from "@/components/social/social-model";
import {
  PrivacyBoundaryNotice,
  SocialIdentity,
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
import { orpc, queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";

function roleLabel(role: string): string {
  if (role === "owner") return t("Owner");
  if (role === "moderator") return t("Moderator");
  return t("Member");
}

export default function SocialGroupDetails() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const palette = usePalette();
  const details = useQuery({
    ...orpc.social.groups.get.queryOptions({ input: { groupId } }),
    enabled: Boolean(groupId),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.get.queryKey({ input: { groupId } }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      }),
    ]);
  };
  const setRole = useMutation({
    ...orpc.social.groups.members.setRole.mutationOptions(),
    onSuccess: refresh,
  });
  const removeMember = useMutation({
    ...orpc.social.groups.members.remove.mutationOptions(),
    onSuccess: refresh,
  });
  const transfer = useMutation({
    ...orpc.social.groups.transfer.mutationOptions(),
    onSuccess: refresh,
  });
  const block = useMutation({
    ...orpc.social.blocks.create.mutationOptions(),
    onSuccess: refresh,
  });
  const withdraw = useMutation({
    ...orpc.social.groups.policy.withdraw.mutationOptions(),
    onSuccess: refresh,
  });
  const leave = useMutation({
    ...orpc.social.groups.members.leave.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.replace("/social/groups");
    },
  });

  if (details.isLoading) return <Loading />;

  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen
          options={{ title: details.data?.group.name ?? t("Group") }}
        />
        <Screen>
          <PrivacyBoundaryNotice compact />
          {details.isError || !details.data ? (
            <Empty
              icon="cloud-offline-outline"
              title={t("This group could not be loaded")}
              body={t(
                "Access may have changed. Reconnect before making a sharing decision.",
              )}
            />
          ) : (
            <>
              <Section>
                <Card style={{ gap: space.md }}>
                  <Text
                    selectable
                    style={[type.title, { color: palette.text }]}
                  >
                    {details.data.group.name}
                  </Text>
                  {details.data.group.description ? (
                    <Text
                      selectable
                      style={[type.body, { color: palette.textMuted }]}
                    >
                      {details.data.group.description}
                    </Text>
                  ) : null}
                  <Text style={[type.footnote, { color: palette.textFaint }]}>
                    {`${groupTypeLabel(details.data.group.type)} · ${roleLabel(details.data.group.role)} · ${t("{count} members", { count: details.data.group.memberCount })}`}
                  </Text>
                </Card>
              </Section>

              {details.data.group.membershipState === "consent_required" ? (
                <GroupConsentForm
                  groupId={groupId}
                  policy={details.data.policy}
                  onAccepted={refresh}
                />
              ) : (
                <>
                  <GroupPolicySummary policy={details.data.policy} />

                  <Section title={t("Shared statistics")}>
                    <Card padded={false}>
                      {details.data.policy.fields.map((field, index) => (
                        <Row
                          key={field.fieldKey}
                          first={index === 0}
                          title={
                            isSocialMetric(field.fieldKey)
                              ? socialMetricLabel(field.fieldKey)
                              : t("Unavailable metric")
                          }
                          subtitle={t(
                            "Aggregates, ranges and optional rankings",
                          )}
                          onPress={() =>
                            router.push({
                              pathname: "/social/groups/[groupId]/metric",
                              params: { groupId, metric: field.fieldKey },
                            })
                          }
                        />
                      ))}
                    </Card>
                  </Section>

                  <Section title={t("Members")}>
                    {details.data.members.length === 0 ? (
                      <Empty
                        icon="people-outline"
                        title={t("No active members")}
                        body={t(
                          "Members awaiting consent do not expose metrics.",
                        )}
                      />
                    ) : (
                      details.data.members.map((member) => {
                        const self =
                          member.membershipId ===
                          details.data.group.membershipId;
                        const manager =
                          details.data.group.role === "owner" ||
                          details.data.group.role === "moderator";
                        return (
                          <Card
                            key={member.membershipId}
                            style={{ gap: space.md }}
                          >
                            <SocialIdentity
                              displayName={member.alias}
                              secondary={`${roleLabel(member.role)} · ${
                                member.state === "active"
                                  ? t("Active")
                                  : t("Consent required")
                              }`}
                            />
                            {Object.keys(member.metrics).length > 0 ? (
                              <View style={{ gap: space.xs }}>
                                {Object.entries(member.metrics).map(
                                  ([metric, value]) => (
                                    <Text
                                      key={metric}
                                      selectable
                                      style={[
                                        type.footnote,
                                        { color: palette.textMuted },
                                      ]}
                                    >
                                      {isSocialMetric(metric)
                                        ? socialMetricLabel(metric)
                                        : metric}
                                      : {socialMetricValue(value)}
                                    </Text>
                                  ),
                                )}
                              </View>
                            ) : null}
                            {!self && manager ? (
                              <View style={{ gap: space.sm }}>
                                {details.data.group.role === "owner" &&
                                member.role !== "owner" ? (
                                  <Button
                                    label={
                                      member.role === "moderator"
                                        ? t("Make member")
                                        : t("Make moderator")
                                    }
                                    variant="ghost"
                                    disabled={setRole.isPending}
                                    onPress={() =>
                                      setRole.mutate({
                                        groupId,
                                        membershipId: member.membershipId,
                                        role:
                                          member.role === "moderator"
                                            ? "member"
                                            : "moderator",
                                      })
                                    }
                                  />
                                ) : null}
                                {details.data.group.role === "owner" &&
                                member.state === "active" ? (
                                  <Button
                                    label={t("Transfer ownership")}
                                    variant="ghost"
                                    disabled={transfer.isPending}
                                    onPress={() =>
                                      Alert.alert(
                                        t("Transfer group ownership?"),
                                        t(
                                          "You become a regular member and cannot undo this without the new owner.",
                                        ),
                                        [
                                          {
                                            text: t("Cancel"),
                                            style: "cancel",
                                          },
                                          {
                                            text: t("Transfer"),
                                            onPress: () =>
                                              transfer.mutate({
                                                groupId,
                                                membershipId:
                                                  member.membershipId,
                                                expectedRevision:
                                                  details.data.group.revision,
                                              }),
                                          },
                                        ],
                                      )
                                    }
                                  />
                                ) : null}
                                <Button
                                  label={t("Remove from group")}
                                  variant="destructive"
                                  disabled={removeMember.isPending}
                                  onPress={() =>
                                    removeMember.mutate({
                                      groupId,
                                      membershipId: member.membershipId,
                                    })
                                  }
                                />
                              </View>
                            ) : null}
                            {!self ? (
                              <View style={{ gap: space.sm }}>
                                <Button
                                  label={t("Block member")}
                                  variant="ghost"
                                  disabled={block.isPending}
                                  onPress={() =>
                                    block.mutate({
                                      source: "group_membership",
                                      sourceId: member.membershipId,
                                    })
                                  }
                                />
                                <Button
                                  label={t("Report member")}
                                  variant="ghost"
                                  onPress={() =>
                                    router.push({
                                      pathname: "/social/report",
                                      params: {
                                        source: "group_membership",
                                        sourceId: member.membershipId,
                                        groupId,
                                      },
                                    })
                                  }
                                />
                              </View>
                            ) : null}
                          </Card>
                        );
                      })
                    )}
                  </Section>

                  <Section title={t("Group actions")}>
                    {details.data.group.role === "owner" ||
                    details.data.group.role === "moderator" ? (
                      <Button
                        label={t("Manage invitation links")}
                        variant="secondary"
                        onPress={() =>
                          router.push(`/social/groups/${groupId}/invitations`)
                        }
                      />
                    ) : null}
                    {details.data.group.role === "owner" ? (
                      <Button
                        label={t("Group settings and policy")}
                        variant="secondary"
                        onPress={() =>
                          router.push(`/social/groups/${groupId}/manage`)
                        }
                      />
                    ) : null}
                    <Button
                      label={t("Withdraw sharing consent")}
                      variant="ghost"
                      loading={withdraw.isPending}
                      onPress={() => withdraw.mutate({ groupId })}
                    />
                    <Button
                      label={t("Report this group")}
                      variant="ghost"
                      onPress={() =>
                        router.push({
                          pathname: "/social/report",
                          params: { source: "group", sourceId: groupId },
                        })
                      }
                    />
                    {details.data.group.role !== "owner" ? (
                      <Button
                        label={t("Leave group")}
                        variant="destructive"
                        loading={leave.isPending}
                        onPress={() => leave.mutate({ groupId })}
                      />
                    ) : (
                      <Note>
                        {t("Transfer ownership before leaving this group.")}
                      </Note>
                    )}
                    {setRole.isError ||
                    removeMember.isError ||
                    transfer.isError ||
                    block.isError ||
                    withdraw.isError ||
                    leave.isError ? (
                      <Problem>
                        {t(
                          "The group action could not be completed. Refresh and try again.",
                        )}
                      </Problem>
                    ) : null}
                  </Section>
                </>
              )}
            </>
          )}
        </Screen>
      </>
    </SocialRouteGate>
  );
}
