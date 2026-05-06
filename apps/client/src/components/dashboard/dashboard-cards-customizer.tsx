"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, LayoutGrid, Save, Settings2 } from "lucide-react";

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

const labels: Record<DashboardCardId, string> = {
  "general-average": "Moyenne générale",
  "main-custom-averages": "Moyennes épinglées",
  "selected-custom-average": "Moyenne personnalisée",
  "target-average": "Objectif de moyenne",
  "average-evolution": "Évolution",
  "best-grade": "Meilleure note",
  "latest-grade": "Dernière note",
  "grades-count": "Nombre de notes",
  "subjects-count": "Matières actives",
  "best-subject": "Meilleure matière",
  "worst-grade": "Moins bonne note",
  "worst-subject": "Matière à surveiller",
  "subject-average": "Moyenne d'une matière",
  "median-grade": "Médiane",
  "grade-standard-deviation": "Écart-type",
  "average-trend": "Tendance",
  "progression-streak": "Streak de progression",
  "future-projection": "Projection",
  "threshold-count": "Notes au seuil",
};

const descriptions: Record<DashboardCardId, string> = {
  "general-average": "Affiche la moyenne globale de la période.",
  "main-custom-averages": "Affiche les moyennes personnalisées épinglées.",
  "selected-custom-average": "Affiche une moyenne personnalisée précise.",
  "target-average": "Compare la moyenne globale à un objectif.",
  "average-evolution": "Montre la variation depuis le début de la période.",
  "best-grade": "Met en avant la meilleure note.",
  "latest-grade": "Affiche la note ajoutée la plus récemment.",
  "grades-count": "Compte les notes disponibles dans les matières chargées.",
  "subjects-count": "Compte les matières avec au moins une note.",
  "best-subject": "Met en avant la matière la plus forte.",
  "worst-grade": "Met en avant la note la plus faible.",
  "worst-subject": "Met en avant la matière à surveiller.",
  "subject-average": "Affiche une moyenne ciblée sur une matière.",
  "median-grade": "Affiche la note médiane du périmètre choisi.",
  "grade-standard-deviation": "Mesure la dispersion des notes du périmètre.",
  "average-trend": "Affiche la variation récente de moyenne.",
  "progression-streak": "Compte la plus longue série d'amélioration.",
  "future-projection": "Projette la prochaine moyenne probable.",
  "threshold-count": "Compte les notes au-dessus ou sous un seuil.",
};

const toneLabels: Record<DashboardCardTone, string> = {
  default: "Neutre",
  blue: "Bleu",
  green: "Vert",
  amber: "Ambre",
  rose: "Rose",
};

const toneClasses: Record<DashboardCardTone, string> = {
  default: "bg-muted",
  blue: "bg-blue-500",
  green: "bg-emerald-500",
  amber: "bg-amber-500",
  rose: "bg-rose-500",
};

function getSubjectLabel(subjects: Subject[], subjectId?: string) {
  if (!subjectId || subjectId === "global") {
    return "Global";
  }

  return (
    subjects.find((subject) => subject.id === subjectId)?.name ??
    "Matière inconnue"
  );
}

function getCardConfigSummary(
  card: DashboardCardLayoutItem,
  averages: Average[],
  subjects: Subject[]
) {
  if (card.id === "target-average") {
    return `Objectif ${card.config.targetAverage ?? 16}/20`;
  }

  if (card.id === "selected-custom-average") {
    const average = averages.find(
      (entry) => entry.id === card.config.customAverageId
    );
    return average?.name ?? "Aucune moyenne choisie";
  }

  if (card.id === "main-custom-averages" && card.config.maxItems) {
    return `${card.config.maxItems} carte(s) max`;
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
    const scope = getSubjectLabel(subjects, card.config.subjectId);
    if (card.id === "threshold-count") {
      const comparator = card.config.comparator === "below" ? "<" : ">";
      return `${scope} ${comparator} ${card.config.threshold ?? 15}/20`;
    }

    return scope;
  }

  return card.config.compact ? "Compact" : "Standard";
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
        toast.success("Cartes enregistrées");
        setOpen(false);
      },
      onError: () => toast.error("Impossible d'enregistrer les cartes."),
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
          Personnaliser les cartes
        </Button>
      </CredenzaTrigger>
      <CredenzaContent className="flex max-h-[min(95svh,820px)] flex-col gap-0 p-0 sm:max-w-[min(1120px,calc(100vw-2rem))] md:max-w-[min(1120px,calc(100vw-2rem))]">
        <CredenzaHeader className="shrink-0 border-b px-5 py-4 text-left">
          <CredenzaTitle>Cartes de l'accueil</CredenzaTitle>
          <CredenzaDescription>
            Choisissez les cartes visibles, leur ordre et les options propres à
            chaque type de carte.
          </CredenzaDescription>
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
                        <p className="truncate font-medium">{labels[card.id]}</p>
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {getCardConfigSummary(card, customAverages, subjects)}
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
                        <span className="sr-only">Monter</span>
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
                        <span className="sr-only">Descendre</span>
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
                    <h3 className="font-medium">{labels[selectedCard.id]}</h3>
                    <p className="text-sm text-muted-foreground">
                      {descriptions[selectedCard.id]}
                    </p>
                  </div>
                </div>

                <Tabs defaultValue="general">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="general">Général</TabsTrigger>
                    <TabsTrigger value="specific">Spécifique</TabsTrigger>
                  </TabsList>

                  <TabsContent value="general" className="space-y-4 pt-3">
                    <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
                      <div>
                        <Label>Visible</Label>
                        <p className="text-xs text-muted-foreground">
                          Afficher cette carte sur l'accueil.
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
                      <Label>Titre personnalisé</Label>
                      <Input
                        value={selectedCard.config.title ?? ""}
                        placeholder={labels[selectedCard.id]}
                        onChange={(event) =>
                          patchCard(selectedCard.id, {
                            config: { title: event.target.value },
                          })
                        }
                      />
                    </div>

                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
                      <div className="space-y-2">
                        <Label>Style</Label>
                        <SelectDrawer
                          value={selectedCard.config.tone ?? "default"}
                          onValueChange={(tone) =>
                            patchCard(selectedCard.id, {
                              config: { tone: tone as DashboardCardTone },
                            })
                          }
                        >
                          <SelectDrawerTrigger>
                            {toneLabels[selectedCard.config.tone ?? "default"]}
                          </SelectDrawerTrigger>
                          <SelectDrawerContent title="Style">
                            <SelectDrawerGroup>
                              {Object.entries(toneLabels).map(([tone, label]) => (
                                <SelectDrawerItem key={tone} value={tone}>
                                  <span className="flex items-center gap-2">
                                    <span
                                      className={cn(
                                        "size-2 rounded-full",
                                        toneClasses[tone as DashboardCardTone]
                                      )}
                                    />
                                    {label}
                                  </span>
                                </SelectDrawerItem>
                              ))}
                            </SelectDrawerGroup>
                          </SelectDrawerContent>
                        </SelectDrawer>
                      </div>

                      <div className="flex items-end justify-between gap-3 rounded-lg border p-3">
                        <div>
                          <Label>Compact</Label>
                          <p className="text-xs text-muted-foreground">
                            Réduit la hauteur de la carte.
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
                        <Label>Objectif sur 20</Label>
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
                        <Label>Moyenne personnalisée</Label>
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
                                ? "Choisir une moyenne"
                                : "Aucune moyenne disponible")}
                          </SelectDrawerTrigger>
                          <SelectDrawerContent title="Moyenne personnalisée">
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
                        <Label>Nombre maximal de cartes</Label>
                        <Input
                          type="number"
                          min={1}
                          max={12}
                          value={selectedCard.config.maxItems ?? ""}
                          placeholder="Toutes"
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
                            ? "Matière"
                            : "Périmètre"}
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
                                  selectedCard.config.subjectId
                                )
                              : selectedCard.id === "subject-average"
                                ? "Choisir une matière"
                                : "Global"}
                          </SelectDrawerTrigger>
                          <SelectDrawerContent title="Périmètre">
                            <SelectDrawerGroup>
                              {selectedCard.id !== "subject-average" ? (
                                <SelectDrawerItem value="global">
                                  Global
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
                          <Label>Condition</Label>
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
                                ? "Sous le seuil"
                                : "Au-dessus du seuil"}
                            </SelectDrawerTrigger>
                            <SelectDrawerContent title="Condition">
                              <SelectDrawerGroup>
                                <SelectDrawerItem value="above">
                                  Au-dessus du seuil
                                </SelectDrawerItem>
                                <SelectDrawerItem value="below">
                                  Sous le seuil
                                </SelectDrawerItem>
                              </SelectDrawerGroup>
                            </SelectDrawerContent>
                          </SelectDrawer>
                        </div>
                        <div className="space-y-2">
                          <Label>Seuil sur 20</Label>
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
                        <Label>Nombre de notes projetées</Label>
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
                        <Label>Décimales</Label>
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
                          <Label>Afficher la matière</Label>
                          <p className="text-xs text-muted-foreground">
                            Inclut le nom de la matière dans la description.
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
                        Cette carte n'a pas de réglage spécifique pour le moment.
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
            Enregistrer
          </Button>
        </CredenzaFooter>
      </CredenzaContent>
    </Credenza>
  );
}
