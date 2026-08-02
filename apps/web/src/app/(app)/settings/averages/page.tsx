"use client";

import Link from "next/link";
import { ChevronRightIcon, PlusIcon, SigmaIcon, StarIcon } from "lucide-react";
import { useExtracted } from "next-intl";
import { resolveCustomAverage } from "@avermate/core";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { PageMeta } from "@/components/shell/page-chrome";
import { AverageValue } from "@/components/data/value";
import { useYear } from "@/components/year/year-provider";

export default function AveragesSettingsPage() {
  const t = useExtracted();
  const { customAverages, graph } = useYear();

  return (
    <>
      <PageMeta title={t("Custom averages")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
            {t("Custom averages")}
          </h1>
          <Button
            size="sm"
            className="ml-auto"
            render={<Link href="/settings/averages/new" />}
          >
            <PlusIcon className="size-4" />
            {t("New")}
          </Button>
        </div>

        {customAverages.length === 0 ? (
          <Empty className="rounded-xl border border-dashed py-14">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <SigmaIcon />
              </EmptyMedia>
              <EmptyTitle>{t("No custom averages")}</EmptyTitle>
              <EmptyDescription>
                {t(
                  "Combine any subjects with weights of your own — written exams only, or the science block, or whatever your school actually grades you on.",
                )}
              </EmptyDescription>
            </EmptyHeader>
            <Button render={<Link href="/settings/averages/new" />}>
              <PlusIcon className="size-4" />
              {t("Create one")}
            </Button>
          </Empty>
        ) : (
          <ul className="overflow-hidden rounded-xl border bg-card">
            {customAverages.map((average, index) => {
              const resolved = resolveCustomAverage(graph, average);
              const ratio = resolved.graph.ratio(null, resolved.scope);

              return (
                <li key={average.id} className={index > 0 ? "border-t" : undefined}>
                  <Link
                    href={`/settings/averages/${average.id}`}
                    className="flex min-h-14 items-center gap-3 px-4 py-3 transition-colors hover:bg-accent/60 active:bg-accent"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                        {average.name}
                        {average.isMain ? (
                          <StarIcon className="size-3.5 shrink-0 text-primary" />
                        ) : null}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t("{count} subjects", { count: String(average.entries.length) })}
                      </p>
                    </div>
                    <AverageValue
                      ratio={ratio}
                      showScale
                      colored
                      className="font-medium"
                    />
                    <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground/60" />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </>
  );
}
