import { useEffect, useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ChoiceField, TextField } from "@/components/field";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";
import { useYear } from "@/components/year-provider";

/** A class invitation requires an explicit compatible year before joining. */
export default function GroupInvitation() {
  const router = useRouter();
  const { selectYear } = useYear();
  const { token } = useLocalSearchParams<{ token: string }>();
  const [selectedYearId, setSelectedYearId] = useState<string | null>(null);
  const [copyName, setCopyName] = useState("");
  const preview = useQuery({
    ...orpc.social.groups.invitations.preview.queryOptions({
      input: { token: token ?? "" },
    }),
    enabled: Boolean(token),
    retry: false,
  });
  const accept = useMutation({
    ...orpc.social.groups.invitations.accept.mutationOptions(),
    onSuccess: async (result, input) => {
      haptic("success");
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.social.groups.list.queryKey(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.years.list.queryKey(),
        }),
      ]);
      if (input.year?.mode === "copy" && result.yearId) {
        selectYear(result.yearId);
      }
      router.replace(`/social/groups/${result.groupId}`);
    },
  });

  const data = preview.data;
  useEffect(() => {
    if (!selectedYearId && data?.compatibleYears[0]) {
      setSelectedYearId(data.compatibleYears[0].id);
    }
  }, [data?.compatibleYears, selectedYearId]);

  const template = data?.group.classTemplate ?? null;

  return (
    <>
      <Stack.Screen options={{ title: t("Class invitation") }} />
      <Screen>
        {preview.isLoading ? (
          <Loading />
        ) : !data ? (
          <Empty
            icon="link-outline"
            title={t("This invitation is no longer valid")}
            body={t("It may have expired, been revoked, or the class is gone.")}
            action={
              <Button
                label={t("Go to classes")}
                variant="secondary"
                onPress={() => router.replace("/social/groups")}
              />
            }
          />
        ) : (
          <Section title={data.group.name}>
            <Card style={{ gap: space.lg }}>
              {data.group.description ? (
                <Note>{data.group.description}</Note>
              ) : null}
              {template ? (
                <>
                  <Note>
                    {`${template.yearName} · ${t("{start} to {end}", {
                      start: new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        year: "numeric",
                      }).format(new Date(template.startsAt)),
                      end: new Intl.DateTimeFormat(undefined, {
                        month: "short",
                        year: "numeric",
                      }).format(new Date(template.endsAt)),
                    })}`}
                  </Note>
                  <Note>
                    {t(
                      "{subjects} subjects · {periods} periods · grades out of {scale}",
                      {
                        subjects: template.subjectCount,
                        periods: template.periodCount,
                        scale: template.scale,
                      },
                    )}
                  </Note>
                </>
              ) : null}
              <Note>
                {data.inviter
                  ? t("{name} invites you. {count} people are in this class.", {
                      name: data.inviter.name,
                      count: data.group.memberCount,
                    })
                  : t("{count} people are in this class.", {
                      count: data.group.memberCount,
                    })}
              </Note>
              <Note>
                {t(
                  "Your figures stay hidden when you join. You can share them after your class year is connected.",
                )}
              </Note>
              {data.alreadyMember ? (
                <Button
                  label={t("You are already a member.")}
                  variant="secondary"
                  onPress={() => router.replace("/social/groups")}
                />
              ) : data.group.setupRequired || !template ? (
                <Empty
                  icon="hourglass"
                  title={t("This class is not ready yet")}
                  body={t(
                    "Its owner still needs to choose the class template before anyone can join.",
                  )}
                />
              ) : (
                <>
                  {data.compatibleYears.length > 0 ? (
                    <>
                      <ChoiceField
                        label={t("Use an existing year")}
                        value={selectedYearId}
                        onChange={setSelectedYearId}
                        choices={data.compatibleYears.map((year) => ({
                          value: year.id,
                          label: year.name,
                          hint: t("{start} to {end}", {
                            start: new Intl.DateTimeFormat(undefined, {
                              month: "short",
                              year: "numeric",
                            }).format(new Date(year.startsAt)),
                            end: new Intl.DateTimeFormat(undefined, {
                              month: "short",
                              year: "numeric",
                            }).format(new Date(year.endsAt)),
                          }),
                        }))}
                      />
                      <Button
                        label={t("Join with this year")}
                        disabled={!selectedYearId}
                        loading={accept.isPending}
                        onPress={() =>
                          selectedYearId &&
                          accept.mutate({
                            token: token ?? "",
                            year: {
                              mode: "existing",
                              yearId: selectedYearId,
                            },
                          })
                        }
                      />
                    </>
                  ) : (
                    <Note>
                      {t(
                        "None of your existing years matches this class template.",
                      )}
                    </Note>
                  )}

                  <TextField
                    label={t("New year name (optional)")}
                    value={copyName}
                    onChangeText={setCopyName}
                    placeholder={template.yearName}
                    maxLength={100}
                  />
                  <Button
                    label={t("Create a new year and join")}
                    variant={
                      data.compatibleYears.length ? "secondary" : "primary"
                    }
                    loading={accept.isPending}
                    onPress={() =>
                      accept.mutate({
                        token: token ?? "",
                        year: {
                          mode: "copy",
                          ...(copyName.trim() ? { name: copyName.trim() } : {}),
                        },
                      })
                    }
                  />
                  <Note>
                    {t(
                      "This creates a separate year from the class template. None of your existing years or grades will be changed.",
                    )}
                  </Note>
                  {accept.isError ? (
                    <Problem>
                      {t(
                        "The class could not be joined. Check that the invitation and selected year are still valid.",
                      )}
                    </Problem>
                  ) : null}
                </>
              )}
            </Card>
          </Section>
        )}
      </Screen>
    </>
  );
}
