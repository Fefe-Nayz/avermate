import { useEffect, useState } from "react";
import { Stack } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  SharedAverageText,
} from "@/components/social/social-ui";
import { ChoiceField, SwitchField, TextField } from "@/components/field";
import {
  Button,
  Card,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";

/**
 * The locks. Everything a friend can ever see of this account is decided
 * here, and the preview at the bottom is the exact server answer they get.
 */
export default function Sharing() {
  const sharing = useQuery(orpc.social.sharing.get.queryOptions());
  const { years } = useYear();
  const [handle, setHandle] = useState<string | null>(null);

  const settings = sharing.data;
  const yearId = settings?.sharedYearId ?? settings?.resolvedYear?.id ?? "";
  const subjects = useQuery({
    ...orpc.subjects.list.queryOptions({ input: { yearId } }),
    enabled: Boolean(yearId),
  });

  useEffect(() => {
    if (settings && handle === null) setHandle(settings.handle ?? "");
  }, [settings, handle]);

  const update = useMutation({
    ...orpc.social.sharing.update.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await queryClient.invalidateQueries({
        queryKey: orpc.social.sharing.get.queryKey(),
      });
    },
  });

  if (sharing.isLoading) {
    return (
      <>
        <Stack.Screen options={{ title: t("Sharing") }} />
        <Loading />
      </>
    );
  }
  if (sharing.isError || !settings) {
    return (
      <>
        <Stack.Screen options={{ title: t("Sharing") }} />
        <Screen>
          <Problem>{t("Sharing settings could not be loaded.")}</Problem>
        </Screen>
      </>
    );
  }

  const sharedSet = new Set(settings.sharedSubjectIds);
  const leafSubjects = (subjects.data ?? []).filter(
    (subject) => subject.kind !== "category",
  );

  return (
    <>
      <Stack.Screen options={{ title: t("Sharing") }} />
      <Screen>
        <Section title={t("Your handle")}>
          <Card style={{ gap: space.md }}>
            <TextField
              label={t("Handle")}
              value={handle ?? ""}
              onChangeText={setHandle}
              placeholder={t("your-handle")}
              autoCapitalize="none"
              maxLength={32}
              error={
                update.isError ? t("That handle is already taken.") : undefined
              }
            />
            <Button
              label={t("Save handle")}
              variant="secondary"
              disabled={(handle ?? "") === (settings.handle ?? "")}
              loading={update.isPending}
              onPress={() =>
                update.mutate({
                  handle: handle?.trim() ? handle.trim() : null,
                })
              }
            />
            <Note>
              {t(
                "Friends find you with it. Leave empty to be reachable by invitation link only.",
              )}
            </Note>
          </Card>
        </Section>

        <Section title={t("What friends see")}>
          <Card style={{ gap: space.lg }}>
            <SwitchField
              label={t("General average")}
              hint={t("One number for the whole year.")}
              value={settings.shareGeneralAverage}
              disabled={update.isPending}
              onValueChange={(value) =>
                update.mutate({ shareGeneralAverage: value })
              }
            />
            <ChoiceField
              label={t("Subject averages")}
              value={settings.shareSubjectsMode}
              onChange={(value) =>
                update.mutate({ shareSubjectsMode: value })
              }
              choices={[
                { value: "all", label: t("All subjects") },
                { value: "selected", label: t("Only subjects I pick") },
                { value: "none", label: t("No subjects") },
              ]}
            />
            <ChoiceField
              label={t("Year being shared")}
              value={settings.sharedYearId ?? "__current__"}
              onChange={(value) =>
                update.mutate({
                  sharedYearId: value === "__current__" ? null : value,
                })
              }
              choices={[
                {
                  value: "__current__",
                  label: settings.resolvedYear
                    ? t("My current year ({name})", {
                        name: settings.resolvedYear.name,
                      })
                    : t("My current year"),
                },
                ...years.map((year) => ({ value: year.id, label: year.name })),
              ]}
            />
          </Card>
        </Section>

        {settings.shareSubjectsMode === "selected" ? (
          <Section title={t("Subjects you share")}>
            <Card style={{ gap: space.md }}>
              {subjects.isLoading ? (
                <Loading />
              ) : leafSubjects.length ? (
                leafSubjects.map((subject) => (
                  <SwitchField
                    key={subject.id}
                    label={subject.name}
                    value={sharedSet.has(subject.id)}
                    disabled={update.isPending}
                    onValueChange={(next) => {
                      const ids = new Set(settings.sharedSubjectIds);
                      if (next) ids.add(subject.id);
                      else ids.delete(subject.id);
                      update.mutate({ sharedSubjectIds: [...ids] });
                    }}
                  />
                ))
              ) : (
                <Note>{t("The shared year has no subjects yet.")}</Note>
              )}
            </Card>
          </Section>
        ) : null}

        <Section title={t("Exactly what a friend sees")}>
          {settings.preview ? (
            <Card padded={false}>
              <Row
                first
                title={t("General average")}
                trailing={
                  settings.preview.shareGeneralAverage ? (
                    <SharedAverageText
                      ratio={settings.preview.generalAverage}
                      scale={settings.preview.year.scale}
                      decimals={settings.preview.year.decimals}
                    />
                  ) : undefined
                }
                subtitle={
                  settings.preview.shareGeneralAverage
                    ? undefined
                    : t("Locked")
                }
              />
              {settings.preview.subjects.map((subject) => (
                <Row
                  key={subject.id}
                  title={subject.name}
                  trailing={
                    <SharedAverageText
                      ratio={subject.average}
                      scale={settings.preview?.year.scale ?? null}
                      decimals={settings.preview?.year.decimals ?? null}
                    />
                  }
                />
              ))}
            </Card>
          ) : (
            <Card>
              <Note>
                {t(
                  "Friends currently see nothing: both locks are closed, or there is no academic year to share yet.",
                )}
              </Note>
            </Card>
          )}
        </Section>
      </Screen>
    </>
  );
}
