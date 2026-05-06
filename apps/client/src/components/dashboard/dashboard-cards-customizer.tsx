"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, LayoutGrid, Save, Settings2 } from "lucide-react";
import { useTranslations } from "next-intl";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Credenza,
  CredenzaContent,
  CredenzaDescription,
  CredenzaFooter,
  CredenzaHeader,
  CredenzaTitle,
  CredenzaTrigger,
} from "@/components/ui/credenza";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  SelectDrawer,
  SelectDrawerContent,
  SelectDrawerGroup,
  SelectDrawerItem,
  SelectDrawerTrigger,
} from "@/components/ui/selectdrawer";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useUpdateDashboardCardLayout } from "@/hooks/use-dashboard-card-layout";
import { toast } from "@/lib/toast";
import { cn } from "@/lib/utils";
import type { Average } from "@/types/average";
import type { Subject } from "@/types/subject";
import type {
  DashboardCardId,
  DashboardCardLayoutItem,
  DashboardCardTone,
} from "@/types/cards";

const toneClasses: Record<DashboardCardTone, string> = {
  default: "bg-muted",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};

const toneLabelKeys: Record<
  DashboardCardTone,
  "toneNeutral" | "toneBlue" | "toneGreen" | "toneAmber" | "toneRose"
> = {
  default: "toneNeutral",
  blue: "toneBlue",
  green: "toneGreen",
  amber: "toneAmber",
  rose: "toneRose",
};

type CustomizerTranslator = ReturnType<typeof useTranslations<"Dashboard.Cards.Customizer">>;

function getSubjectLabel(
  subjects: Subject[],
  subjectId: string | undefined,
  t: CustomizerTranslator
) {
  if (!subjectId || subjectId === "global") {
    return t("global");
  }

  return (
    subjects.find((subject) => subject.id === subjectId)?.name ??
    t("unknownSubject")
  );
}

function getCardConfigSummary(
  card: DashboardCardLayoutItem,
  averages: Average[],
  subjects: Subject[],
  t: CustomizerTranslator
) {
  if (card.id === "target-average") {
    return t("targetSummary", { target: card.config.targetAverage ?? 16 });
  }

  if (card.id === "selected-custom-average") {
    const average = averages.find(
      (entry) => entry.id === card.config.customAverageId
    );
    return average?.name ?? t("noAverageChosen");
  }

  if (card.id === "main-custom-averages" && card.config.maxItems) {
    return t("maxItemsSummary", { count: card.config.maxItems });
  }

  if (
    [
      "subject-average",
      "median-grade",
      "grade-standard-deviation",
      "average-trend",
      "progression-streak",
      "future-projection",
      "threshold-count",
    ].includes(card.id)
  ) {
    const scope = getSubjectLabel(subjects, card.config.subjectId, t);
    if (card.id === "threshold-count") {
      const comparator = card.config.comparator === "below" ? "<" : ">";
      return t("thresholdSummary", {
        scope,
        comparator,
        threshold: card.config.threshold ?? 15,
      });
    }

    return scope;
  }

  return card.config.compact ? t("compactValue") : t("standardValue");
}

export function DashboardCardsCustomizer({
  layout,
  customAverages = [],
  subjects = [],
}: {
  layout: DashboardCardLayoutItem[];
  customAverages?: Average[];
  subjects?: Subject[];
}) {
  const t = useTranslations("Dashboard.Cards.Customizer");
  const sortedLayout = useMemo(
    () => [...layout].sort((a, b) => a.position - b.position),
    [layout]
  );
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(sortedLayout);
  const [selectedId, setSelectedId] = useState<DashboardCardId>(
    sortedLayout[0]?.id ?? "general-average"
  );
  const updateLayout = useUpdateDashboardCardLayout();

  useEffect(() => {
    if (!open) {
      setDraft(sortedLayout);
      setSelectedId(sortedLayout[0]?.id ?? "general-average");
    }
  }, [sortedLayout, open]);

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen) {
      setDraft(sortedLayout);
      setSelectedId(sortedLayout[0]?.id ?? "general-average");
    }
  };

  const selectedCard = useMemo(
    () => draft.find((card) => card.id === selectedId) ?? draft[0],
    [draft, selectedId]
  );

  const moveCard = (index: number, direction: -1 | 1) => {
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= draft.length) {
      return;
    }

    const next = [...draft];
    const current = next[index];
    next[index] = next[targetIndex];
    next[targetIndex] = current;
    setDraft(next.map((card, position) => ({ ...card, position })));
  };

  const patchCard = (
    id: DashboardCardId,
    patch: Partial<DashboardCardLayoutItem>
  ) => {
    setDraft((current) =>
      current.map((card) =>
        card.id === id
          ? {
              ...card,
              ...patch,
              config: {
                ...card.config,
                ...patch.config,
              },
            }
          : card
      )
    );
  };

  const handleSave = () => {
    updateLayout.mutate(draft, {
      onSuccess: () => {
        toast.success(t("savedToast"));
        setOpen(false);
      },
      onError: () => toast.error(t("saveError")),
    });
  };

  const hasCustomAverageChoices = customAverages.length > 0;
  const selectableSubjects = useMemo(
    () =>
      subjects
        .filter((subject) => !subject.isDisplaySubject)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [subjects]
  );
  const scopedCardIds: DashboardCardId[] = [
    "median-grade",
    "grade-standard-deviation",
    "average-trend",
    "progression-streak",
    "future-projection",
    "threshold-count",
  ];
  const subjectScopedCardIds: DashboardCardId[] = [
    "subject-average",
    ...scopedCardIds,
  ];
  const hasSpecificSettings = selectedCard
    ? ([
        "target-average",
        "selected-custom-average",
        "main-custom-averages",
        "best-grade",
        "worst-grade",
        "latest-grade",
      ] as DashboardCardId[]).includes(selectedCard.id) ||
      subjectScopedCardIds.includes(selectedCard.id)
    : false;

  return (
    <Credenza open={open} onOpenChange={handleOpenChange}>
      <CredenzaTrigger asChild>
        <Button variant="outline" className="w-full sm:w-auto">
          <LayoutGrid className="size-4" />
          {t("trigger")}
        </Button>
      </CredenzaTrigger>
      <CredenzaContent className="flex max-h-[min(95svh,820px)] flex-col gap-0 p-0 sm:max-w-[min(1120px,calc(100vw-2rem))] md:max-w-[min(1120px,calc(100vw-2rem))]">
        <CredenzaHeader className="shrink-0 border-b px-5 py-4 text-left">
          <CredenzaTitle>{t("title")}</CredenzaTitle>
          <CredenzaDescription>{t("description")}</CredenzaDescription>
        </CredenzaHeader>

        <div className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[360px_minmax(0,1fr)]">
          <div className="max-h-[260px] shrink-0 overflow-y-auto border-b p-4 lg:max-h-none lg:shrink lg:border-b-0 lg:border-r">
            <div className="space-y-2">
              {draft.map((card, index) => (
                <div
                  role="button"
                  tabIndex={0}
                  key={card.id}
                  onClick={() => setSelectedId(card.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelectedId(card.id);
                    }
                  }}
                  className={cn(
                    "w-full cursor-pointer rounded-lg border p-3 text-left outline-none transition-colors focus-visible:ring-ring/50 focus-visible:ring-[3px]",
                    selectedId === card.id
                      ? "border-primary bg-primary/5"
                      : "hover:bg-muted/40"
                  )}
                >
                  <div className="flex items-center gap-3">
                    <Checkbox
                      checked={card.enabled}
                      onCheckedChange={(checked) =>
                        patchCard(card.id, { enabled: checked === true })
                      }
                      onClick={(event) => event.stopPropagation()}
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={cn(
                            "size-2 rounded-full",
                            toneClasses[card.config.tone ?? "default"]
                          )}
                        />
                        <p className="truncate font-medium">
                          {t(`card_${card.id}` as `card_${DashboardCardId}`)}
                        </p>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {getCardConfigSummary(card, customAverages, subjects, t)}
                      </p>
                    </div>
                    <div className="flex gap-1">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          moveCard(index, -1);
                        }}
                        disabled={index === 0}
                      >
                        <ArrowUp className="size-4" />
                        <span className="sr-only">{t("moveUp")}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="icon-sm"
                        onClick={(event) => {
                          event.stopPropagation();
                          moveCard(index, 1);
                        }}
                        disabled={index === draft.length - 1}
                      >
                        <ArrowDown className="size-4" />
                        <span className="sr-only">{t("moveDown")}</span>
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto p-4">
            {selectedCard ? (
              <div className="space-y-5">
                <div className="flex items-start gap-3">
                  <div className="rounded-md border bg-muted p-2 text-muted-foreground">
                    <Settings2 className="size-4" />
                  </div>
                  <div>
                    <h3 className="font-medium">
                      {t(`card_${selectedCard.id}` as `card_${DashboardCardId}`)}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {t(`desc_${selectedCard.id}` as `desc_${DashboardCardId}`)}
                    </p>
                  </div>
                </div>

                <Tabs defaultValue="general">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="general">{t("tabGeneral")}</TabsTrigger>
                    <TabsTrigger value="specific">{t("tabSpecific")}</TabsTrigger>
                  </TabsList>

                  <TabsContent value="general" className="space-y-4 pt-3">
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div>
                        <Label>{t("visible")}</Label>
                        <p className="text-xs text-muted-foreground">
                          {t("visibleDescription")}
                        </p>
                      </div>
                      <Switch
                        checked={selectedCard.enabled}
                        onCheckedChange={(enabled) =>
                          patchCard(selectedCard.id, { enabled })
                        }
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t("customTitle")}</Label>
                      <Input
                        value={selectedCard.config.title ?? ""}
                        placeholder={t(
                          `card_${selectedCard.id}` as `card_${DashboardCardId}`
                        )}
                        onChange={(event) =>
                          patchCard(selectedCard.id, {
                            config: { title: event.target.value },
                          })
                        }
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="space-y-2">
                        <Label>{t("style")}</Label>
                        <SelectDrawer
                          value={selectedCard.config.tone ?? "default"}
                          onValueChange={(tone) =>
                            patchCard(selectedCard.id, {
                              config: { tone: tone as DashboardCardTone },
                            })
                          }
                        >
                          <SelectDrawerTrigger>
                            {t(toneLabelKeys[selectedCard.config.tone ?? "default"])}
                          </SelectDrawerTrigger>
                          <SelectDrawerContent title={t("styleDrawer")}>
                            <SelectDrawerGroup>
                              {(Object.keys(toneLabelKeys) as DashboardCardTone[]).map(
                                (tone) => (
                                  <SelectDrawerItem key={tone} value={tone}>
                                    <span className="flex items-center gap-2">
                                      <span
                                        className={cn(
                                          "size-2 rounded-full",
                                          toneClasses[tone]
                                        )}
                                      />
                                      {t(toneLabelKeys[tone])}
                                    </span>
                                  </SelectDrawerItem>
                                )
                              )}
                            </SelectDrawerGroup>
                          </SelectDrawerContent>
                        </SelectDrawer>
                      </div>

                      <div className="flex items-end justify-between gap-3 rounded-lg border p-3">
                        <div>
                          <Label>{t("compact")}</Label>
                          <p className="text-xs text-muted-foreground">
                            {t("compactDescription")}
                          </p>
                        </div>
                        <Switch
                          checked={Boolean(selectedCard.config.compact)}
                          onCheckedChange={(compact) =>
                            patchCard(selectedCard.id, {
                              config: { compact },
                            })
                          }
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="specific" className="space-y-4 pt-3">
                    {selectedCard.id === "target-average" ? (
                      <div className="space-y-2">
                        <Label>{t("targetLabel")}</Label>
                        <Input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          max={20}
                          step={0.1}
                          value={selectedCard.config.targetAverage ?? 16}
                          onChange={(event) =>
                            patchCard(selectedCard.id, {
                              config: {
                                targetAverage: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    ) : null}

                    {selectedCard.id === "selected-custom-average" ? (
                      <div className="space-y-2">
                        <Label>{t("customAverage")}</Label>
                        <SelectDrawer
                          value={selectedCard.config.customAverageId ?? ""}
                          onValueChange={(customAverageId) =>
                            patchCard(selectedCard.id, {
                              config: { customAverageId },
                            })
                          }
                        >
                          <SelectDrawerTrigger>
                            {customAverages.find(
                              (average) =>
                                average.id === selectedCard.config.customAverageId
                            )?.name ??
                              (hasCustomAverageChoices
                                ? t("chooseAverage")
                                : t("noAveragesAvailable"))}
                          </SelectDrawerTrigger>
                          <SelectDrawerContent title={t("averagesDrawer")}>
                            <SelectDrawerGroup>
                              {customAverages.map((average) => (
                                <SelectDrawerItem
                                  key={average.id}
                                  value={average.id}
                                >
                                  {average.name}
                                </SelectDrawerItem>
                              ))}
                            </SelectDrawerGroup>
                          </SelectDrawerContent>
                        </SelectDrawer>
                      </div>
                    ) : null}

                    {selectedCard.id === "main-custom-averages" ? (
                      <div className="space-y-2">
                        <Label>{t("maxItemsLabel")}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={12}
                          value={selectedCard.config.maxItems ?? ""}
                          placeholder={t("maxItemsPlaceholder")}
                          onChange={(event) =>
                            patchCard(selectedCard.id, {
                              config: {
                                maxItems: event.target.value
                                  ? Number(event.target.value)
                                  : undefined,
                              },
                            })
                          }
                        />
                      </div>
                    ) : null}

                    {subjectScopedCardIds.includes(selectedCard.id) ? (
                      <div className="space-y-2">
                        <Label>
                          {selectedCard.id === "subject-average"
                            ? t("subject")
                            : t("scope")}
                        </Label>
                        <SelectDrawer
                          value={
                            selectedCard.config.subjectId ??
                            (selectedCard.id === "subject-average"
                              ? undefined
                              : "global")
                          }
                          onValueChange={(subjectId) =>
                            patchCard(selectedCard.id, {
                              config: { subjectId },
                            })
                          }
                        >
                          <SelectDrawerTrigger>
                            {selectedCard.config.subjectId
                              ? getSubjectLabel(
                                  subjects,
                                  selectedCard.config.subjectId,
                                  t
                                )
                              : selectedCard.id === "subject-average"
                                ? t("chooseSubject")
                                : t("global")}
                          </SelectDrawerTrigger>
                          <SelectDrawerContent title={t("scopeDrawer")}>
                            <SelectDrawerGroup>
                              {selectedCard.id !== "subject-average" ? (
                                <SelectDrawerItem value="global">
                                  {t("global")}
                                </SelectDrawerItem>
                              ) : null}
                              {selectableSubjects.map((subject) => (
                                <SelectDrawerItem
                                  key={subject.id}
                                  value={subject.id}
                                >
                                  {subject.name}
                                </SelectDrawerItem>
                              ))}
                            </SelectDrawerGroup>
                          </SelectDrawerContent>
                        </SelectDrawer>
                      </div>
                    ) : null}

                    {selectedCard.id === "threshold-count" ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label>{t("condition")}</Label>
                          <SelectDrawer
                            value={selectedCard.config.comparator ?? "above"}
                            onValueChange={(comparator) =>
                              patchCard(selectedCard.id, {
                                config: {
                                  comparator: comparator as "above" | "below",
                                },
                              })
                            }
                          >
                            <SelectDrawerTrigger>
                              {selectedCard.config.comparator === "below"
                                ? t("thresholdBelow")
                                : t("thresholdAbove")}
                            </SelectDrawerTrigger>
                            <SelectDrawerContent title={t("conditionDrawer")}>
                              <SelectDrawerGroup>
                                <SelectDrawerItem value="above">
                                  {t("thresholdAbove")}
                                </SelectDrawerItem>
                                <SelectDrawerItem value="below">
                                  {t("thresholdBelow")}
                                </SelectDrawerItem>
                              </SelectDrawerGroup>
                            </SelectDrawerContent>
                          </SelectDrawer>
                        </div>
                        <div className="space-y-2">
                          <Label>{t("thresholdLabel")}</Label>
                          <Input
                            type="number"
                            inputMode="decimal"
                            min={0}
                            max={20}
                            step={0.1}
                            value={selectedCard.config.threshold ?? 15}
                            onChange={(event) =>
                              patchCard(selectedCard.id, {
                                config: {
                                  threshold: Number(event.target.value),
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    ) : null}

                    {selectedCard.id === "future-projection" ? (
                      <div className="space-y-2">
                        <Label>{t("projectionStepsLabel")}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={10}
                          value={selectedCard.config.projectionSteps ?? 1}
                          onChange={(event) =>
                            patchCard(selectedCard.id, {
                              config: {
                                projectionSteps: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    ) : null}

                    {[
                      "subject-average",
                      "median-grade",
                      "grade-standard-deviation",
                      "average-trend",
                      "future-projection",
                    ].includes(selectedCard.id) ? (
                      <div className="space-y-2">
                        <Label>{t("decimalsLabel")}</Label>
                        <Input
                          type="number"
                          min={0}
                          max={3}
                          value={selectedCard.config.decimalPlaces ?? 2}
                          onChange={(event) =>
                            patchCard(selectedCard.id, {
                              config: {
                                decimalPlaces: Number(event.target.value),
                              },
                            })
                          }
                        />
                      </div>
                    ) : null}

                    {[
                      "best-grade",
                      "worst-grade",
                      "latest-grade",
                    ].includes(selectedCard.id) ? (
                      <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                        <div>
                          <Label>{t("showSubjectName")}</Label>
                          <p className="text-xs text-muted-foreground">
                            {t("showSubjectNameDescription")}
                          </p>
                        </div>
                        <Switch
                          checked={selectedCard.config.showSubjectName !== false}
                          onCheckedChange={(showSubjectName) =>
                            patchCard(selectedCard.id, {
                              config: { showSubjectName },
                            })
                          }
                        />
                      </div>
                    ) : null}

                    {!hasSpecificSettings ? (
                      <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                        {t("noSpecificSettings")}
                      </p>
                    ) : null}
                  </TabsContent>
                </Tabs>
              </div>
            ) : null}
          </div>
        </div>

        <CredenzaFooter className="shrink-0 border-t px-5 py-4">
          <Button onClick={handleSave} disabled={updateLayout.isPending}>
            <Save className="size-4" />
            {t("save")}
          </Button>
        </CredenzaFooter>
      </CredenzaContent>
    </Credenza>
  );
}
