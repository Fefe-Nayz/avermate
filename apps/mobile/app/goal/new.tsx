import { useState } from "react";
import { useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { GoalForm, emptyGoalDraft, type GoalDraft } from "@/components/goal-form";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

export default function NewGoal() {
  const router = useRouter();
  const { yearId, graph, scale } = useYear();

  const [draft, setDraft] = useState<GoalDraft>(() =>
    emptyGoalDraft(scale, graph.ratio(null)),
  );
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: Parameters<typeof client.goals.create>[0]) =>
      client.goals.create(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      router.back();
    },
    onError: () => {
      haptic("error");
      setError(t("The goal could not be saved."));
    },
  });

  return (
    <GoalForm
      draft={draft}
      onChange={setDraft}
      onSubmit={(payload) => {
        if (!yearId) return;
        setError(null);
        create.mutate({ ...payload, yearId, dueAt: null });
      }}
      submitLabel={t("Create goal")}
      busy={create.isPending}
      error={error}
    />
  );
}
