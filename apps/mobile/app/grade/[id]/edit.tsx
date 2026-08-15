import { useEffect, useState } from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import type { Grade } from "@avermate/core";
import { Button, Loading } from "@/components/ui";
import { GradeForm, draftOf, type GradeDraft } from "@/components/grade-form";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

export default function EditGrade() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  const grade = useQuery(
    orpc.grades.get.queryOptions({ input: { gradeId: id } }),
  );
  const [draft, setDraft] = useState<GradeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The form owns the draft once it exists; this only seeds it.
  useEffect(() => {
    if (!grade.data || draft) return;
    const loaded = grade.data as unknown as Grade;
    setDraft(draftOf(loaded, loaded.subjectId));
  }, [grade.data, draft]);

  const update = useMutation({
    mutationFn: (input: Parameters<typeof client.grades.update>[0]) =>
      client.grades.update(input),
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

  const remove = useMutation({
    mutationFn: (input: Parameters<typeof client.grades.delete>[0]) =>
      client.grades.delete(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      // Going back would land on the detail of a grade that no longer
      // exists, so the whole grade stack is dismissed instead.
      router.dismissTo("/(tabs)/grades");
    },
  });

  const confirmDelete = () => {
    Alert.alert(t("Delete this grade?"), t("This cannot be undone."), [
      { text: t("Cancel"), style: "cancel" },
      {
        text: t("Delete"),
        style: "destructive",
        onPress: () => {
          haptic("warning");
          remove.mutate({ gradeId: id });
        },
      },
    ]);
  };

  if (!draft) return <Loading />;

  return (
    <>
      <Stack.Screen options={{ title: t("Edit grade") }} />
      <GradeForm
        draft={draft}
        onChange={setDraft}
        onSubmit={(payload) => {
          setError(null);
          update.mutate({ ...payload, gradeId: id });
        }}
        submitLabel={t("Save")}
        busy={update.isPending}
        error={error}
        excludeGradeId={id}
        extra={
          <Button
            label={t("Delete grade")}
            onPress={confirmDelete}
            variant="destructive"
            loading={remove.isPending}
          />
        }
      />
    </>
  );
}
