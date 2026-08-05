import type { GoalAdvice, SubjectGraph } from "@avermate/core";
import type { Glyph } from "@/components/icon";
import { formatNumber } from "@/components/format";
import { t } from "@/lib/i18n";

/**
 * Advice, in sentences.
 *
 * The engine returns plain data — `{ kind: "focus", subjectId, leverage }` —
 * and every word a student reads is written here. That split is what lets the
 * arithmetic be tested and the wording be translated without either one
 * touching the other.
 */
export function adviceText(
  advice: GoalAdvice,
  context: { graph: SubjectGraph; scale: number; decimals: number },
): { glyph: Glyph; text: string } | null {
  const { graph, scale, decimals } = context;

  const show = (ratio: number) => formatNumber(ratio * scale, decimals);
  const nameOf = (id: string) => graph.byId(id)?.name ?? "";

  switch (advice.kind) {
    case "achieved":
      return {
        glyph: "achieved",
        text: t("You are there. From here it is about holding it."),
      };
    case "secured":
      return {
        glyph: "locked",
        text: t("Locked in — nothing left this period can take it away."),
      };
    case "unreachable":
      return {
        glyph: "unreachable",
        text: t(
          "Even with perfect results from here you would land at {ceiling}. Worth adjusting the target.",
          { ceiling: show(advice.ceiling) },
        ),
      };
    case "no-data":
      return {
        glyph: "waiting",
        text: t("Record a few grades and this will fill in."),
      };
    case "close":
      return {
        glyph: "close_call",
        text: t("You are within a rounding error. One decent result does it."),
      };
    case "focus":
      return {
        glyph: "rising",
        text: t(
          "{subject} is where a point moves the most. Getting it to {target} would do it on its own.",
          {
            subject: nameOf(advice.subjectId),
            target: show(advice.requiredRatio),
          },
        ),
      };
    case "steady":
      return {
        glyph: "steady",
        text:
          advice.count === 1
            ? t("One more result at {target} gets you there.", {
                target: show(advice.requiredRatio),
              })
            : t("{count} more results at {target} get you there.", {
                count: advice.count,
                target: show(advice.requiredRatio),
              }),
      };
    case "protect":
      return {
        glyph: "protect",
        text: t(
          "{subject} carries the most weight — a slip there costs you the most.",
          { subject: nameOf(advice.subjectId) },
        ),
      };
    case "declining":
      return {
        glyph: "falling",
        text: t("{subject} has been slipping. Worth a look.", {
          subject: nameOf(advice.subjectId),
        }),
      };
    default:
      return null;
  }
}
