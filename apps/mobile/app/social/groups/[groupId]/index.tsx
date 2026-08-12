import { useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  SharedAverageText,
  SocialIdentity,
} from "@/components/social/social-ui";
import { SwitchField, TextField } from "@/components/field";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { env } from "@/lib/env";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { numeric, space, type, usePalette } from "@/lib/theme";

/**
 * One group: the leaderboard, your own switch, the invite link, and the
 * owner's tools. Sharers rank first with real figures; non-sharers follow.
 */
export default function GroupDetail() {
  const palette = usePalette();
  const router = useRouter();
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const detail = useQuery({
    ...orpc.social.groups.get.queryOptions({
      input: { groupId: groupId ?? "" },
    }),
    enabled: Boolean(groupId),
  });

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.get.queryKey({
          input: { groupId: groupId ?? "" },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      }),
    ]);

  const setSharing = useMutation({
    ...orpc.social.groups.setSharing.mutationOptions(),
    onSuccess: refresh,
  });
  const invite = useMutation({
    ...orpc.social.groups.invitations.create.mutationOptions(),
    onSuccess: async (invitation) => {
      haptic("success");
      await Share.share({
        message: `${env.webUrl}/social/invitations/${invitation.token}`,
      });
    },
  });
  const removeMember = useMutation({
    ...orpc.social.groups.removeMember.mutationOptions(),
    onSuccess: refresh,
  });
  const leave = useMutation({
    ...orpc.social.groups.leave.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.back();
    },
    onError: () =>
      Alert.alert(
        t("You still own this group"),
        t("Transfer or remove the other members first, or delete the group."),
      ),
  });
  const destroy = useMutation({
    ...orpc.social.groups.delete.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.back();
    },
  });

  const update = useMutation({
    ...orpc.social.groups.update.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setEditing(false);
      await refresh();
    },
  });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const group = detail.data;

  if (detail.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: t("Group") }} />
        <Loading />
      </>
    );
  }
  if (detail.isError || !group) {
    return (
      <>
        <Stack.Screen options={{ title: t("Group") }} />
        <Screen>
          <Empty
            icon="people-circle-outline"
            title={t("This group could not be found")}
            body={t("It may have been deleted, or you were removed.")}
          />
        </Screen>
      </>
    );
  }

  const isOwner = group.viewer.role === "owner";
  const frozen = group.state === "frozen";
  const sharers = group.members
    .filter((member) => member.average !== null)
    .sort((left, right) => (right.average ?? 0) - (left.average ?? 0));
  const silent = group.members.filter((member) => member.average === null);

  // The payload already carries every shared ratio; the stats row is
  // arithmetic, not another request.
  const ratios = sharers
    .map((member) => member.average as number)
    .sort((left, right) => left - right);
  const median =
    ratios.length === 0
      ? null
      : ratios.length % 2 === 1
        ? (ratios[(ratios.length - 1) / 2] ?? null)
        : ((ratios[ratios.length / 2 - 1] ?? 0) +
            (ratios[ratios.length / 2] ?? 0)) /
          2;
  const statScale = sharers[0]?.scale ?? null;
  const statDecimals = sharers[0]?.decimals ?? null;

  return (
    <>
      <Stack.Screen options={{ title: group.name }} />
      <Screen>
        {group.description ? <Note>{group.description}</Note> : null}

        {frozen ? (
          <Card>
            <Note>
              {t(
                "A moderator paused this group after a report. Figures are hidden until the hold is lifted; nothing has been deleted.",
              )}
            </Note>
          </Card>
        ) : (
          <Card style={{ gap: space.md }}>
            <SwitchField
              label={t("Share my average with this group")}
              hint={t(
                "Off means the others see you in the list without a figure.",
              )}
              value={group.viewer.shareAverage}
              disabled={setSharing.isPending}
              onValueChange={(value) =>
                setSharing.mutate({
                  groupId: groupId ?? "",
                  shareAverage: value,
                })
              }
            />
          </Card>
        )}

        {!frozen && ratios.length > 0 ? (
          <Section title={t("Group figures")}>
            <Card padded={false}>
              <Row
                first
                title={t("Group average")}
                trailing={
                  <SharedAverageText
                    ratio={group.groupAverage}
                    scale={statScale}
                    decimals={statDecimals}
                  />
                }
              />
              <Row
                title={t("Median")}
                trailing={
                  <SharedAverageText
                    ratio={median}
                    scale={statScale}
                    decimals={statDecimals}
                  />
                }
              />
              <Row
                title={t("Range")}
                trailing={
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.xs,
                    }}
                  >
                    <SharedAverageText
                      ratio={ratios[0] ?? null}
                      scale={statScale}
                      decimals={statDecimals}
                    />
                    <Text style={[type.footnote, { color: palette.textFaint }]}>
                      →
                    </Text>
                    <SharedAverageText
                      ratio={ratios.at(-1) ?? null}
                      scale={statScale}
                      decimals={statDecimals}
                    />
                  </View>
                }
              />
            </Card>
          </Section>
        ) : null}

        <Section title={t("Leaderboard")}>
          <Card padded={false}>
            {[...sharers, ...silent].map((member, index) => (
              <Row
                key={member.membershipId}
                first={index === 0}
                title={member.name}
                subtitle={member.role === "owner" ? t("Owner") : undefined}
                leading={
                  member.average !== null ? (
                    <Text
                      style={[
                        type.callout,
                        numeric,
                        { color: palette.textFaint, width: 22, textAlign: "center" },
                      ]}
                    >
                      {index + 1}
                    </Text>
                  ) : (
                    <View style={{ width: 22 }} />
                  )
                }
                trailing={
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                    }}
                  >
                    <SharedAverageText
                      ratio={member.average}
                      scale={member.scale}
                      decimals={member.decimals}
                    />
                  </View>
                }
                onPress={
                  isOwner && member.role !== "owner" && !frozen
                    ? () =>
                        Alert.alert(member.name, undefined, [
                          { text: t("Cancel"), style: "cancel" },
                          {
                            text: t("Remove from group"),
                            style: "destructive",
                            onPress: () =>
                              removeMember.mutate({
                                groupId: groupId ?? "",
                                membershipId: member.membershipId,
                              }),
                          },
                        ])
                    : undefined
                }
              />
            ))}
          </Card>
          {!frozen && silent.length > 0 ? (
            <Note>
              {t("Members without a figure keep their switch off, or have no year to share.")}
            </Note>
          ) : null}
        </Section>

        {!frozen ? (
          <Section title={t("Invite people")}>
            <Card style={{ gap: space.md }}>
              <Button
                label={t("Share an invitation link")}
                variant="secondary"
                icon="link-outline"
                loading={invite.isPending}
                onPress={() => invite.mutate({ groupId: groupId ?? "" })}
              />
              <Note>
                {t(
                  "Anyone with the link joins directly. It works for a month or until revoked.",
                )}
              </Note>
            </Card>
          </Section>
        ) : null}

        {isOwner && !frozen ? (
          <Section title={t("Group settings")}>
            {editing ? (
              <Card style={{ gap: space.md }}>
                <TextField
                  label={t("Group name")}
                  value={name}
                  onChangeText={setName}
                  maxLength={100}
                />
                <TextField
                  label={t("Description (optional)")}
                  value={description}
                  onChangeText={setDescription}
                  multiline
                  maxLength={500}
                />
                <Button
                  label={t("Save")}
                  disabled={name.trim().length < 2}
                  loading={update.isPending}
                  onPress={() =>
                    update.mutate({
                      groupId: groupId ?? "",
                      name: name.trim(),
                      description: description.trim(),
                    })
                  }
                />
                <Button
                  label={t("Cancel")}
                  variant="ghost"
                  onPress={() => setEditing(false)}
                />
              </Card>
            ) : (
              <Button
                label={t("Edit name and description")}
                variant="secondary"
                onPress={() => {
                  setName(group.name);
                  setDescription(group.description);
                  setEditing(true);
                }}
              />
            )}
          </Section>
        ) : null}

        <Section title={t("Actions")}>
          <Card style={{ gap: space.sm }}>
            {isOwner ? (
              <Button
                label={t("Delete group")}
                variant="destructive"
                disabled={destroy.isPending}
                onPress={() =>
                  Alert.alert(
                    t("Delete this group?"),
                    t(
                      "The group and its memberships disappear for everyone. Nobody's grades are affected.",
                    ),
                    [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text: t("Delete group"),
                        style: "destructive",
                        onPress: () =>
                          destroy.mutate({ groupId: groupId ?? "" }),
                      },
                    ],
                  )
                }
              />
            ) : (
              <Button
                label={t("Leave group")}
                variant="secondary"
                disabled={leave.isPending}
                onPress={() => leave.mutate({ groupId: groupId ?? "" })}
              />
            )}
            <Button
              label={t("Report a safety concern")}
              variant="ghost"
              onPress={() =>
                router.push({
                  pathname: "/social/report",
                  params: { groupId: groupId ?? "" },
                })
              }
            />
          </Card>
        </Section>
      </Screen>
    </>
  );
}
