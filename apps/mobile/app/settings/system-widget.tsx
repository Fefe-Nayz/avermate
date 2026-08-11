import { useEffect, useState, useSyncExternalStore } from "react";
import { Alert } from "react-native";
import Constants from "expo-constants";
import { Stack } from "expo-router";
import { ChoiceField, SwitchField } from "@/components/field";
import {
  Card,
  Confirmation,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { useSession } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import {
  DEFAULT_SYSTEM_WIDGET_PREFERENCE,
  type SystemWidgetMode,
  type SystemWidgetPreference,
} from "@/lib/system-widget-model";
import {
  loadSystemWidgetPreference,
  saveSystemWidgetPreference,
  subscribeSystemWidgetSettings,
  systemWidgetSettingsRevision,
} from "@/lib/system-widget-settings";

type Availability = "available" | "development-build-required" | "unsupported";

function availability(): Availability {
  if (process.env.EXPO_OS !== "ios") return "unsupported";
  return Constants.expoGoConfig ? "development-build-required" : "available";
}

export default function SystemWidgetSettings() {
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const revision = useSyncExternalStore(
    subscribeSystemWidgetSettings,
    systemWidgetSettingsRevision,
    () => 0,
  );
  const [preference, setPreference] = useState<SystemWidgetPreference | null>(
    null,
  );
  const [problem, setProblem] = useState<string | null>(null);
  const support = availability();

  useEffect(() => {
    let alive = true;
    if (!userId) {
      setPreference(DEFAULT_SYSTEM_WIDGET_PREFERENCE);
      return;
    }
    void loadSystemWidgetPreference(userId).then((value) => {
      if (alive) setPreference(value);
    });
    return () => {
      alive = false;
    };
  }, [revision, userId]);

  if (!preference || session.isPending) return <Loading />;

  const persist = async (next: SystemWidgetPreference) => {
    if (!userId) return;
    setProblem(null);
    setPreference(next);
    try {
      await saveSystemWidgetPreference(userId, next);
      haptic("success");
    } catch {
      setPreference(preference);
      haptic("error");
      setProblem(t("The widget preference could not be saved."));
    }
  };

  const requestEnable = () => {
    Alert.alert(
      t("Show academic aggregates on this device?"),
      t(
        "The widget can show your general average, grade count and activity streak. It never includes friends, groups, class names or individual grades, and iOS marks values as private when the device is locked.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Enable widget"),
          onPress: () => void persist({ ...preference, enabled: true }),
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Home screen widget") }} />
      <Screen>
        <Section title={t("On this device") }>
          <SwitchField
            label={t("Allow the Avermate widget")}
            hint={t("This choice is stored only for this account on this device.")}
            value={preference.enabled}
            disabled={support !== "available"}
            onValueChange={(enabled) => {
              if (enabled) requestEnable();
              else void persist({ ...preference, enabled: false });
            }}
          />
          {support === "development-build-required" ? (
            <Problem>
              {t("System widgets require an Avermate development or EAS build; they are not available in Expo Go.")}
            </Problem>
          ) : support === "unsupported" ? (
            <Note>
              {t("System widgets are currently supported on iOS. The same configurable cards remain available inside Avermate on this device.")}
            </Note>
          ) : preference.enabled ? (
            <Confirmation>{t("The widget is enabled for this device.")}</Confirmation>
          ) : (
            <Note>{t("Nothing is shared with the operating-system widget until you enable it.")}</Note>
          )}
        </Section>

        <Section title={t("Widget focus") }>
          <ChoiceField<SystemWidgetMode>
            value={preference.mode}
            onChange={(mode) => void persist({ ...preference, mode })}
            choices={[
              {
                value: "balanced",
                label: t("Balanced summary"),
                hint: t("Average and current activity streak"),
              },
              {
                value: "average",
                label: t("Average first"),
                hint: t("General average and grade count"),
              },
              {
                value: "activity",
                label: t("Activity first"),
                hint: t("Grade count without subject or grade names"),
              },
            ]}
          />
        </Section>

        <Section title={t("Privacy by design") }>
          <Card padded={false}>
            <Row
              first
              title={t("Aggregate-only payload")}
              subtitle={t("No account, friend, group, class or subject names")}
            />
            <Row
              title={t("Lock-screen redaction")}
              subtitle={t("Academic values are always marked privacy-sensitive")}
            />
            <Row
              title={t("No background sign-in")}
              subtitle={t("The app writes a local snapshot after you open it")}
            />
          </Card>
          <Note>
            {t("Removing the widget preference or signing out replaces its snapshot with a neutral Avermate message.")}
          </Note>
        </Section>

        {problem ? (
          <Section>
            <Problem>{problem}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
