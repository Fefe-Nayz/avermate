"use client"

import { BookOpenIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import type {
  AssistantCitationTarget,
  AssistantThreadDetail,
} from "./assistant-types"

/** What the drawer is showing, if anything. */
export type DrawerState =
  | { kind: "closed" }
  | {
      kind: "citation"
      loading: boolean
      target: AssistantCitationTarget | null
    }
  | { kind: "context" }

export function AssistantDrawer({
  drawer,
  detail,
  onClose,
}: {
  drawer: DrawerState
  detail: AssistantThreadDetail
  onClose: () => void
}) {
  const t = useExtracted()
  return (
    <Sheet
      open={drawer.kind !== "closed"}
      onOpenChange={(open) => !open && onClose()}
    >
      <SheetContent side="right" className="w-[min(30rem,100vw)] sm:max-w-md">
        {drawer.kind === "citation" ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("Source")}</SheetTitle>
              <SheetDescription>
                {t("Exact evidence used for this claim.")}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
              {drawer.loading ? (
                <div className="flex flex-col gap-3 pt-4">
                  <Skeleton className="h-5 w-2/3" />
                  <Skeleton className="h-24 w-full" />
                </div>
              ) : drawer.target ? (
                <div className="flex flex-col gap-4 pt-4">
                  <div>
                    <h3 className="font-medium">{drawer.target.title}</h3>
                    {drawer.target.subtitle ? (
                      <p className="text-sm text-muted-foreground">
                        {drawer.target.subtitle}
                      </p>
                    ) : null}
                  </div>
                  {drawer.target.locatorLabel ? (
                    <Badge variant="outline">
                      {drawer.target.locatorLabel}
                    </Badge>
                  ) : null}
                  {drawer.target.excerpt ? (
                    <blockquote className="border-l-2 pl-4 text-sm leading-relaxed">
                      {drawer.target.excerpt}
                    </blockquote>
                  ) : null}
                  {drawer.target.href ? (
                    <Button
                      render={
                        <a
                          href={drawer.target.href}
                          target="_blank"
                          rel="noreferrer"
                        />
                      }
                    >
                      <BookOpenIcon data-icon="inline-start" />
                      {t("Open exact source")}
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="pt-4 text-sm text-muted-foreground">
                  {t("This source is unavailable.")}
                </p>
              )}
            </ScrollArea>
          </>
        ) : drawer.kind === "context" ? (
          <>
            <SheetHeader>
              <SheetTitle>{t("Run context")}</SheetTitle>
              <SheetDescription>
                {t("What was sent, what it cost, and how the run went.")}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="min-h-0 flex-1 px-4 pb-4">
              <div className="flex flex-col gap-5 pt-4">
                <section>
                  <h3 className="text-sm font-medium">{t("Runs")}</h3>
                  <div className="mt-2 flex flex-col gap-2">
                    {[...detail.runs].reverse().map((run) => (
                      <div
                        key={run.id}
                        className="rounded-lg border p-3 text-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-mono">{run.modelKey}</span>
                          <Badge variant="outline">{run.status}</Badge>
                        </div>
                        <div className="mt-1 text-muted-foreground">
                          {run.runtimeId} {run.runtimeVersion}
                        </div>
                        <dl className="mt-2 grid gap-1 text-muted-foreground">
                          <div className="flex justify-between gap-2">
                            <dt>{t("Placement")}</dt>
                            <dd className="truncate font-mono">
                              {run.modelPlacement.kind}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t("Provider")}</dt>
                            <dd className="truncate font-mono">
                              {run.providerKey} · {run.providerRevision}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t("Policy")}</dt>
                            <dd className="truncate font-mono">
                              {run.policyRevision}
                            </dd>
                          </div>
                          <div className="flex justify-between gap-2">
                            <dt>{t("Tools")}</dt>
                            <dd className="truncate font-mono">
                              {run.toolCatalogRevision}
                            </dd>
                          </div>
                        </dl>
                        {run.terminalReason ? (
                          <p className="mt-2 text-destructive">
                            {run.terminalReason}
                          </p>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-medium">
                    {t("Context manifests")}
                  </h3>
                  <div className="mt-2 flex flex-col gap-2">
                    {detail.manifests.map((manifest) => (
                      <div
                        key={manifest.id}
                        className="rounded-lg border p-3 text-xs"
                      >
                        <div className="flex justify-between gap-2">
                          <span>
                            {t(
                              "{count, plural, one {# context item} other {# context items}}",
                              { count: manifest.items.length }
                            )}
                          </span>
                          <span className="text-muted-foreground tabular-nums">
                            {manifest.budget.usedTokens}/
                            {manifest.budget.maxTokens} {t("tokens")}
                          </span>
                        </div>
                        <div className="mt-1 truncate font-mono text-muted-foreground">
                          {manifest.digest}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
                <section>
                  <h3 className="text-sm font-medium">{t("Usage")}</h3>
                  <div className="mt-2 flex flex-col gap-2">
                    {detail.usage.map((usage) => (
                      <div
                        key={usage.runId}
                        className="flex flex-wrap gap-1.5 rounded-lg border p-3 text-xs"
                      >
                        <Badge variant="outline">
                          {usage.inputTokens ?? "—"} {t("input")}
                        </Badge>
                        <Badge variant="outline">
                          {usage.outputTokens ?? "—"} {t("output")}
                        </Badge>
                        <Badge variant="outline">
                          {usage.cachedReadTokens ?? "—"} {t("cached")}
                        </Badge>
                        {usage.estimatedCost ? (
                          <Badge variant="secondary">
                            {usage.estimatedCost} {usage.currency}
                          </Badge>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </ScrollArea>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
