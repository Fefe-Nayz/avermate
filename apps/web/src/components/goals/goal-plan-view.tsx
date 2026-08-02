"use client";

import Link from "next/link";
import { useExtracted } from "next-intl";
import {
  ArrowUpRightIcon,
  CheckCircle2Icon,
  LockIcon,
  ShieldAlertIcon,
  TrendingUpIcon,
  XCircleIcon,
} from "lucide-react";
import type { GoalAdvice, GoalPlan } from "@avermate/core";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AverageValue, DeltaValue } from "@/components/data/value";
import { useYear } from "@/components/year/year-provider";
import { cn } from "@/lib/utils";
import { useStatusLabel } from "./goal-strip";

/**
 * The plan for a goal.
 *
 * The whole point of the feature is that "aim higher" is not advice. Every
 * number on this screen is an instruction: the mark the next assessment has
 * to be, the subject where a point is worth the most, and whether the target
 * is still arithmetically reachable at all.
 */

const STATUS_ICON = {
  achieved: CheckCircle2Icon,
  secured: LockIcon,
  "on-track": TrendingUpIcon,
  "at-risk": ShieldAlertIcon,
  unreachable: XCircleIcon,
  "no-data": ShieldAlertIcon,
} as const;

const STATUS_TONE: Record<GoalPlan["status"], string> = {
  achieved: "text-band-good",
  secured: "text-band-excellent",
  "on-track": "text-primary",
  "at-risk": "text-band-fair",
  unreachable: "text-band-poor",
  "no-data": "text-muted-foreground",
};

function useAdviceText() {
  const t = useExtracted();
  const { graph, scale } = useYear();

  return (advice: GoalAdvice): string => {
    const mark = (ratio: number) =>
      (ratio * scale).toLocaleString(undefined, {
        maximumFractionDigits: 1,
      });

    switch (advice.kind) {
      case "achieved":
        return t("You are there. From here it is about holding it.");
      case "secured":
        return t("Locked in — nothing left this period can take it away.");
      case "unreachable":
        return t(
          "Even perfect results from here top out at {ceiling}. Worth lowering the target rather than chasing it.",
          { ceiling: mark(advice.ceiling) },
        );
      case "no-data":
        return t("Record a few grades and this will fill in.");
      case "close":
        return t("You are within a rounding error. One decent result does it.");
      case "focus": {
        const subject = graph.byId(advice.subjectId);
        // Leverage is the share of the average a subject controls, so it reads
        // as a percentage — "a third of your average" is actionable in a way
        // that a multiplier against an unnamed baseline is not.
        return t(
          "{subject} controls {share}% of this average. Getting it to {target} would close the gap on its own.",
          {
            subject: subject?.name ?? "",
            share: Math.round(advice.leverage * 100).toString(),
            target: mark(advice.requiredRatio),
          },
        );
      }
      case "protect": {
        const subject = graph.byId(advice.subjectId);
        return t(
          "{subject} carries the most weight — a bad result there is what would cost you this.",
          { subject: subject?.name ?? "" },
        );
      }
      case "steady":
        return advice.count === 1
          ? t("One more result at {mark} gets you there.", {
              mark: mark(advice.requiredRatio),
            })
          : t("Averaging {mark} over your next {count} results gets you there.", {
              mark: mark(advice.requiredRatio),
              count: String(advice.count),
            });
      case "declining": {
        const subject = graph.byId(advice.subjectId);
        return t("{subject} has been sliding. Worth a look.", {
          subject: subject?.name ?? "",
        });
      }
      default:
        return "";
    }
  };
}

export function GoalPlanView({ plan }: { plan: GoalPlan }) {
  const t = useExtracted();
  const { graph, scale } = useYear();
  const statusLabel = useStatusLabel();
  const adviceText = useAdviceText();
  const Icon = STATUS_ICON[plan.status];

  const progress =
    plan.current === null || plan.target === 0
      ? 0
      : Math.min(1, Math.max(0, plan.current / plan.target));

  const reachable = plan.levers.filter(
    (lever) => lever.achievable && lever.realisticGain > 0,
  );

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-3 py-5">
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Icon className={cn("size-5", STATUS_TONE[plan.status])} />
            <span className={cn("text-sm font-medium", STATUS_TONE[plan.status])}>
              {statusLabel(plan.status)}
            </span>
          </div>

          <div className="flex items-end justify-between gap-4">
            <div>
              <AverageValue
                ratio={plan.current}
                className="text-4xl font-semibold"
              />
              <p className="mt-1 text-sm text-muted-foreground">
                {t("target")}{" "}
                <AverageValue
                  ratio={plan.target}
                  animate={false}
                  showScale
                  className="font-medium text-foreground"
                />
              </p>
            </div>
            {plan.gap !== null && plan.gap > 0 ? (
              <div className="text-right">
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t("Still to go")}
                </p>
                <DeltaValue delta={plan.gap} className="text-xl font-semibold" />
              </div>
            ) : null}
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className={cn(
                "h-full rounded-full transition-[width] duration-700",
                plan.status === "unreachable"
                  ? "bg-negative"
                  : plan.status === "achieved" || plan.status === "secured"
                    ? "bg-positive"
                    : "bg-primary",
              )}
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>

          {plan.ceiling !== null && plan.floor !== null ? (
            <p className="text-xs text-muted-foreground">
              {t(
                "Everything still to come could take you as high as {ceiling} or as low as {floor}.",
                {
                  ceiling: (plan.ceiling * scale).toFixed(1),
                  floor: (plan.floor * scale).toFixed(1),
                },
              )}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {plan.advice.length > 0 ? (
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-medium">
              {t("How to get there")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 px-4">
            {plan.advice.map((advice, index) => (
              <p
                key={`${advice.kind}-${index}`}
                className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
              >
                <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                <span>{adviceText(advice)}</span>
              </p>
            ))}
          </CardContent>
        </Card>
      ) : null}

      {plan.nextResults.length > 0 ? (
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-medium">
              {t("What your next result has to be")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-2">
            <ul>
              {plan.nextResults.slice(0, 8).map((entry) => (
                <li
                  key={entry.subject.id}
                  className="flex min-h-11 items-center gap-3 rounded-lg px-2 py-1.5"
                >
                  <Link
                    href={`/subjects/${entry.subject.id}`}
                    className="flex min-h-11 min-w-0 flex-1 items-center truncate text-sm hover:underline"
                  >
                    {entry.subject.name}
                  </Link>
                  {entry.alreadySecured ? (
                    <span className="text-xs text-positive">
                      {t("anything")}
                    </span>
                  ) : entry.achievable ? (
                    <AverageValue
                      ratio={entry.requiredRatio}
                      animate={false}
                      showScale
                      colored
                      className="text-sm font-medium"
                    />
                  ) : (
                    <span className="text-xs text-negative">
                      {t("not on its own")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {reachable.length > 0 ? (
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-medium">
              {t("Where effort pays off most")}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2 px-4">
            {reachable.slice(0, 5).map((lever) => {
              const share = lever.leverage;
              return (
                <div key={lever.subject.id} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 text-sm">
                    <Link
                      href={`/subjects/${lever.subject.id}`}
                      className="flex min-h-9 min-w-0 flex-1 items-center truncate hover:underline"
                    >
                      {lever.subject.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      {t("now")}
                    </span>
                    <AverageValue
                      ratio={lever.currentRatio}
                      animate={false}
                      decimals={1}
                      className="text-xs"
                    />
                    <ArrowUpRightIcon className="size-3.5 text-muted-foreground" />
                    <AverageValue
                      ratio={lever.requiredRatio}
                      animate={false}
                      decimals={1}
                      colored
                      className="text-xs font-medium"
                    />
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary/70"
                      style={{ width: `${Math.round(share * 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
            <p className="pt-1 text-xs text-muted-foreground">
              {t("The bar is how much of the average each subject controls.")}
            </p>
          </CardContent>
        </Card>
      ) : null}

      {plan.horizons.length > 0 ? (
        <Card className="gap-2 py-4">
          <CardHeader className="px-4">
            <CardTitle className="text-sm font-medium">
              {t("Or, spread over several results")}
            </CardTitle>
          </CardHeader>
          <CardContent className="px-4">
            <ul className="flex flex-col gap-1.5">
              {plan.horizons.map((horizon) => (
                <li
                  key={horizon.count}
                  className="flex items-center justify-between text-sm"
                >
                  <span className="text-muted-foreground">
                    {horizon.count === 1
                      ? t("The next result")
                      : t("Over {count} results", {
                          count: String(horizon.count),
                        })}
                  </span>
                  {horizon.alreadySecured ? (
                    <span className="text-xs text-positive">{t("done")}</span>
                  ) : horizon.achievable ? (
                    <AverageValue
                      ratio={horizon.requiredRatio}
                      animate={false}
                      showScale
                      colored
                      className="font-medium"
                    />
                  ) : (
                    <span className="text-xs text-negative">
                      {t("out of reach")}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {graph.subjects.length === 0 ? null : null}
    </div>
  );
}
