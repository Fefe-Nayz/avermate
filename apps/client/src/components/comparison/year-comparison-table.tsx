"use client";

import { useFormatter, useTranslations } from "next-intl";
import { TableCell, TableHead } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { YearComparisonState } from "./comparison-value";

function YearHeading({ name, label }: { name: string; label: string }) {
  return (
    <TableHead className="hidden w-32 text-right md:table-cell">
      <Tooltip>
        <TooltipTrigger asChild>
          <span tabIndex={0} className="ml-auto block max-w-36 truncate">
            <span className="sr-only">{label} : </span>{name}
          </span>
        </TooltipTrigger>
        <TooltipContent>{label} · {name}</TooltipContent>
      </Tooltip>
    </TableHead>
  );
}

export function YearComparisonTableHeaders({ comparison }: { comparison: YearComparisonState }) {
  const t = useTranslations("YearComparison");
  return <>
    <YearHeading name={comparison.currentYear?.name ?? ""} label={t("currentAverage")} />
    <YearHeading name={comparison.referenceYear?.name ?? ""} label={t("referenceYear")} />
    <TableHead className="hidden w-24 text-right md:table-cell">{t("differencePoints")}</TableHead>
  </>;
}

/** Separate desktop columns keep all averages and totals on a single aligned row. */
export function YearComparisonTableCells({ comparison, currentValue, subjectId, outOf }: {
  comparison: YearComparisonState;
  currentValue: number | null;
  subjectId?: string;
  outOf: number;
}) {
  const t = useTranslations("YearComparison");
  const format = useFormatter();
  const reference = comparison.getReferenceAverage(subjectId);
  const scale = outOf / 2000;
  const roundedDifference = currentValue !== null && reference !== null
    ? Math.round((currentValue - reference) * scale * 100) / 100 : null;
  const difference = roundedDifference === 0 ? 0 : roundedDifference;
  const number = (value: number) => format.number(value, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const missingLabel = comparison.loading ? t("loading") : comparison.error ? t("unavailable") : t("noComparison");

  return <>
    <TableCell className="hidden text-right font-semibold tabular-nums md:table-cell">
      {currentValue === null ? "—" : number(currentValue * scale)}
    </TableCell>
    <TableCell className="hidden text-right font-normal tabular-nums text-muted-foreground md:table-cell">
      {reference === null ? <span aria-label={missingLabel}>—</span> : number(reference * scale)}
    </TableCell>
    <TableCell className="hidden text-right font-normal tabular-nums md:table-cell">
      {difference === null ? <span aria-label={missingLabel}>—</span> : `${difference > 0 ? "+" : ""}${number(difference)}`}
    </TableCell>
  </>;
}
