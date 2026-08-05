import { useMemo } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import type { Subject } from "@avermate/core";
import { Button, Card, Empty, Loading, Row } from "@/components/ui";
import { AverageValue, CoefficientTag } from "@/components/value";
import { ScopeBar } from "@/components/scope-bar";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

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
  const { isLoading, graph, yearId, refresh } = useYear();

  const rows = useMemo(() => flatten(graph.roots, graph, 0), [graph]);

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

      {rows.length === 0 ? (
        <Empty
          icon="albums-outline"
          title={t("This year has no subjects yet.")}
          body={t("Add them one by one, or start from a template on the web.")}
          action={
            <Button
              label={t("Add a subject")}
              onPress={() => router.push("/subject/new")}
              variant="secondary"
            />
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
  graph: { childrenOf: (id: string) => readonly Subject[]; allGrades: (id?: string) => unknown[] },
  depth: number,
): FlatEntry[] {
  return [...subjects]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .flatMap((subject) => [
      { subject, depth, count: graph.allGrades(subject.id).length },
      ...flatten(graph.childrenOf(subject.id), graph, depth + 1),
    ]);
}
