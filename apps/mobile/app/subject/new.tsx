import { useState } from "react";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import {
  SubjectForm,
  emptySubjectDraft,
  type SubjectDraft,
} from "@/components/subject-form";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

export default function NewSubject() {
  const router = useRouter();
  const { yearId: activeYearId } = useYear();
  const {
    kind: requestedKind,
    parentId,
    yearId: requestedYearId,
  } = useLocalSearchParams<{
    kind?: string;
    parentId?: string;
    yearId?: string;
  }>();
  const yearId = requestedYearId ?? activeYearId;
  // The same defaulting the web's new-subject page applies to its params.
  const kind = requestedKind === "category" ? "category" : "subject";

  const [draft, setDraft] = useState<SubjectDraft>(() =>
    emptySubjectDraft(parentId, kind),
  );
  const [error, setError] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: (input: Parameters<typeof client.subjects.create>[0]) =>
      client.subjects.create(input),
    onSuccess: async () => {
      haptic("success");
      if (yearId) {
        await Promise.all([
          queryClient.invalidateQueries({
            queryKey: orpc.snapshot.get.queryKey({ input: { yearId } }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.presets.status.queryKey({ input: { yearId } }),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.years.configurationStatus.queryKey({
              input: { yearId },
            }),
          }),
          // Academic changes can move the year between announcement
          // audiences; the web invalidates the same projections on save.
          queryClient.invalidateQueries({
            queryKey: orpc.announcements.active.key(),
          }),
          queryClient.invalidateQueries({
            queryKey: orpc.announcements.history.key(),
          }),
        ]);
      }
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
