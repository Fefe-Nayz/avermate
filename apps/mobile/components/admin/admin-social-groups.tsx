import { Alert } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import {
  Badge,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { usePalette } from "@/lib/theme";

/** Every group on the instance; hold or delete, nothing else. */
export function AdminSocialGroupsScreen() {
  const palette = usePalette();
  const groups = useQuery(
    orpc.admin.socialGroups.queryOptions({
      input: { search: "", state: "all" },
    }),
  );

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.admin.socialGroups.key(),
    });
  const setState = useMutation({
    ...orpc.admin.setSocialGroupState.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
    },
  });
  const remove = useMutation({
    ...orpc.admin.deleteSocialGroup.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: t("Groups") }} />
      <Screen>
        <Note>{t("Hold a reported group, or delete it outright.")}</Note>
        <Section title={t("All groups")}>
          {groups.isLoading ? (
            <Loading />
          ) : groups.isError ? (
            <Problem>{t("Groups could not be refreshed.")}</Problem>
          ) : groups.data?.length ? (
            <Card padded={false}>
              {groups.data.map((group, index) => (
                <Row
                  key={group.id}
                  first={index === 0}
                  title={group.name}
                  subtitle={
                    t("Owner: {name}", { name: group.ownerName }) +
                    ` · ${
                      group.memberCount === 1
                        ? t("1 member")
                        : t("{count} members", { count: group.memberCount })
                    }`
                  }
                  trailing={
                    group.state === "frozen" ? (
                      <Badge
                        label={t("On hold")}
                        icon="snow-outline"
                        toneColor="negative"
                      />
                    ) : undefined
                  }
                  leading={
                    <Icon
                      name={
                        group.state === "frozen"
                          ? "snow-outline"
                          : "people-circle-outline"
                      }
                      size={19}
                      color={
                        group.state === "frozen"
                          ? palette.negative
                          : palette.textMuted
                      }
                    />
                  }
                  onPress={() =>
                    Alert.alert(group.name, undefined, [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text:
                          group.state === "frozen"
                            ? t("Lift hold")
                            : t("Put on hold"),
                        onPress: () =>
                          setState.mutate({
                            groupId: group.id,
                            state:
                              group.state === "frozen" ? "active" : "frozen",
                          }),
                      },
                      {
                        text: t("Delete group"),
                        style: "destructive",
                        onPress: () =>
                          Alert.alert(
                            t("Delete this group?"),
                            t(
                              "It disappears for every member. Nobody's grades are affected.",
                            ),
                            [
                              { text: t("Cancel"), style: "cancel" },
                              {
                                text: t("Delete group"),
                                style: "destructive",
                                onPress: () =>
                                  remove.mutate({ groupId: group.id }),
                              },
                            ],
                          ),
                      },
                    ])
                  }
                />
              ))}
            </Card>
          ) : (
            <Empty
              icon="people-circle-outline"
              title={t("No groups")}
              body={t("Nothing has been created yet.")}
            />
          )}
        </Section>
      </Screen>
    </>
  );
}
