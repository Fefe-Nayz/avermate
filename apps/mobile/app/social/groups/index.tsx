import { Stack, useRouter } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { Icon } from "@/components/icon";
import {
  Badge,
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
import { orpc } from "@/lib/orpc";
import { usePalette } from "@/lib/theme";

/** Classes share one academic structure; friendships remain the generic social link. */
export default function Groups() {
  const palette = usePalette();
  const router = useRouter();
  const groups = useQuery(orpc.social.groups.list.queryOptions());

  return (
    <>
      <Stack.Screen options={{ title: t("Classes") }} />
      <Screen>
        <Note>
          {t(
            "A class brings together people who use the same subjects, periods and grading scale.",
          )}
        </Note>

        <Button
          label={t("New class")}
          icon="add"
          onPress={() => router.push("/social/groups/new")}
        />

        <Section title={t("Your classes")}>
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
                    (group.memberCount === 1
                      ? t("1 member")
                      : t("{count} members", { count: group.memberCount })) +
                    (group.linkedYearName
                      ? ` · ${group.linkedYearName}`
                      : group.setupRequired
                        ? ` · ${t("Setup required")}`
                        : ` · ${t("Choose a class year")}`)
                  }
                  trailing={
                    group.state === "frozen" ? (
                      <Badge
                        label={t("On hold")}
                        icon="snow-outline"
                        toneColor="negative"
                      />
                    ) : group.yearStatus === "incompatible" ? (
                      <Badge
                        label={t("Incompatible year")}
                        toneColor="negative"
                      />
                    ) : group.role === "owner" ? (
                      <Badge
                        label={t("Owner")}
                        icon="crown"
                        toneColor="accent"
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
              title={t("No classes yet")}
              body={t(
                "Create a class from one of your school years, build a new model, or open an invitation.",
              )}
            />
          )}
        </Section>
      </Screen>
    </>
  );
}
