import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icon";
import { gradeRatio, type Grade } from "@avermate/core";
import { Heading,
  Button, Card, Empty, Label, Loading, Row } from "@/components/ui";
import { PointsValue, ResultBadge } from "@/components/value";
import { ScopeBar } from "@/components/scope-bar";
import { TextField } from "@/components/field";
import { formatDay } from "@/components/date-field";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { locale, t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * Every result, newest first.
 *
 * Grouped by month rather than paginated: a school year has months, not pages,
 * and "October was rough" is a thing people actually think. Search is plain
 * substring matching over the name and the subject — enough for a list this
 * size, and it never surprises anyone.
 */
export default function Grades() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoading, graph, refresh } = useYear();
  const [query, setQuery] = useState("");

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matching = graph.allGrades().filter((grade) => {
      if (!needle) return true;
      const subject = graph.byId(grade.subjectId);
      return (
        grade.name.toLowerCase().includes(needle) ||
        (subject?.name.toLowerCase().includes(needle) ?? false)
      );
    });

    matching.sort((a, b) => b.passedAt.getTime() - a.passedAt.getTime());

    const buckets = new Map<string, { label: string; grades: Grade[] }>();
    for (const grade of matching) {
      const key = `${grade.passedAt.getFullYear()}-${grade.passedAt.getMonth()}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.grades.push(grade);
      else {
        buckets.set(key, {
          label: grade.passedAt.toLocaleDateString(
            locale() === "fr" ? "fr-FR" : "en-GB",
            { month: "long", year: "numeric" },
          ),
          grades: [grade],
        });
      }
    }
    return [...buckets.values()];
  }, [graph, query]);

  if (isLoading) return <Loading />;

  const total = graph.allGrades().length;

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
      keyboardDismissMode="on-drag"
      refreshControl={
        <RefreshControl
          refreshing={false}
          onRefresh={refresh}
          tintColor={palette.textFaint}
        />
      }
    >
      <Heading
        icon="list-checks"
        title={t("Grades")}
        action={
          <Pressable
            onPress={() => {
              haptic("light");
              router.push("/grade/new");
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
            <Icon name="add" size={18} color={palette.accentText} />
          </Pressable>
        }
      />

      <ScopeBar />

      {total > 6 ? (
        <TextField
          label={t("Search")}
          value={query}
          onChangeText={setQuery}
          placeholder={t("Name or subject")}
          autoCapitalize="none"
        />
      ) : null}

      {groups.length === 0 ? (
        <Empty
          icon="document-text-outline"
          title={
            total === 0 ? t("Nothing recorded yet.") : t("Nothing matches.")
          }
          body={
            total === 0
              ? t("Add your first grade and the year starts drawing itself.")
              : undefined
          }
          action={
            total === 0 ? (
              <Button
                label={t("Add grade")}
                onPress={() => router.push("/grade/new")}
                variant="secondary"
              />
            ) : null
          }
        />
      ) : (
        groups.map((group) => (
          <View key={group.label} style={{ gap: space.sm }}>
            <View style={{ paddingHorizontal: space.xs }}>
              <Label>{group.label}</Label>
            </View>
            <Card padded={false}>
              {group.grades.map((grade, index) => {
                const subject = graph.byId(grade.subjectId);
                return (
                  <Row
                    key={grade.id}
                    first={index === 0}
                    title={grade.name}
                    subtitle={`${subject?.name ?? ""} · ${formatDay(grade.passedAt)}`}
                    onPress={() => router.push(`/grade/${grade.id}`)}
                    trailing={
                      <View style={{ alignItems: "flex-end", gap: 2 }}>
                        <ResultBadge ratio={gradeRatio(grade)} />
                        <PointsValue value={grade.value} outOf={grade.outOf} />
                      </View>
                    }
                  />
                );
              })}
            </Card>
          </View>
        ))
      )}
    </ScrollView>
  );
}
