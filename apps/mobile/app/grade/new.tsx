import { useState } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import {
  GradeForm,
  emptyDraft,
  type GradeDraft,
} from "@/components/grade-form";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

export default function NewGrade() {
  const router = useRouter();
  const { period, year, yearId } = useYear();
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
      // A saved grade changes the year snapshot and nothing else, so that is
      // the one query worth refetching — the same key the web invalidates.
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      });
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
      intro={t("It will be filed into {period} automatically.", {
        period: period.name,
      })}
    />
  );
}
