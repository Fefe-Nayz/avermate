import { useRouter } from "expo-router";
import { Column } from "@expo/ui";
import {
  Button,
  Empty,
  Grouped,
  Label,
  Line,
  Loading,
  Row,
  Section,
  Text,
} from "@/components/native";
import { AverageValue } from "@/components/value";
import { ProgressBar } from "@/components/chart";
import { StatusPill } from "@/components/goal-status";
import { ScopeBar } from "@/components/scope-bar";
import { useGoalPlans } from "@/components/use-goal-plans";
import { useYear } from "@/components/year-provider";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * Goals, each one showing the only two numbers that matter at a glance: where
 * you are and where you said you would be. The plan — what to do about the gap
 * — is one tap deeper, because advice you have already read is clutter.
 */
export default function Goals() {
  const router = useRouter();
  const { isLoading } = useYear();
  const plans = useGoalPlans();

  if (isLoading) return <Loading />;

  return (
    <Grouped
      footer={
        <Button label={t("New goal")} onPress={() => router.push("/goal/new")} />
      }
    >
      <ScopeBar />

      {plans.length === 0 ? (
        <Section>
          <Empty
            glyph="goals"
            title={t("No goals yet")}
            body={t("Set a target and Avermate works out what it takes.")}
          />
        </Section>
      ) : (
        plans.map((plan) => {
          const done =
            plan.status === "achieved" || plan.status === "secured";

          return (
            <Section key={plan.goal.id}>
              <Line
                title={plan.goal.name}
                onPress={() => router.push(`/goal/${plan.goal.id}`)}
                trailing={<StatusPill status={plan.status} />}
              />
              <Column spacing={space.sm}>
                <Row spacing={space.sm} alignment="end">
                  <AverageValue ratio={plan.current} size="title" colored />
                  <Text size="footnote" tone="faint">
                    {t("of")}
                  </Text>
                  <AverageValue ratio={plan.target} size="callout" />
                </Row>
                <ProgressBar
                  value={
                    plan.current === null || plan.target === 0
                      ? 0
                      : plan.current / plan.target
                  }
                  done={done}
                />
                {plan.gap !== null && plan.gap > 0 ? (
                  <Row spacing={space.xs}>
                    <Label>{t("Still to go")}</Label>
                    <AverageValue ratio={plan.gap} size="footnote" />
                  </Row>
                ) : null}
              </Column>
            </Section>
          );
        })
      )}
    </Grouped>
  );
}
