import { Pressable, RefreshControl, ScrollView, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon } from "@/components/icon";
import { Heading,
  Button, Card, Empty, Loading, ProgressBar } from "@/components/ui";
import { AverageValue } from "@/components/value";
import { StatusPill } from "@/components/goal-status";
import { ScopeBar } from "@/components/scope-bar";
import { useGoalPlans } from "@/components/use-goal-plans";
import { useYear } from "@/components/year-provider";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { radius, space, type, usePalette } from "@/lib/theme";

/**
 * Goals, each one showing the only two numbers that matter at a glance: where
 * you are and where you said you would be. The plan — what to do about the gap
 * — is one tap deeper, because advice you have already read is clutter.
 */
export default function Goals() {
  const palette = usePalette();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { isLoading, refresh } = useYear();
  const plans = useGoalPlans();

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
      <Heading
        icon="target"
        title={t("Goals")}
        action={
          <Pressable
            onPress={() => {
              haptic("light");
              router.push("/goal/new");
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

      {plans.length === 0 ? (
        <Empty
          icon="flag-outline"
          title={t("No goals yet")}
          body={t("Set a target and Avermate works out what it takes.")}
          action={
            <Button
              label={t("New goal")}
              onPress={() => router.push("/goal/new")}
              variant="secondary"
            />
          }
        />
      ) : (
        plans.map((plan) => (
          <Pressable
            key={plan.goal.id}
            onPress={() => {
              haptic("selection");
              router.push(`/goal/${plan.goal.id}`);
            }}
          >
            <Card>
              <View style={{ gap: space.md }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: space.sm,
                  }}
                >
                  <Text
                    style={[type.heading, { flex: 1, color: palette.text }]}
                  >
                    {plan.goal.name}
                  </Text>
                  <StatusPill status={plan.status} />
                </View>

                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-end",
                    gap: space.sm,
                  }}
                >
                  <AverageValue ratio={plan.current} size="display" colored />
                  <Text
                    style={[
                      type.footnote,
                      { color: palette.textFaint, paddingBottom: 6 },
                    ]}
                  >
                    {t("of")}
                  </Text>
                  <View style={{ paddingBottom: 4 }}>
                    <AverageValue ratio={plan.target} size="heading" />
                  </View>
                </View>

                <ProgressBar
                  value={
                    plan.current === null || plan.target === 0
                      ? 0
                      : plan.current / plan.target
                  }
                  done={plan.status === "achieved" || plan.status === "secured"}
                />
              </View>
            </Card>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}
