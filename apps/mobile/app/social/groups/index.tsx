import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import { TextField } from "@/components/field";
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
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space, usePalette } from "@/lib/theme";

/**
 * Groups: rooms whose members compare general averages. Creating one asks
 * for a name, nothing else.
 */
export default function Groups() {
  const palette = usePalette();
  const router = useRouter();
  const groups = useQuery(orpc.social.groups.list.queryOptions());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    ...orpc.social.groups.create.mutationOptions(),
    onSuccess: async (result) => {
      haptic("success");
      setName("");
      setCreating(false);
      await queryClient.invalidateQueries({
        queryKey: orpc.social.groups.list.queryKey(),
      });
      router.push(`/social/groups/${result.id}`);
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: t("Groups") }} />
      <Screen>
        <Note>
          {t(
            "Compare general averages with a class or a group of friends. Each member decides whether their own figure appears.",
          )}
        </Note>

        {creating ? (
          <Card style={{ gap: space.md }}>
            <TextField
              label={t("Group name")}
              value={name}
              onChangeText={setName}
              maxLength={100}
              autoFocus
            />
            <TextField
              label={t("Description (optional)")}
              value={description}
              onChangeText={setDescription}
              multiline
              maxLength={500}
            />
            <Button
              label={t("Create group")}
              disabled={name.trim().length < 2}
              loading={create.isPending}
              onPress={() =>
                create.mutate({
                  name: name.trim(),
                  description: description.trim(),
                })
              }
            />
            <Button
              label={t("Cancel")}
              variant="ghost"
              onPress={() => setCreating(false)}
            />
          </Card>
        ) : (
          <Button
            label={t("New group")}
            icon="add"
            onPress={() => setCreating(true)}
          />
        )}

        <Section title={t("Your groups")}>
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
                    (group.memberCount === 1
                      ? t("1 member")
                      : t("{count} members", { count: group.memberCount })) +
                    (group.state === "frozen" ? ` · ${t("On hold")}` : "") +
                    (group.role === "owner" ? ` · ${t("Owner")}` : "")
                  }
                  leading={
                    <Ionicons
                      name={
                        group.state === "frozen"
                          ? "snow-outline"
                          : "people-circle-outline"
                      }
                      size={19}
                      color={palette.textMuted}
                    />
                  }
                  onPress={() => router.push(`/social/groups/${group.id}`)}
                />
              ))}
            </Card>
          ) : (
            <Empty
              icon="people-circle-outline"
              title={t("No groups yet")}
              body={t(
                "Create one and send the link, or open an invitation someone sent you.",
              )}
            />
          )}
        </Section>
      </Screen>
    </>
  );
}
