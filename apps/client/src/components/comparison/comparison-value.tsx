"use client";

import { useFormatter, useTranslations } from "next-intl";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { useYearComparison } from "@/hooks/use-year-comparison";
import { cn } from "@/lib/utils";

export type YearComparisonState = ReturnType<typeof useYearComparison>;

export function ComparisonValue({ comparison, currentValue, subjectId, outOf = 2000, className }: {
  comparison: YearComparisonState;
  currentValue: number | null;
  subjectId?: string;
  outOf?: number;
  className?: string;
}) {
  const t = useTranslations("YearComparison");
  const format = useFormatter();
  if (!comparison.active) return null;
  const reference = comparison.getReferenceAverage(subjectId);
  const scale = outOf / 2000;
  const roundedDifference = currentValue !== null && reference !== null
    ? Math.round((currentValue - reference) * scale * 100) / 100
    : null;
  const difference = roundedDifference === 0 ? 0 : roundedDifference;
  const number = (value: number) => format.number(value, { maximumFractionDigits: 2 });

  return (
    <div className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal", className)}>
      <span className="text-muted-foreground">
        {comparison.loading ? t("loading") : comparison.error ? t("unavailable") : reference === null
          ? t("noComparison")
          : t("referenceValue", { year: comparison.referenceYear?.name ?? "", value: number(reference * scale) })}
      </span>
      {difference !== null && (
        <Badge variant="outline">
          {difference > 0 && <TrendingUp data-icon="inline-start" aria-hidden="true" />}
          {difference < 0 && <TrendingDown data-icon="inline-start" aria-hidden="true" />}
          {t("points", { value: `${difference > 0 ? "+" : ""}${number(difference)}` })}
        </Badge>
      )}
    </div>
  );
}
