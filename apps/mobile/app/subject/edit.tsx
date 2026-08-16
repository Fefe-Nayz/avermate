import { useState } from "react";
import { Alert, View } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Button, Empty, Loading, Note, Screen } from "@/components/ui";
import {
  SubjectForm,
  subjectDraftOf,
  type SubjectDraft,
} from "@/components/subject-form";
import { useYear } from "@/components/year-provider";
import { client, orpc, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

export default function EditSubject() {
  const router = useRouter();
  const { id, setup } = useLocalSearchParams<{
    id: string;
    setup?: string;
  }>();
  const { isLoading, yearGraph, yearId } = useYear();

  const subject = yearGraph.byId(id);
  const [draft, setDraft] = useState<SubjectDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);

  const invalidate = async () => {
    if (!yearId) return;
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
      // Academic changes can move the year between announcement audiences;
      // the web invalidates the same projections on save and delete.
      queryClient.invalidateQueries({
        queryKey: orpc.announcements.active.key(),
      }),
      queryClient.invalidateQueries({
        queryKey: orpc.announcements.history.key(),
      }),
    ]);
  };

  const update = useMutation({
    mutationFn: (input: Parameters<typeof client.subjects.update>[0]) =>
      client.subjects.update(input),
    onSuccess: async () => {
      haptic("success");
      await invalidate();
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
    onSuccess: async () => {
      haptic("success");
      await invalidate();
      // Setup opens the editor directly, so its back target is the wizard.
      if (setup === "1") router.back();
      else router.dismissTo("/(tabs)/subjects");
    },
  });

  if (isLoading) return <Loading />;
  if (!subject) {
    return (
      <Screen>
        <Empty
          icon="help-circle-outline"
          title={t("Subject not found")}
          body={t("It may have been deleted, or it belongs to another year.")}
          action={
            <Button
              label={t("Back to subjects")}
              variant="outline"
              onPress={() => router.dismissTo("/(tabs)/subjects")}
            />
          }
        />
      </Screen>
    );
  }

  const current = draft ?? subjectDraftOf(subject);
  const childCount = yearGraph.descendantsOf(subject.id).length;

  /**
   * The web's confirmation is specific: it asks the server what a delete
   * would actually take with it — child subjects, grades, DataCards — before
   * offering "keep the children" against "delete the whole branch". A native
   * alert cannot update its copy once shown, so the impact is fetched first
   * (the button spins) and the local graph stands in if the request fails.
   */
  const confirmDelete = async () => {
    haptic("warning");
    setChecking(true);
    let impact: { descendants: number; grades: number; widgets: number };
    try {
      impact = await queryClient.fetchQuery(
        orpc.subjects.impact.queryOptions({
          input: { subjectId: subject.id },
        }),
      );
    } catch {
      impact = {
        descendants: childCount,
        grades: yearGraph.allGrades(subject.id).length,
        widgets: 0,
      };
    } finally {
      setChecking(false);
    }

    const lines = [
      t("This branch contains {subjects} child subjects and {grades} grades.", {
        subjects: String(impact.descendants),
        grades: String(impact.grades),
      }),
    ];
    if (impact.widgets === 1) {
      lines.push(t("One DataCard will be updated or removed."));
    } else if (impact.widgets > 1) {
      lines.push(
        t("{count} DataCards will be updated or removed.", {
          count: String(impact.widgets),
        }),
      );
    }

    Alert.alert(
      t("Delete {name}?", { name: subject.name }),
      lines.join("\n\n"),
      [
        { text: t("Cancel"), style: "cancel" },
        ...(impact.descendants > 0
          ? [
              {
                text: t("Keep child subjects"),
                onPress: () => {
                  remove.mutate({
                    subjectId: subject.id,
                    promoteChildren: true,
                  });
                },
              },
            ]
          : []),
        {
          text:
            impact.descendants > 0
              ? t("Delete the whole branch")
              : t("Delete subject"),
          style: "destructive" as const,
          onPress: () => {
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
        submitLabel={t("Save changes")}
        busy={update.isPending}
        error={error}
        excludeId={subject.id}
        extra={
          <View style={{ gap: space.md }}>
            {childCount > 0 ? (
              <Note>
                {t(
                  "Deleting this also removes {count} subjects underneath it.",
                  {
                    count: String(childCount),
                  },
                )}
              </Note>
            ) : null}
            <Button
              label={t("Delete")}
              onPress={confirmDelete}
              variant="destructive"
              loading={remove.isPending || checking}
            />
          </View>
        }
      />
    </>
  );
}
