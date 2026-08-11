import type { AwardKind } from "@avermate/core";
import { t } from "@/lib/i18n";

export function awardTitle(award: AwardKind): string {
  const titles: Record<AwardKind, string> = {
    tourist: t("The Visitor"),
    tightrope: t("The Tightrope Walker"),
    comeback: t("The Comeback"),
    allin: t("All In"),
    masterclass: t("The Masterclass"),
    unpredictable: t("The Wildcard"),
    precision: t("The Metronome"),
    legend: t("The Legend"),
    avermatien: t("The Avermatian"),
  };
  return titles[award];
}

export function awardBlurb(award: AwardKind): string {
  const blurbs: Record<AwardKind, string> = {
    tourist: t("You passed through. The year barely knew you were there."),
    tightrope: t("Close to the line all year, and you never fell off it."),
    comeback: t("It started badly. That is not how it ended."),
    allin: t("Nobody recorded more than you did."),
    masterclass: t("High, and it stayed high. That is the hard part."),
    unpredictable: t("Brilliant, then baffling. Never the same twice."),
    precision: t("The same result, again and again. Uncanny."),
    legend: t("A year that will be hard to beat — including by you."),
    avermatien: t("You have used this app more than the app expected."),
  };
  return blurbs[award];
}

export function awardEmoji(award: AwardKind): string {
  const emoji: Record<AwardKind, string> = {
    tourist: "🧳",
    tightrope: "🎪",
    comeback: "🚀",
    allin: "🎯",
    masterclass: "🎓",
    unpredictable: "🎲",
    precision: "⏱️",
    legend: "🏆",
    avermatien: "✨",
  };
  return emoji[award];
}
