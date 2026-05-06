import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "@/lib/api";
import { queryKeys } from "@/lib/query-keys";
import type {
  CardLayoutResponse,
  DashboardCardLayoutItem,
} from "@/types/cards";

export const defaultDashboardCardLayout: DashboardCardLayoutItem[] = [
  { id: "general-average", enabled: true, position: 0, config: {} },
  { id: "main-custom-averages", enabled: true, position: 1, config: {} },
  { id: "average-evolution", enabled: true, position: 2, config: {} },
  { id: "best-grade", enabled: true, position: 3, config: { showSubjectName: true } },
  { id: "latest-grade", enabled: true, position: 4, config: { showSubjectName: true } },
  { id: "best-subject", enabled: true, position: 5, config: {} },
  { id: "worst-grade", enabled: true, position: 6, config: { showSubjectName: true } },
  { id: "worst-subject", enabled: true, position: 7, config: {} },
  { id: "grades-count", enabled: false, position: 8, config: { tone: "blue" } },
  { id: "subjects-count", enabled: false, position: 9, config: { tone: "green" } },
  { id: "target-average", enabled: false, position: 10, config: { targetAverage: 16, tone: "amber" } },
  { id: "selected-custom-average", enabled: false, position: 11, config: {} },
  { id: "subject-average", enabled: false, position: 12, config: { tone: "blue" } },
  { id: "median-grade", enabled: false, position: 13, config: {} },
  { id: "grade-standard-deviation", enabled: false, position: 14, config: { tone: "rose" } },
  { id: "average-trend", enabled: false, position: 15, config: { subjectId: "global" } },
  { id: "progression-streak", enabled: false, position: 16, config: { subjectId: "global", tone: "green" } },
  { id: "future-projection", enabled: false, position: 17, config: { subjectId: "global", projectionSteps: 1, tone: "amber" } },
  { id: "threshold-count", enabled: false, position: 18, config: { threshold: 15, comparator: "above", subjectId: "global" } },
];

function normalizeLayout(cards?: DashboardCardLayoutItem[] | null) {
  const knownCards = new Map(defaultDashboardCardLayout.map((card) => [card.id, card]));
  const merged = new Map<string, DashboardCardLayoutItem>();

  for (const card of cards ?? []) {
    const defaultCard = knownCards.get(card.id);
    if (!defaultCard) {
      continue;
    }

    merged.set(card.id, {
      ...defaultCard,
      ...card,
      config: {
        ...defaultCard.config,
        ...card.config,
      },
    });
  }

  for (const card of defaultDashboardCardLayout) {
    if (!merged.has(card.id)) {
      merged.set(card.id, card);
    }
  }

  return [...merged.values()].sort((a, b) => a.position - b.position);
}

export function useDashboardCardLayout(enabled = true) {
  return useQuery({
    queryKey: queryKeys.cards.layout("dashboard"),
    queryFn: async () => {
      const response = await apiClient.get("cards/layouts/dashboard");
      const data = await response.json<CardLayoutResponse>();
      return normalizeLayout(data.layout?.cards);
    },
    enabled,
    staleTime: 5 * 60 * 1000,
  });
}

export function useUpdateDashboardCardLayout() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: queryKeys.cards.layout("dashboard"),
    mutationFn: async (cards: DashboardCardLayoutItem[]) => {
      const normalizedCards = normalizeLayout(cards.map((card, index) => ({
        ...card,
        position: index,
      })));
      const response = await apiClient.put("cards/layouts/dashboard", {
        json: {
          cards: normalizedCards,
        },
      });
      await response.json<CardLayoutResponse>();
      return normalizedCards;
    },
    onSuccess: (cards) => {
      queryClient.setQueryData(queryKeys.cards.layout("dashboard"), cards);
      void queryClient.invalidateQueries({
        queryKey: queryKeys.cards.layout("dashboard"),
      });
    },
  });
}
