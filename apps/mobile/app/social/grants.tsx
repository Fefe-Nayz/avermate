import { Text } from "react-native";
import { Stack, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { SwitchField } from "@/components/field";
import {
  educationBandLabel,
  socialProfileFieldLabel,
} from "@/components/social/social-copy";
import { SocialRouteGate } from "@/components/social/social-gate";
import {
  SOCIAL_PROFILE_FIELDS,
  type SocialProfileField,
} from "@/components/social/social-model";
import {
  PrivacyBoundaryNotice,
  SocialIdentity,
} from "@/components/social/social-ui";
import {
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Screen,
  Section,
} from "@/components/ui";
import { t } from "@/lib/i18n";
import { client, orpc, queryClient } from "@/lib/orpc";
import { space, type, usePalette } from "@/lib/theme";

type Audience = "friends" | "circle" | "specific_user";

function parseAudience(value: string | undefined): Audience | null {
  return value === "friends" || value === "circle" || value === "specific_user"
    ? value
    : null;
}

export default function SocialGrants() {
  const params = useLocalSearchParams<{
    audience?: string;
    audienceId?: string;
    label?: string;
  }>();
  const palette = usePalette();
  const audience = parseAudience(params.audience);
  const audienceId =
    audience === "friends" ? null : (params.audienceId ?? null);
  const valid = Boolean(audience && (audience === "friends" || audienceId));
  const grants = useQuery({
    ...orpc.social.grants.list.queryOptions(),
    enabled: valid,
  });
  const preview = useQuery({
    ...orpc.social.profile.previewMineAs.queryOptions({
      input: {
        audience: audience ?? "friends",
        audienceId,
      },
    }),
    enabled: valid,
  });

  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: orpc.social.grants.list.queryKey(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.profile.previewMineAs.queryKey({
          input: { audience: audience ?? "friends", audienceId },
        }),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.social.profile.mine.queryKey(),
      }),
    ]);
  };
  const grant = useMutation({
    mutationFn: (fieldKey: SocialProfileField) => {
      if (!audience) throw new Error("Invalid social audience");
      return client.social.grants.upsert({ fieldKey, audience, audienceId });
    },
    onSuccess: refresh,
  });
  const revoke = useMutation({
    mutationFn: (grantId: string) => client.social.grants.revoke({ grantId }),
    onSuccess: refresh,
  });

  if (!valid) {
    return (
      <Screen>
        <Empty
          icon="lock-closed-outline"
          title={t("Invalid sharing target")}
          body={t("No permission was changed.")}
        />
      </Screen>
    );
  }

  const matching = new Map(
    (grants.data ?? [])
      .filter(
        (item) => item.audience === audience && item.audienceId === audienceId,
      )
      .map((item) => [item.fieldKey, item]),
  );

  return (
    <SocialRouteGate>
      <>
        <Stack.Screen
          options={{
            title: t("Sharing with {target}", {
              target: params.label ?? t("this audience"),
            }),
          }}
        />
        <Screen>
          <PrivacyBoundaryNotice compact />
          <Section title={t("Additional fields for this audience")}>
            {SOCIAL_PROFILE_FIELDS.map((field) => {
              const existing = matching.get(field);
              return (
                <SwitchField
                  key={field}
                  label={socialProfileFieldLabel(field)}
                  value={Boolean(existing)}
                  disabled={grant.isPending || revoke.isPending}
                  onValueChange={(enabled) => {
                    if (enabled) grant.mutate(field);
                    else if (existing) revoke.mutate(existing.id);
                  }}
                />
              );
            })}
            <Note>
              {t(
                "These permissions add to any friend-wide grant. Avermate never infers a missing field.",
              )}
            </Note>
            {grant.isError || revoke.isError ? (
              <Problem>
                {t("That sharing permission could not be changed.")}
              </Problem>
            ) : null}
          </Section>

          <Section title={t("Exact preview for this audience")}>
            {preview.isLoading ? (
              <Loading />
            ) : preview.isError || !preview.data ? (
              <Problem>{t("The exact preview could not be verified.")}</Problem>
            ) : (
              <Card style={{ gap: space.md }}>
                <SocialIdentity
                  displayName={preview.data.displayName ?? t("Private profile")}
                  avatar={preview.data.avatar}
                />
                {preview.data.bio ? (
                  <Text selectable style={[type.body, { color: palette.text }]}>
                    {preview.data.bio}
                  </Text>
                ) : null}
                {preview.data.educationBand ? (
                  <Text
                    selectable
                    style={[type.footnote, { color: palette.textMuted }]}
                  >
                    {educationBandLabel(preview.data.educationBand)}
                  </Text>
                ) : null}
              </Card>
            )}
          </Section>
        </Screen>
      </>
    </SocialRouteGate>
  );
}
