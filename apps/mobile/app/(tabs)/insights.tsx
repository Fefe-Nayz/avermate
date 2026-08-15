import { useRouter } from "expo-router";
import { ScopeBar } from "@/components/scope-bar";
import { Button, Heading, Screen, Section } from "@/components/ui";
import { WidgetSurfaceContent } from "@/components/widgets/widget-surface";
import { t } from "@/lib/i18n";

/** A user-owned analytics surface backed entirely by Widget V1 definitions. */
export default function Insights() {
  const router = useRouter();
  return (
    <>
      <Screen>
        <Heading
          icon="analytics-outline"
          title={t("Insights")}
          description={t(
            "Build the analysis view that answers your questions.",
          )}
          action={
            <Button
              label={t("Customize")}
              icon="options-outline"
              size="sm"
              variant="ghost"
              onPress={() => router.push("/settings/cards?surface=insights")}
            />
          }
        />
        <Section>
          <ScopeBar />
        </Section>
        <WidgetSurfaceContent surface="insights" />
      </Screen>
    </>
  );
}
