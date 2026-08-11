import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { TextField } from "@/components/field";
import { SocialRouteGate } from "@/components/social/social-gate";
import { PrivacyBoundaryNotice } from "@/components/social/social-ui";
import {
  Button,
  Confirmation,
  Empty,
  Loading,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";

export default function ManageSocialGroup() {
  const { groupId } = useLocalSearchParams<{ groupId: string }>();
  const router = useRouter();
  const details = useQuery(
    orpc.social.groups.get.queryOptions({ input: { groupId } }),
  );
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!details.data) return;
    setName(details.data.group.name);
    setDescription(details.data.group.description);
  }, [details.data?.group.revision]);

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
  const update = useMutation({
    ...orpc.social.groups.update.mutationOptions(),
    onSuccess: async () => {
      setSaved(true);
      await refresh();
    },
  });
  const archive = useMutation({
    ...orpc.social.groups.archive.mutationOptions(),
    onSuccess: refresh,
  });
  const remove = useMutation({
    ...orpc.social.groups.delete.mutationOptions(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.replace("/social/groups");
    },
  });

  if (details.isLoading) return <Loading />;
  if (details.isError || !details.data || details.data.group.role !== "owner") {
    return (
      <Screen>
        <Empty
          icon="lock-closed-outline"
          title={t("Owner access required")}
          body={t("No group setting was changed.")}
        />
      </Screen>
    );
  }

  const group = details.data.group;
  return (
    <SocialRouteGate requireActiveProfile={false}>
      <>
        <Stack.Screen options={{ title: t("Group settings") }} />
        <Screen>
          <PrivacyBoundaryNotice compact />
          <Section title={t("Identity")}>
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
              multiline
              maxLength={500}
            />
            <Button
              label={t("Save group")}
              disabled={!name.trim() || update.isPending}
              loading={update.isPending}
              onPress={() => {
                setSaved(false);
                update.mutate({
                  groupId,
                  name: name.trim(),
                  description: description.trim(),
                  expectedRevision: group.revision,
                });
              }}
            />
            {saved ? <Confirmation>{t("Group saved.")}</Confirmation> : null}
          </Section>

          <Section title={t("Sharing policy")}>
            <Note>
              {t(
                "Editing a policy always creates a new immutable version, pauses every membership and disables ranking opt-ins until people consent again.",
              )}
            </Note>
            <Button
              label={t("Create a new policy version")}
              variant="secondary"
              onPress={() => router.push(`/social/groups/${groupId}/policy`)}
            />
          </Section>

          <Section title={t("Group lifecycle")}>
            <Button
              label={
                group.state === "archived"
                  ? t("Restore group")
                  : t("Archive group")
              }
              variant="secondary"
              loading={archive.isPending}
              onPress={() =>
                archive.mutate({
                  groupId,
                  archived: group.state !== "archived",
                  expectedRevision: group.revision,
                })
              }
            />
            <Button
              label={t("Delete group permanently")}
              variant="destructive"
              loading={remove.isPending}
              onPress={() =>
                Alert.alert(
                  t("Delete this group permanently?"),
                  t(
                    "Memberships, invitations, consents and group statistics are removed. This cannot be undone.",
                  ),
                  [
                    { text: t("Cancel"), style: "cancel" },
                    {
                      text: t("Delete"),
                      style: "destructive",
                      onPress: () =>
                        remove.mutate({
                          groupId,
                          expectedRevision: group.revision,
                        }),
                    },
                  ],
                )
              }
            />
          </Section>
          {update.isError || archive.isError || remove.isError ? (
            <Problem>
              {t("The group changed elsewhere. Refresh and try again.")}
            </Problem>
          ) : null}
        </Screen>
      </>
    </SocialRouteGate>
  );
}
