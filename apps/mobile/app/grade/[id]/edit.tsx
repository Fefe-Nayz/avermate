import { useState } from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Button, Empty, Loading, Screen } from "@/components/ui";
import { GradeForm, draftOf, type GradeDraft } from "@/components/grade-form";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

export default function EditGrade() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoading, yearGraph, yearId } = useYear();

  // The year graph already holds every grade of the year — the same source
  // the web edit page reads from, with no second fetch.
  const grade = yearGraph.allGrades().find((item) => item.id === id);

  const [draft, setDraft] = useState<GradeDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A saved grade changes the year snapshot and nothing else, so that is the
  // one query worth refetching — the same key the web invalidates.
  const invalidate = () =>
    queryClient.invalidateQueries({
      queryKey: orpc.snapshot.get.queryKey({
        input: { yearId: yearId ?? "" },
      }),
    });

  const update = useMutation({
    mutationFn: (input: Parameters<typeof client.grades.update>[0]) =>
      client.grades.update(input),
    onSuccess: () => {
      haptic("success");
      void invalidate();
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
      void invalidate();
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

  if (!grade) {
    if (isLoading) return <Loading />;
    return (
      <>
        <Stack.Screen options={{ title: t("Edit grade") }} />
        <Screen>
          <Empty
            icon="document-text-outline"
            title={t("Grade not found")}
            body={t("It may have been deleted, or it belongs to another year.")}
            action={
              <Button
                label={t("Back to grades")}
                variant="outline"
                onPress={() => router.dismissTo("/(tabs)/grades")}
              />
            }
          />
        </Screen>
      </>
    );
  }

  const current = draft ?? draftOf(grade, grade.subjectId);

  return (
    <>
      <Stack.Screen options={{ title: t("Edit grade") }} />
      <GradeForm
        draft={current}
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
