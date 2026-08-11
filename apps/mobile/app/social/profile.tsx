import { useEffect, useMemo, useState } from "react";
import { Alert, Share, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ChoiceField,
  PickerField,
  SwitchField,
  TextField,
} from "@/components/field";
import {
  SOCIAL_PROFILE_FIELDS,
  type SocialProfileField,
} from "@/components/social/social-model";
import {
  socialProfileFieldLabel,
  educationBandLabel,
} from "@/components/social/social-copy";
import {
  PrivacyBoundaryNotice,
  SocialIdentity,
  SocialNavigation,
} from "@/components/social/social-ui";
import {
  Button,
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
import { client, orpc, queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";
import {
  discardSocialInvitation,
  peekSocialInvitation,
} from "@/lib/social-invitation-session";

type Discovery = "off" | "invite_only" | "exact_handle";
type EducationBand =
  "unknown" | "middle_school" | "high_school" | "higher_education" | "other";

export default function SocialProfile() {
  const router = useRouter();
  const { resume } = useLocalSearchParams<{ resume?: string }>();
  const palette = usePalette();
  const mine = useQuery(orpc.social.profile.mine.queryOptions());
  const [active, setActive] = useState(false);
  const [discovery, setDiscovery] = useState<Discovery>("off");
  const [handle, setHandle] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [bio, setBio] = useState("");
  const [educationBand, setEducationBand] = useState<EducationBand>("unknown");
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const profile = mine.data?.profile;
  useEffect(() => {
    if (!profile) return;
    setActive(profile.status === "active");
    setDiscovery(profile.discovery);
    setHandle(profile.handle ?? "");
    setDisplayName(profile.displayName);
    setBio(profile.bio);
    setEducationBand(profile.educationBand);
  }, [profile?.revision]);

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.profile.mine.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.grants.list.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.eligibility.get.queryKey(),
      }),
    ]);
  };

  const save = useMutation({
    ...orpc.social.profile.update.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setSaved(true);
      setProblem(null);
      await refresh();
      if (active && resume && peekSocialInvitation(resume)?.kind === "friend") {
        router.replace({
          pathname: "/social/invitation-process",
          params: { flow: resume },
        });
      }
    },
    onError: (error) => {
      haptic("error");
      setSaved(false);
      setProblem(
        error instanceof Error && /handle.*unavailable/i.test(error.message)
          ? t("That exact handle is unavailable.")
          : t("The social profile could not be saved."),
      );
    },
  });

  const grant = useMutation({
    mutationFn: (fieldKey: SocialProfileField) =>
      client.social.grants.upsert({
        fieldKey,
        audience: "friends",
        audienceId: null,
      }),
    onSuccess: refresh,
    onError: () => {
      haptic("error");
      setProblem(t("That sharing permission could not be changed."));
    },
  });
  const revokeGrant = useMutation({
    mutationFn: (grantId: string) => client.social.grants.revoke({ grantId }),
    onSuccess: refresh,
    onError: () => {
      haptic("error");
      setProblem(t("That sharing permission could not be changed."));
    },
  });
  const withdraw = useMutation({
    ...orpc.social.eligibility.revoke.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      await refresh();
      router.replace("/social/setup");
    },
  });
  const exportSocial = useMutation({
    ...orpc.social.account.export.mutationOptions(),
    onSuccess: async (archive) => {
      await Share.share({
        title: t("My Avermate social data"),
        message: JSON.stringify(archive, null, 2),
      });
    },
  });
  const resetSocial = useMutation({
    ...orpc.social.account.reset.mutationOptions(),
    onSuccess: () => {
      queryClient.clear();
      router.replace("/social/setup");
    },
  });

  const friendGrants = useMemo(
    () =>
      new Map(
        (mine.data?.grants ?? [])
          .filter((item) => item.audience === "friends")
          .map((item) => [item.fieldKey, item]),
      ),
    [mine.data?.grants],
  );

  if (mine.isLoading) return <Loading />;
  if (mine.isError || !mine.data) {
    return (
      <Screen>
        <Section>
          <Empty
            icon="cloud-offline-outline"
            title={t("Profile permissions could not be loaded")}
            body={t("Reconnect before changing what other people can see.")}
          />
        </Section>
      </Screen>
    );
  }

  if (!mine.data.eligibility.canUseSocial || !profile) {
    return (
      <Screen>
        <Section>
          <Empty
            icon="shield-checkmark-outline"
            title={t("Complete consent first")}
            body={t(
              "A social profile cannot be activated before the current eligibility decision is complete.",
            )}
            action={
              <Button
                label={t("Review setup")}
                onPress={() => router.replace("/social/setup")}
              />
            }
          />
        </Section>
      </Screen>
    );
  }

  const ready =
    displayName.trim().length > 0 &&
    (discovery !== "exact_handle" || handle.trim().length >= 3);
  const previewName = friendGrants.has("displayName")
    ? displayName.trim()
    : t("Private profile");

  return (
    <>
      <Stack.Screen options={{ title: t("Social profile") }} />
      <Screen
        footer={
          <Button
            label={t("Save")}
            disabled={!ready || save.isPending}
            loading={save.isPending}
            onPress={() => {
              setSaved(false);
              save.mutate({
                status: active ? "active" : "off",
                discovery,
                handle: handle.trim() ? handle.trim() : null,
                displayName: displayName.trim(),
                bio: bio.trim(),
                educationBand,
                expectedRevision: profile.revision,
              });
            }}
          />
        }
      >
        <SocialNavigation current="sharing" />
        <PrivacyBoundaryNotice />

        <Section title={t("Profile status")}>
          <SwitchField
            label={t("Activate my social profile")}
            hint={t(
              "Off means nobody can discover or view it, including existing friends.",
            )}
            value={active}
            onValueChange={setActive}
          />
        </Section>

        <Section title={t("Identity")}>
          <TextField
            label={t("Display name")}
            value={displayName}
            onChangeText={setDisplayName}
            autoComplete="name"
          />
          <TextField
            label={t("Exact handle")}
            value={handle}
            onChangeText={(value) =>
              setHandle(value.replace(/^@/, "").toLowerCase())
            }
            autoCapitalize="none"
            placeholder="lea.dupont"
          />
          <TextField
            label={t("Bio")}
            value={bio}
            onChangeText={setBio}
            multiline
            placeholder={t(
              "A short introduction without school or contact details",
            )}
          />
          <PickerField
            label={t("Education level")}
            value={educationBand}
            onChange={(value) => setEducationBand(value as EducationBand)}
            choices={[
              "unknown",
              "middle_school",
              "high_school",
              "higher_education",
              "other",
            ].map((value) => ({ value, label: educationBandLabel(value) }))}
          />
        </Section>

        <Section title={t("Discovery")}>
          <ChoiceField<Discovery>
            value={discovery}
            onChange={setDiscovery}
            choices={[
              {
                value: "off",
                label: t("Off"),
                hint: t("Only existing accepted relationships remain"),
              },
              {
                value: "invite_only",
                label: t("Invitation links only"),
                hint: t(
                  "Useful for joining groups without appearing in search",
                ),
              },
              {
                value: "exact_handle",
                label: t("Exact handle"),
                hint: t(
                  "People must type the complete handle; there is no directory",
                ),
              },
            ]}
          />
        </Section>

        <Section title={t("What every accepted friend can see")}>
          {SOCIAL_PROFILE_FIELDS.map((field) => {
            const existing = friendGrants.get(field);
            return (
              <SwitchField
                key={field}
                label={socialProfileFieldLabel(field)}
                value={Boolean(existing)}
                disabled={!active || grant.isPending || revokeGrant.isPending}
                onValueChange={(enabled) => {
                  setProblem(null);
                  if (enabled) grant.mutate(field);
                  else if (existing) revokeGrant.mutate(existing.id);
                }}
              />
            );
          })}
          <Note>
            {t(
              "Circle- and person-specific exceptions are managed from Friends. A missing grant always hides the field.",
            )}
          </Note>
        </Section>

        <Section title={t("Exact friend preview")}>
          <Card style={{ gap: space.md }}>
            <SocialIdentity displayName={previewName} />
            {friendGrants.has("bio") && bio ? (
              <Text selectable style={[type.body, { color: palette.text }]}>
                {bio}
              </Text>
            ) : (
              <Text
                selectable
                style={[type.footnote, { color: palette.textMuted }]}
              >
                {t("Bio not shared")}
              </Text>
            )}
            <Text
              selectable
              style={[type.footnote, { color: palette.textMuted }]}
            >
              {friendGrants.has("educationBand")
                ? educationBandLabel(educationBand)
                : t("Education level not shared")}
            </Text>
          </Card>
        </Section>

        {saved ? (
          <Confirmation>{t("Social profile saved.")}</Confirmation>
        ) : null}
        {problem ? <Problem>{problem}</Problem> : null}

        {resume && peekSocialInvitation(resume) ? (
          <Section>
            <Button
              label={t("Cancel invitation setup")}
              variant="ghost"
              onPress={() => {
                discardSocialInvitation(resume);
                router.replace("/social");
              }}
            />
          </Section>
        ) : null}

        <Section title={t("Withdraw social consent")}>
          <Card padded={false}>
            <Row
              first
              destructive
              title={t("Turn off social and withdraw")}
              subtitle={t("Future profile and group access stops immediately")}
              onPress={() =>
                Alert.alert(
                  t("Withdraw social consent?"),
                  t(
                    "Your profile turns off and future social access stops. Existing moderation and consent audit records remain as required for safety.",
                  ),
                  [
                    { text: t("Cancel"), style: "cancel" },
                    {
                      text: t("Withdraw"),
                      style: "destructive",
                      onPress: () => withdraw.mutate({ channel: "mobile" }),
                    },
                  ],
                )
              }
            />
          </Card>
        </Section>

        <Section title={t("Social data controls")}>
          <Button
            label={t("Export my social data")}
            variant="secondary"
            loading={exportSocial.isPending}
            onPress={() => exportSocial.mutate(undefined)}
          />
          <Note>
            {t(
              "The export opens the system share sheet only after your explicit action. Review the destination because it contains your social history.",
            )}
          </Note>
          <Button
            label={t("Reset all social data")}
            variant="destructive"
            loading={resetSocial.isPending}
            onPress={() =>
              Alert.alert(
                t("Reset all social data?"),
                t(
                  "This permanently removes your social profile, friendships, circles, group memberships, invitations and sharing decisions. Your private grades remain.",
                ),
                [
                  { text: t("Cancel"), style: "cancel" },
                  {
                    text: t("Reset"),
                    style: "destructive",
                    onPress: () =>
                      resetSocial.mutate({ confirmation: "RESET SOCIAL" }),
                  },
                ],
              )
            }
          />
          {exportSocial.isError || resetSocial.isError ? (
            <Problem>
              {t("The social data action could not be completed.")}
            </Problem>
          ) : null}
        </Section>
      </Screen>
    </>
  );
}
