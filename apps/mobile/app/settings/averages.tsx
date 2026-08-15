import { Stack, useRouter } from "expo-router";
import { resolveCustomAverage } from "@avermate/core";
import {
  Button,
  Card,
  Empty,
  Note,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { AverageValue } from "@/components/value";
import { useYear } from "@/components/year-provider";
import { t } from "@/lib/i18n";

/**
 * Custom averages.
 *
 * The escape hatch for every school that does not fit the tree: a "scientific
 * average" that pulls maths, physics and biology out of wherever they sit, or
 * a mock-exam average that weights three subjects the way the real exam does.
 * They are computed from the same graph as everything else, so they inherit
 * period filtering and goal planning for free.
 */
export default function Averages() {
  const router = useRouter();
  const { customAverages, graph } = useYear();

  return (
    <>
      <Stack.Screen options={{ title: t("Custom averages") }} />
      <Screen
        footer={
          <Button
            label={t("New custom average")}
            onPress={() => router.push("/settings/average-edit")}
          />
        }
      >
        {customAverages.length === 0 ? (
          <Section>
            <Empty
              icon="cube-outline"
              title={t("No custom averages yet")}
              body={t(
                "Pick a handful of subjects and weigh them your own way — useful when the official average is not the one you care about.",
              )}
            />
          </Section>
        ) : (
          <Section title={t("Yours")}>
            <Card padded={false}>
              {customAverages.map((average) => {
                const resolved = resolveCustomAverage(graph, average);
                return (
                  <Row
                    key={average.id}
                    title={average.name}
                    subtitle={
                      average.entries.length === 1
                        ? t("1 subject")
                        : t("{count} subjects", {
                            count: average.entries.length,
                          })
                    }
                    onPress={() =>
                      router.push(`/settings/average-edit?id=${average.id}`)
                    }
                    trailing={
                      <AverageValue
                        ratio={resolved.graph.ratio(null, resolved.scope)}
                        size="callout"
                        colored
                      />
                    }
                  />
                );
              })}
            </Card>
          </Section>
        )}

        <Section>
          <Note>
            {t(
              "A custom average can be the target of a goal, so this is also how you track something the school does not compute.",
            )}
          </Note>
        </Section>
      </Screen>
    </>
  );
}
