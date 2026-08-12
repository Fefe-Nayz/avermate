import { useMemo } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { resolveCustomAverage, type Subject } from "@avermate/core";
import { Button, Card, Empty, Loading, Row, Section } from "@/components/ui";
import { AverageValue, CoefficientTag } from "@/components/value";
import { ScopeBar } from "@/components/scope-bar";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";
import { yearSetupHref } from "@/lib/year-setup";

/**
 * The subject tree, flattened for a phone.
 *
 * Indentation carries the hierarchy rather than nested cards: a card inside a
 * card inside a card is unreadable at 375pt, and the useful information — the
 * average and the weight — has to stay on one line to be comparable down the
 * column.
 */
export default function Subjects() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { customAverages, isLoading, graph, yearId, refresh } = useYear();

  const rows = useMemo(() => flatten(graph.roots, graph, 0), [graph]);
  const averageRows = useMemo(
    () =>
      [...customAverages]
        .sort(
          (left, right) =>
            left.sortOrder - right.sortOrder ||
            left.name.localeCompare(right.name),
        )
        .map((average) => {
          const resolved = resolveCustomAverage(graph, average);
          return {
            ...average,
            ratio: resolved.graph.ratio(null, resolved.scope),
          };
        }),
    [customAverages, graph],
  );

  if (isLoading) return <Loading />;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.background }}
      contentContainerStyle={{
        paddingTop: insets.top + space.md,
        paddingHorizontal: space.lg,
        paddingBottom: space.xxxl,
        gap: space.lg,
      }}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={refresh}
          tintColor={palette.textFaint}
        />
      }
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <Text style={[type.display, { color: palette.text }]}>
          {t("Subjects")}
        </Text>
        {yearId ? (
          <Pressable
            onPress={() => {
              haptic("light");
              router.push("/subject/new");
            }}
            hitSlop={10}
            style={{
              width: 34,
              height: 34,
              borderRadius: radius.pill,
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: palette.accent,
            }}
          >
            <Ionicons name="add" size={18} color={palette.accentText} />
          </Pressable>
        ) : null}
      </View>

      <ScopeBar />

      <Section
        title={t("Averages")}
        action={
          <Pressable
            accessibilityLabel={t("Edit custom averages")}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => {
              haptic("light");
              router.push("/settings/averages");
            }}
          >
            <Ionicons
              name="options-outline"
              size={18}
              color={palette.textMuted}
            />
          </Pressable>
        }
      >
        <Card padded={false}>
          <Row
            first
            title={t("General average")}
            subtitle={t("{count} subjects", { count: graph.subjects.length })}
            leading={
              <Ionicons
                name="analytics-outline"
                size={19}
                color={palette.textMuted}
              />
            }
            onPress={() => router.push("/average/general")}
            trailing={
              <AverageValue
                ratio={graph.ratio(null)}
                size="heading"
                showScale
                colored
              />
            }
          />
          {averageRows.map((average) => (
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
              leading={
                average.isMain ? (
                  <Ionicons name="star" size={18} color={palette.accent} />
                ) : (
                  <Ionicons
                    name="calculator-outline"
                    size={18}
                    color={palette.textFaint}
                  />
                )
              }
              onPress={() => router.push(`/average/${average.id}`)}
              trailing={
                <AverageValue ratio={average.ratio} size="callout" colored />
              }
            />
          ))}
        </Card>
      </Section>

      {rows.length === 0 ? (
        <Empty
          icon="albums-outline"
          title={t("This year has no subjects yet.")}
          body={t(
            "Continue the year setup to use a preset or add subjects yourself.",
          )}
          action={
            <View style={{ width: "100%", gap: space.sm }}>
              {yearId ? (
                <Button
                  label={t("Continue setup")}
                  onPress={() => router.push(yearSetupHref(yearId))}
                />
              ) : null}
              <Button
                label={t("Add a subject")}
                onPress={() => router.push("/subject/new")}
                variant="secondary"
              />
            </View>
          }
        />
      ) : (
        <Card padded={false}>
          {rows.map((entry, index) => (
            <Row
              key={entry.subject.id}
              first={index === 0}
              indent={entry.depth}
              title={entry.subject.name}
              muted={entry.subject.kind === "category"}
              subtitle={
                entry.count > 0
                  ? entry.count === 1
                    ? t("1 grade")
                    : t("{count} grades", { count: entry.count })
                  : undefined
              }
              onPress={() => router.push(`/subject/${entry.subject.id}`)}
              trailing={
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  {entry.subject.kind === "subject" ? (
                    <CoefficientTag coefficient={entry.subject.coefficient} />
                  ) : null}
                  <AverageValue
                    ratio={graph.ratio(entry.subject.id)}
                    size="callout"
                    colored
                  />
                </View>
              }
            />
          ))}
        </Card>
      )}
    </ScrollView>
  );
}

interface FlatEntry {
  subject: Subject;
  depth: number;
  count: number;
}

function flatten(
  subjects: readonly Subject[],
  graph: {
    childrenOf: (id: string) => readonly Subject[];
    allGrades: (id?: string) => unknown[];
  },
  depth: number,
): FlatEntry[] {
  return [...subjects]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .flatMap((subject) => [
      { subject, depth, count: graph.allGrades(subject.id).length },
      ...flatten(graph.childrenOf(subject.id), graph, depth + 1),
    ]);
}
