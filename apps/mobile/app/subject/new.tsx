import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import {
  SubjectForm,
  emptySubjectDraft,
  type SubjectDraft,
} from "@/components/subject-form";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

export default function NewSubject() {
  const router = useRouter();
  const { yearId } = useYear();
  const { parentId } = useLocalSearchParams<{ parentId?: string }>();

  const [draft, setDraft] = useState<SubjectDraft>(() =>
    emptySubjectDraft(parentId),
  );
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: Parameters<typeof client.subjects.create>[0]) =>
      client.subjects.create(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      router.back();
    },
    onError: () => {
      haptic("error");
      setError(t("The subject could not be saved."));
    },
  });

  return (
    <>
      <Stack.Screen options={{ title: t("New subject") }} />
      <SubjectForm
        draft={draft}
        onChange={setDraft}
        onSubmit={(payload) => {
          if (!yearId) return;
          setError(null);
          create.mutate({ ...payload, yearId });
        }}
        submitLabel={t("Add subject")}
        busy={create.isPending}
        error={error}
      />
    </>
  );
}
