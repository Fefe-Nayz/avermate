import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Empty, Loading } from "@/components/native";
import { GoalForm, goalDraftOf, type GoalDraft } from "@/components/goal-form";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

export default function EditGoal() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoading, goals, scale } = useYear();

  const goal = goals.find((item) => item.id === id);
  const [draft, setDraft] = useState<GoalDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (input: Parameters<typeof client.goals.update>[0]) =>
      client.goals.update(input),
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

  if (isLoading) return <Loading />;
  if (!goal) {
    return <Empty glyph="help" title={t("Goal not found.")} />;
  }

  return (
    <>
      <Stack.Screen options={{ title: t("Edit goal") }} />
      <GoalForm
        draft={draft ?? goalDraftOf(goal, scale)}
        onChange={setDraft}
        onSubmit={(payload) => {
          setError(null);
          update.mutate({ ...payload, goalId: goal.id });
        }}
        submitLabel={t("Save")}
        busy={update.isPending}
        error={error}
      />
    </>
  );
}
