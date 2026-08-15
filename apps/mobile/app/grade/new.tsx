import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import {
  GradeForm,
  emptyDraft,
  type GradeDraft,
} from "@/components/grade-form";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

export default function NewGrade() {
  const router = useRouter();
  const { year } = useYear();
  const { subjectId } = useLocalSearchParams<{ subjectId?: string }>();

  const [draft, setDraft] = useState<GradeDraft>(() =>
    emptyDraft(year?.defaultOutOf ?? 20, subjectId),
  );
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: Parameters<typeof client.grades.create>[0]) =>
      client.grades.create(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      router.back();
    },
    onError: () => {
      haptic("error");
      setError(t("The grade could not be saved."));
    },
  });

  return (
    <GradeForm
      draft={draft}
      onChange={setDraft}
      onSubmit={(payload) => {
        setError(null);
        create.mutate(payload);
      }}
      submitLabel={t("Add grade")}
      busy={create.isPending}
      error={error}
    />
  );
}
