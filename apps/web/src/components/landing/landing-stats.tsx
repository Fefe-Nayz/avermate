"use client";

import { useQuery } from "@tanstack/react-query";
import { useFormatter, useExtracted } from "next-intl";
import { orpc } from "@/lib/orpc";

/** Live counters. Aggregates only — no row ever leaves the server. */
export function LandingStats() {
  const t = useExtracted();
  const format = useFormatter();
  const { data } = useQuery({
    ...orpc.public.stats.queryOptions(),
    staleTime: 10 * 60_000,
  });

  if (!data || data.grades < 50) return null;

  const entries = [
    { label: t("students"), value: data.users },
    { label: t("subjects tracked"), value: data.subjects },
    { label: t("grades recorded"), value: data.grades },
  ];

  return (
    <dl className="flex flex-wrap justify-center gap-x-8 gap-y-3 pt-4">
      {entries.map((entry) => (
        <div key={entry.label} className="text-center">
          <dt className="numeric text-xl font-semibold">
            {format.number(entry.value, { notation: "compact" })}
          </dt>
          <dd className="text-xs text-muted-foreground">{entry.label}</dd>
        </div>
      ))}
    </dl>
  );
}
