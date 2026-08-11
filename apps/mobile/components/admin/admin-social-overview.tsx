import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminGate } from "@/components/admin/admin-gate";
import { TextField } from "@/components/field";
import {
  Button,
  Card,
  Confirmation,
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
import { numeric, space, type, usePalette } from "@/lib/theme";

function total(values: Record<string, number>): number {
  return Object.values(values).reduce((sum, value) => sum + Number(value), 0);
}

export function AdminSocialOverviewScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [saved, setSaved] = useState(false);
  const flag = useQuery(orpc.admin.socialFeatureStatus.queryOptions());
  const overview = useQuery(orpc.admin.socialOverview.queryOptions());
  const updateFlag = useMutation({
    ...orpc.admin.setSocialFeatureEnabled.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      setReason("");
      setSaved(true);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.admin.socialFeatureStatus.key(),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.social.eligibility.get.key(),
        }),
      ]);
    },
  });

  const changeFeature = (enabled: boolean) => {
    if (!flag.data || reason.trim().length < 10) return;
    Alert.alert(
      enabled ? t("Enable social features?") : t("Disable social features?"),
      enabled
        ? t(
            "This opens eligibility setup. Profiles and sharing still require explicit consent.",
          )
        : t(
            "Social access stops immediately and aggregate caches are cleared. Moderation and audit records remain.",
          ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: enabled ? t("Enable") : t("Disable"),
          style: enabled ? "default" : "destructive",
          onPress: () =>
            updateFlag.mutate({
              enabled,
              expectedRevision: flag.data.revision,
              reason: reason.trim(),
            }),
        },
      ],
    );
  };

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Social moderation") }} />
      <Screen>
        <Section title={t("Global social feature flag")}>
          {flag.isLoading ? <Loading /> : null}
          {flag.data ? (
            <Card style={{ gap: space.md }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: space.md,
                }}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={[type.heading, { color: palette.text }]}>
                    {flag.data.enabled ? t("Enabled") : t("Disabled")}
                  </Text>
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {t("Revision {revision}", {
                      revision: flag.data.revision,
                    })}
                  </Text>
                </View>
                <Text
                  style={[
                    type.heading,
                    {
                      color: flag.data.enabled
                        ? palette.positive
                        : palette.negative,
                    },
                  ]}
                >
                  {flag.data.enabled ? t("ON") : t("OFF")}
                </Text>
              </View>
              <Note>
                {t(
                  "The safe default is off. Changing this flag never bypasses age, guardian, profile or group consent checks.",
                )}
              </Note>
              <TextField
                label={t("Required audit reason")}
                value={reason}
                onChangeText={(value) => {
                  setReason(value);
                  setSaved(false);
                }}
                multiline
                placeholder={t("At least 10 characters")}
              />
              <Button
                label={
                  flag.data.enabled ? t("Disable social") : t("Enable social")
                }
                variant={flag.data.enabled ? "destructive" : "secondary"}
                disabled={reason.trim().length < 10 || updateFlag.isPending}
                loading={updateFlag.isPending}
                onPress={() => changeFeature(!flag.data.enabled)}
              />
            </Card>
          ) : null}
          {saved ? (
            <Confirmation>
              {t("The social feature flag was updated.")}
            </Confirmation>
          ) : null}
          {flag.isError || updateFlag.isError ? (
            <Problem>
              {t("The feature flag changed elsewhere or could not be saved.")}
            </Problem>
          ) : null}
        </Section>

        {overview.data ? (
          <Section title={t("Privacy-safe overview")}>
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
            >
              {[
                [t("Profiles"), total(overview.data.profiles)],
                [t("Groups"), total(overview.data.groups)],
                [t("Memberships"), total(overview.data.memberships)],
                [t("Reports"), total(overview.data.reports)],
              ].map(([label, value]) => (
                <Card
                  key={String(label)}
                  style={{ flexBasis: "47%", flexGrow: 1 }}
                >
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {label}
                  </Text>
                  <Text style={[type.title, numeric, { color: palette.text }]}>
                    {String(value)}
                  </Text>
                </Card>
              ))}
            </View>
            <Note>
              {t(
                "These are aggregate moderation counts only. No grade, subject or raw school record is exposed.",
              )}
            </Note>
          </Section>
        ) : null}

        <Section title={t("Moderate")}>
          <Card padded={false}>
            <Row
              first
              title={t("Safety reports")}
              subtitle={t("Resolve, dismiss, assign or freeze safely")}
              onPress={() => router.push("/admin/social/reports")}
            />
            <Row
              title={t("Social groups")}
              subtitle={t("Inspect state and freeze sharing")}
              onPress={() => router.push("/admin/social/groups")}
            />
            <Row
              title={t("Social audit")}
              subtitle={t("Read-only privacy and moderation events")}
              onPress={() => router.push("/admin/social/audit")}
            />
          </Card>
        </Section>
      </Screen>
    </AdminGate>
  );
}
