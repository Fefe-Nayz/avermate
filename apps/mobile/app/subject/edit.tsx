import { useState } from "react";
import { Alert } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Button, Empty, Loading } from "@/components/ui";
import {
  SubjectForm,
  subjectDraftOf,
  type SubjectDraft,
} from "@/components/subject-form";
import { useYear } from "@/components/year-provider";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";

export default function EditSubject() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { isLoading, yearGraph } = useYear();

  const subject = yearGraph.byId(id);
  const [draft, setDraft] = useState<SubjectDraft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (input: Parameters<typeof client.subjects.update>[0]) =>
      client.subjects.update(input),
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

  const remove = useMutation({
    mutationFn: (input: Parameters<typeof client.subjects.delete>[0]) =>
      client.subjects.delete(input),
    onSuccess: () => {
      haptic("success");
      void queryClient.invalidateQueries();
      // Back twice: the subject's own screen is no longer a place to return to.
      router.dismissTo("/(tabs)/subjects");
    },
  });

  if (isLoading) return <Loading />;
  if (!subject) {
    return <Empty icon="help-circle-outline" title={t("Subject not found.")} />;
  }

  const current = draft ?? subjectDraftOf(subject);
  const children = yearGraph.childrenOf(subject.id);
  const grades = yearGraph.allGrades(subject.id).length;

  const confirmDelete = () => {
    Alert.alert(
      t("Delete {name}?", { name: subject.name }),
      grades > 0
        ? t("Its {count} grades go with it. This cannot be undone.", {
            count: grades,
          })
        : t("This cannot be undone."),
      [
        { text: t("Cancel"), style: "cancel" },
        ...(children.length > 0
          ? [
              {
                text: t("Keep what is inside"),
                onPress: () => {
                  haptic("warning");
                  remove.mutate({ subjectId: subject.id, promoteChildren: true });
                },
              },
            ]
          : []),
        {
          text: t("Delete"),
          style: "destructive" as const,
          onPress: () => {
            haptic("warning");
            remove.mutate({ subjectId: subject.id, promoteChildren: false });
          },
        },
      ],
    );
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Edit subject") }} />
      <SubjectForm
        draft={current}
        onChange={setDraft}
        onSubmit={(payload) => {
          setError(null);
          update.mutate({ ...payload, subjectId: subject.id });
        }}
        submitLabel={t("Save")}
        busy={update.isPending}
        error={error}
        excludeId={subject.id}
        extra={
          <Button
            label={t("Delete subject")}
            onPress={confirmDelete}
            variant="destructive"
            loading={remove.isPending}
          />
        }
      />
    </>
  );
}
