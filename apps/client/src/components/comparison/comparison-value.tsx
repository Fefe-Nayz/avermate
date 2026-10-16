"use client";

import { useFormatter, useTranslations } from "next-intl";
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
  if (!comparison.active || subjectId?.startsWith("ca")) return null;
  const reference = comparison.getReferenceAverage(subjectId);
  const scale = outOf / 2000;
  const difference = currentValue !== null && reference !== null
    ? Math.round((currentValue - reference) * scale * 100) / 100
    : null;
  const number = (value: number) => format.number(value, { maximumFractionDigits: 2 });

  return (
    <div className={cn("mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-normal", className)}>
      <span className="text-muted-foreground">
        {comparison.loading ? t("loading") : comparison.error ? t("unavailable") : reference === null
          ? t("noComparison")
          : t("referenceValue", { year: comparison.referenceYear?.name ?? "", value: number(reference * scale) })}
      </span>
      {difference !== null && (
        <span className={cn("rounded-md px-1.5 py-0.5 font-medium tabular-nums", difference > 0
          ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
          : difference < 0 ? "bg-rose-500/10 text-rose-700 dark:text-rose-400" : "bg-muted text-muted-foreground")}>
          {t("points", { value: `${difference > 0 ? "+" : ""}${number(difference)}` })}
        </span>
      )}
    </div>
  );
}
