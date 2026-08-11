import { Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { socialExposureLabel, socialMetricLabel } from "./social-copy";
import { isSocialMetric, type SocialExposure } from "./social-model";
import { Card, Note, Row, Section } from "@/components/ui";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

export interface GroupPolicyView {
  version: number;
  purpose: string;
  audienceDescription: string;
  window: "current_academic_year" | "last_90_days" | "last_30_days";
  digest: string;
  rankingsEnabled: boolean;
  fields: Array<{
    fieldKey: string;
    required: boolean;
    exposure: SocialExposure;
  }>;
}

export function groupWindowLabel(window: GroupPolicyView["window"]): string {
  if (window === "last_30_days") return t("Last 30 days");
  if (window === "last_90_days") return t("Last 90 days");
  return t("Current academic year");
}

export function GroupPolicySummary({ policy }: { policy: GroupPolicyView }) {
  const palette = usePalette();
  return (
    <Section title={t("Sharing policy · version {version}", { version: policy.version })}>
      <Card style={{ gap: space.md }}>
        <View style={{ flexDirection: "row", gap: space.sm, alignItems: "center" }}>
          <Ionicons name="shield-checkmark-outline" size={20} color={palette.accent} />
          <Text selectable style={[type.heading, { color: palette.text, flex: 1 }]}>
            {policy.purpose}
          </Text>
        </View>
        <Text selectable style={[type.body, { color: palette.textMuted }]}>
          {policy.audienceDescription}
        </Text>
        <View
          style={{
            backgroundColor: palette.accentSoft,
            padding: space.md,
            borderRadius: radius.md,
            gap: space.xs,
          }}
        >
          <Text style={[type.label, { color: palette.textFaint }]}>{t("Time window")}</Text>
          <Text style={[type.body, { color: palette.text }]}>
            {groupWindowLabel(policy.window)}
          </Text>
        </View>
      </Card>
      <Card padded={false}>
        {policy.fields.map((field, index) => (
          <Row
            key={field.fieldKey}
            first={index === 0}
            title={
              isSocialMetric(field.fieldKey)
                ? socialMetricLabel(field.fieldKey)
                : t("Unavailable metric")
            }
            subtitle={`${socialExposureLabel(field.exposure)} · ${
              field.required ? t("Required") : t("Optional")
            }`}
          />
        ))}
      </Card>
      {policy.rankingsEnabled ? (
        <Note>
          {t("Named rankings still require a separate personal opt-in and the minimum privacy threshold.")}
        </Note>
      ) : null}
    </Section>
  );
}

export function socialMetricValue(value: {
  numeric?: number | null;
  band?: string | null;
}): string {
  if (typeof value.numeric === "number") {
    return `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value.numeric)} %`;
  }
  if (!value.band || value.band === "insufficient_data") return t("Insufficient data");
  const labels: Record<string, string> = {
    improving: t("Improving"),
    stable: t("Stable"),
    declining: t("Declining"),
    high: t("High"),
    medium: t("Medium"),
    low: t("Low"),
  };
  return labels[value.band] ?? t("Protected range");
}
