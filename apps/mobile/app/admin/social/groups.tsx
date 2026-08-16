import { useState } from "react";
import { Alert } from "react-native";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminGate } from "@/components/admin/admin-gate";
import { ChoiceField, TextField } from "@/components/field";
import { Icon } from "@/components/icon";
import {
  Badge,
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
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { usePalette } from "@/lib/theme";

/**
 * The web's class oversight (`admin/social/groups`), aligned: search and
 * state filter over every group on the instance, then two actions — hold
 * (figures hidden, nothing lost) and delete. Holds are for reports; deletion
 * is for spam.
 */

export default function AdminSocialGroups() {
  const palette = usePalette();
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"all" | "active" | "frozen">("all");
  const [notice, setNotice] = useState<string | null>(null);
  const groups = useQuery(
    orpc.admin.socialGroups.queryOptions({
      input: { search: search.trim(), state },
    }),
  );

  const refresh = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.admin.socialGroups.key(),
    });
  const setGroupState = useMutation({
    ...orpc.admin.setSocialGroupState.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success");
      setNotice(
        result.state === "frozen"
          ? t("Class placed on hold.")
          : t("Hold lifted."),
      );
      await refresh();
    },
  });
  const remove = useMutation({
    ...orpc.admin.deleteSocialGroup.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setNotice(t("Class deleted."));
      await refresh();
    },
  });

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Classes") }} />
      <Screen>
        <Note>{t("Hold a reported class, or delete it outright.")}</Note>
        <TextField
          label={t("Search")}
          value={search}
          onChangeText={setSearch}
          placeholder={t("Search by name…")}
          autoCapitalize="none"
        />
        <ChoiceField
          label={t("State")}
          value={state}
          onChange={(value) => setState(value as typeof state)}
          columns={2}
          choices={[
            { value: "all", label: t("All states") },
            { value: "active", label: t("Active") },
            { value: "frozen", label: t("On hold") },
          ]}
        />
        <Section title={t("Classes")}>
          {notice ? <Confirmation>{notice}</Confirmation> : null}
          {groups.isLoading ? (
            <Loading />
          ) : groups.isError ? (
            <Problem>{t("Classes could not be refreshed.")}</Problem>
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
                          setGroupState.mutate({
                            groupId: group.id,
                            state:
                              group.state === "frozen" ? "active" : "frozen",
                          }),
                      },
                      {
                        text: t("Delete class"),
                        style: "destructive",
                        onPress: () =>
                          Alert.alert(
                            t("Delete this class?"),
                            t(
                              "It disappears for every member. Nobody's grades are affected.",
                            ),
                            [
                              { text: t("Cancel"), style: "cancel" },
                              {
                                text: t("Delete class"),
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
              title={t("No classes match")}
              body={t("Adjust the search or the state filter.")}
            />
          )}
        </Section>
      </Screen>
    </AdminGate>
  );
}
