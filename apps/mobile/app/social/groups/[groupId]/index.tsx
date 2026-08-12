import { useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import {
  SharedAverageText,
  SocialIdentity,
  comparisonLabel,
  comparisonUnit,
  groupKindLabel,
} from "@/components/social/social-ui";
import { ChoiceField, SwitchField, TextField } from "@/components/field";
import {
  Button,
  Card,
  ChipRail,
  Empty,
  Loading,
  Note,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { env } from "@/lib/env";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { numeric, space, type, usePalette } from "@/lib/theme";

type ComparisonKind =
  | "general"
  | "subject"
  | "median"
  | "passRate"
  | "goalProgress";

/**
 * One group: several boards side by side. The chip rail picks the active
 * comparison and the leaderboard, stats and trends follow it. The owner
 * composes the boards; every member's only lock is their own switch.
 */
export default function GroupDetail() {
  const palette = usePalette();
  const router = useRouter();
  const { years, refresh: refreshYears } = useYear();
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
  const adopt = useMutation({
    ...orpc.social.groups.adoptSetup.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      refreshYears();
      await queryClient.invalidateQueries({
        queryKey: orpc.years.list.queryKey(),
      });
      Alert.alert(
        t("Year created"),
        t("Find it in your year picker. It is fully yours from here."),
      );
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
  const addComparison = useMutation({
    ...orpc.social.groups.comparisons.add.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setAddSubject("");
      await refresh();
    },
    onError: () =>
      Alert.alert(t("That comparison already exists."), undefined),
  });
  const removeComparison = useMutation({
    ...orpc.social.groups.comparisons.remove.mutationOptions(),
    onSuccess: refresh,
  });

  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [kind, setKind] = useState<"friends" | "study" | "class">("friends");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [addKind, setAddKind] = useState<ComparisonKind>("subject");
  const [addSubject, setAddSubject] = useState("");

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
  const comparisons = group.comparisons;
  const active =
    comparisons.find((entry) => entry.id === activeId) ?? comparisons[0];
  const activeUnit = active ? comparisonUnit(active.kind) : "scale";

  const figureOf = (member: (typeof group.members)[number]) =>
    active
      ? (member.figures.find((figure) => figure.scopeId === active.id) ?? null)
      : null;
  const sharers = group.members
    .filter((member) => figureOf(member)?.average != null)
    .sort(
      (left, right) =>
        (figureOf(right)?.average ?? 0) - (figureOf(left)?.average ?? 0),
    );
  const silent = group.members.filter(
    (member) => figureOf(member)?.average == null,
  );
  const ratios = sharers
    .map((member) => figureOf(member)?.average as number)
    .sort((left, right) => left - right);
  const mean =
    ratios.length === 0
      ? null
      : ratios.reduce((total, value) => total + value, 0) / ratios.length;
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
        <Note>
          {groupKindLabel(group.kind) +
            (group.description ? ` · ${group.description}` : "")}
        </Note>

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
              label={t("Share my figures with this group")}
              hint={t(
                "Off means the others see you in the list without figures.",
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

        <Section title={t("Boards")}>
          <ChipRail
            items={comparisons.map((entry) => ({
              id: entry.id,
              label: comparisonLabel(entry.kind, entry.subjectName),
            }))}
            activeId={active?.id ?? ""}
            onSelect={setActiveId}
          />
          {isOwner && !frozen ? (
            <Card style={{ gap: space.md }}>
              <ChoiceField
                label={t("Add a board")}
                value={addKind}
                onChange={setAddKind}
                columns={2}
                choices={[
                  { value: "subject", label: t("A subject") },
                  { value: "general", label: t("General average") },
                  { value: "median", label: t("Median grade") },
                  { value: "passRate", label: t("Pass rate") },
                  { value: "goalProgress", label: t("Goals achieved") },
                ]}
              />
              {addKind === "subject" ? (
                group.availableSubjects.length > 0 ? (
                  <ChoiceField
                    label={t("Subject")}
                    value={addSubject || null}
                    onChange={setAddSubject}
                    columns={2}
                    choices={group.availableSubjects.map((name) => ({
                      value: name,
                      label: name,
                    }))}
                  />
                ) : (
                  <Note>
                    {t(
                      "The picker lists the template year's subjects, or yours. Offer a common configuration below to widen it.",
                    )}
                  </Note>
                )
              ) : null}
              <Button
                label={t("Add")}
                variant="secondary"
                icon="add"
                disabled={addKind === "subject" && !addSubject}
                loading={addComparison.isPending}
                onPress={() =>
                  addComparison.mutate({
                    groupId: groupId ?? "",
                    kind: addKind,
                    subjectName:
                      addKind === "subject" ? addSubject : undefined,
                  })
                }
              />
              {comparisons.length > 1 && active ? (
                <Button
                  label={t("Remove this board")}
                  variant="ghost"
                  disabled={removeComparison.isPending}
                  onPress={() =>
                    Alert.alert(
                      comparisonLabel(active.kind, active.subjectName),
                      undefined,
                      [
                        { text: t("Cancel"), style: "cancel" },
                        {
                          text: t("Remove this board"),
                          style: "destructive",
                          onPress: () => {
                            setActiveId(null);
                            removeComparison.mutate({
                              groupId: groupId ?? "",
                              comparisonId: active.id,
                            });
                          },
                        },
                      ],
                    )
                  }
                />
              ) : null}
            </Card>
          ) : null}
        </Section>

        {!frozen && active && ratios.length > 0 ? (
          <Section
            title={comparisonLabel(active.kind, active.subjectName)}
          >
            <Card padded={false}>
              <Row
                first
                title={t("Group average")}
                trailing={
                  <SharedAverageText
                    ratio={mean}
                    scale={statScale}
                    decimals={statDecimals}
                    unit={activeUnit}
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
                    unit={activeUnit}
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
                      unit={activeUnit}
                    />
                    <Text style={[type.footnote, { color: palette.textFaint }]}>
                      →
                    </Text>
                    <SharedAverageText
                      ratio={ratios.at(-1) ?? null}
                      scale={statScale}
                      decimals={statDecimals}
                      unit={activeUnit}
                    />
                  </View>
                }
              />
            </Card>
          </Section>
        ) : null}

        <Section title={t("Leaderboard")}>
          <Card padded={false}>
            {[...sharers, ...silent].map((member, index) => {
              const figure = figureOf(member);
              return (
                <Row
                  key={member.membershipId}
                  first={index === 0}
                  title={member.name}
                  subtitle={
                    [
                      member.role === "owner" ? t("Owner") : null,
                      figure?.gradeCount != null
                        ? figure.gradeCount === 1
                          ? t("1 grade")
                          : t("{count} grades", { count: figure.gradeCount })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || undefined
                  }
                  leading={
                    figure?.average != null ? (
                      <Text
                        style={[
                          type.callout,
                          numeric,
                          {
                            color: palette.textFaint,
                            width: 22,
                            textAlign: "center",
                          },
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
                      {figure?.trend ? (
                        <Ionicons
                          name={
                            figure.trend === "up"
                              ? "trending-up-outline"
                              : figure.trend === "down"
                                ? "trending-down-outline"
                                : "remove-outline"
                          }
                          size={16}
                          color={
                            figure.trend === "up"
                              ? palette.positive
                              : figure.trend === "down"
                                ? palette.negative
                                : palette.textFaint
                          }
                        />
                      ) : null}
                      <SharedAverageText
                        ratio={figure?.average ?? null}
                        scale={member.scale}
                        decimals={member.decimals}
                        unit={activeUnit}
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
              );
            })}
          </Card>
          {!frozen && silent.length > 0 ? (
            <Note>
              {t(
                "Members without a figure keep their switch off, or have no year to share.",
              )}
            </Note>
          ) : null}
        </Section>

        {!frozen ? (
          <Section title={t("Common configuration")}>
            <Card style={{ gap: space.md }}>
              {group.sharedSetup ? (
                <>
                  <Note>
                    {group.sharedSetup.yearName +
                      " — " +
                      t(
                        "{subjects} subjects · {averages} custom averages · {periods} periods",
                        {
                          subjects: group.sharedSetup.subjectCount,
                          averages: group.sharedSetup.averageCount,
                          periods: group.sharedSetup.periodCount,
                        },
                      )}
                  </Note>
                  <Button
                    label={t("Adopt this configuration")}
                    variant="secondary"
                    icon="copy-outline"
                    loading={adopt.isPending}
                    onPress={() =>
                      Alert.alert(
                        t("Adopt this configuration?"),
                        t(
                          "This copies the subjects, periods and custom averages into a fresh year of your own. Never any grades — and it is a copy, not a subscription.",
                        ),
                        [
                          { text: t("Cancel"), style: "cancel" },
                          {
                            text: t("Create my year"),
                            onPress: () =>
                              adopt.mutate({ groupId: groupId ?? "" }),
                          },
                        ],
                      )
                    }
                  />
                </>
              ) : (
                <Note>{t("This group has no common configuration yet.")}</Note>
              )}
              {isOwner ? (
                <Button
                  label={t("Offer one of your years as the template")}
                  variant="ghost"
                  onPress={() =>
                    Alert.alert(t("Common configuration"), undefined, [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text: t("No common configuration"),
                        onPress: () =>
                          update.mutate({
                            groupId: groupId ?? "",
                            sharedSetupYearId: null,
                          }),
                      },
                      ...years.map((year) => ({
                        text: year.name,
                        onPress: () =>
                          update.mutate({
                            groupId: groupId ?? "",
                            sharedSetupYearId: year.id,
                          }),
                      })),
                    ])
                  }
                />
              ) : null}
            </Card>
          </Section>
        ) : null}

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
                <ChoiceField
                  label={t("Group type")}
                  value={kind}
                  onChange={setKind}
                  choices={[
                    { value: "friends", label: t("Friends group") },
                    { value: "study", label: t("Study group") },
                    { value: "class", label: t("Class") },
                  ]}
                />
                <SwitchField
                  label={t("Show each member's 30-day trend")}
                  value={group.showTrend}
                  disabled={update.isPending}
                  onValueChange={(value) =>
                    update.mutate({ groupId: groupId ?? "", showTrend: value })
                  }
                />
                <SwitchField
                  label={t("Show grade counts")}
                  value={group.showGradeCount}
                  disabled={update.isPending}
                  onValueChange={(value) =>
                    update.mutate({
                      groupId: groupId ?? "",
                      showGradeCount: value,
                    })
                  }
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
                      kind,
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
                  setKind(group.kind);
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
