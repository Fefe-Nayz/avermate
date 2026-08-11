import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import * as Crypto from "expo-crypto";
import { Stack, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Ionicons } from "@expo/vector-icons";
import type { Subject } from "@avermate/core";
import { DateField } from "@/components/date-field";
import {
  ChoiceField,
  FieldGroup,
  SwitchField,
  TextField,
} from "@/components/field";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
  Title,
} from "@/components/ui";
import { useYear } from "@/components/year-provider";
import { useSession } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { client, orpc, queryClient } from "@/lib/orpc";
import { radius, space, type, usePalette } from "@/lib/theme";
import {
  clearYearSetupDraft,
  loadYearSetupDraft,
  persistYearSetupDraft,
  YEAR_SETUP_DRAFT_VERSION,
  type PersistedPeriodDraft,
  type YearSetupDraft,
  type YearSetupStep,
} from "@/lib/year-setup-draft";
import {
  isValidYearSetup,
  nativeSchoolYearSuggestion,
  periodDraftsForTemplate,
  validPeriodDrafts,
  yearSetupHref,
  type PeriodTemplateChoice,
} from "@/lib/year-setup";

interface WizardSnapshot {
  year: {
    id: string;
    name: string;
    startsAt: Date;
    endsAt: Date;
    scale: number;
  };
  subjects: Subject[];
  periods: Array<{
    id: string;
    name: string;
    startAt: Date;
    endAt: Date;
    isCumulative: boolean;
  }>;
}

function createIdempotencyKey(): string {
  return `mobile-year-${Crypto.randomUUID()}`;
}

function newDraft(
  suggestion: ReturnType<typeof nativeSchoolYearSuggestion>,
): YearSetupDraft {
  return {
    version: YEAR_SETUP_DRAFT_VERSION,
    idempotencyKey: createIdempotencyKey(),
    yearId: null,
    step: "year",
    year: {
      name: suggestion.name,
      startsAt: suggestion.startsAt.toISOString(),
      endsAt: suggestion.endsAt.toISOString(),
      scale: String(suggestion.scale),
    },
    periods: null,
    updatedAt: Date.now(),
  };
}

function draftFromSnapshot(
  snapshot: WizardSnapshot,
  step: Extract<YearSetupStep, "subjects" | "periods"> = "subjects",
): YearSetupDraft {
  return {
    version: YEAR_SETUP_DRAFT_VERSION,
    idempotencyKey: createIdempotencyKey(),
    yearId: snapshot.year.id,
    step,
    year: {
      name: snapshot.year.name,
      startsAt: new Date(snapshot.year.startsAt).toISOString(),
      endsAt: new Date(snapshot.year.endsAt).toISOString(),
      scale: String(snapshot.year.scale),
    },
    periods: snapshot.periods.map((period) => ({
      localId: period.id,
      periodId: period.id,
      name: period.name,
      startsAt: new Date(period.startAt).toISOString(),
      endsAt: new Date(period.endAt).toISOString(),
      isCumulative: period.isCumulative,
    })),
    updatedAt: Date.now(),
  };
}

function mergeYearIntoList(
  year: Awaited<ReturnType<typeof client.presets.setupYear>>,
): void {
  queryClient.setQueryData(
    orpc.years.list.queryKey(),
    (current: Awaited<ReturnType<typeof client.years.list>> | undefined) => [
      year,
      ...(current ?? []).filter((item) => item.id !== year.id),
    ],
  );
}

function setupStepIndex(step: YearSetupStep): number {
  return { year: 0, subjects: 1, periods: 2 }[step];
}

export function YearSetupWizard({ yearId }: { yearId?: string }) {
  const palette = usePalette();
  const router = useRouter();
  const session = useSession();
  const userId = session.data?.user.id ?? null;
  const { allYears, selectYear } = useYear();
  const selectYearRef = useRef(selectYear);
  useEffect(() => {
    selectYearRef.current = selectYear;
  }, [selectYear]);
  const [draft, setDraft] = useState<YearSetupDraft | null>(null);
  const [otherDraft, setOtherDraft] = useState<YearSetupDraft | null>(null);
  const [storageLoaded, setStorageLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [periodTemplate, setPeriodTemplate] =
    useState<PeriodTemplateChoice | null>(null);

  const suggestion = useMemo(
    () => nativeSchoolYearSuggestion(new Date(), allYears),
    [allYears],
  );
  const suggestionRef = useRef(suggestion);
  if (!storageLoaded) suggestionRef.current = suggestion;
  const snapshot = useQuery({
    ...orpc.snapshot.get.queryOptions({ input: { yearId: yearId ?? "" } }),
    enabled: Boolean(yearId),
  });
  const presets = useQuery({
    ...orpc.presets.list.queryOptions(),
    enabled: Boolean(yearId && draft?.step === "subjects"),
  });
  const configurationStatus = useQuery({
    ...orpc.years.configurationStatus.queryOptions({
      input: { yearId: yearId ?? "" },
    }),
    enabled: Boolean(yearId),
  });

  useEffect(() => {
    if (yearId) selectYearRef.current(yearId);
  }, [yearId]);

  useEffect(() => {
    if (!userId) return;
    let alive = true;
    setStorageLoaded(false);
    void loadYearSetupDraft(userId)
      .then(async (saved) => {
        if (!alive) return;
        if (!yearId && saved?.yearId) {
          router.replace(yearSetupHref(saved.yearId));
          return;
        }
        if (!yearId && saved && !saved.yearId) {
          let recovered: Awaited<
            ReturnType<typeof client.presets.setupYearStatus>
          >;
          try {
            recovered = await client.presets.setupYearStatus({
              idempotencyKey: saved.idempotencyKey,
            });
          } catch {
            // Offline recovery still leaves the exact submitted input visible
            // and retryable; never replace it with a fresh idempotency key.
            setDraft(saved);
            return;
          }
          if (!alive) return;
          if (recovered) {
            const next = {
              ...saved,
              yearId: recovered.year.id,
              step: "subjects" as const,
              updatedAt: Date.now(),
            };
            await persistYearSetupDraft(userId, next);
            mergeYearIntoList(recovered.year);
            selectYearRef.current(recovered.year.id);
            router.replace(yearSetupHref(recovered.year.id));
            return;
          }
        }
        if (yearId && saved?.yearId === yearId) {
          setDraft(saved.step === "year" ? saved : { ...saved });
        } else if (yearId && saved) {
          setOtherDraft(saved);
        } else if (!yearId) {
          setDraft(saved ?? newDraft(suggestionRef.current));
        }
      })
      .catch(() => {
        if (alive && !yearId) setDraft(newDraft(suggestionRef.current));
      })
      .finally(() => {
        if (alive) setStorageLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [router, userId, yearId]);

  useEffect(() => {
    if (
      !storageLoaded ||
      !yearId ||
      draft ||
      otherDraft ||
      !snapshot.data ||
      !configurationStatus.data
    ) {
      return;
    }
    setDraft(
      draftFromSnapshot(
        snapshot.data as unknown as WizardSnapshot,
        configurationStatus.data.recommendedStep === "periods"
          ? "periods"
          : "subjects",
      ),
    );
  }, [
    configurationStatus.data,
    draft,
    otherDraft,
    snapshot.data,
    storageLoaded,
    yearId,
  ]);

  useEffect(() => {
    if (!storageLoaded || !userId || !draft) return;
    void persistYearSetupDraft(userId, draft);
  }, [draft, storageLoaded, userId]);

  const patchDraft = useCallback((patch: Partial<YearSetupDraft>) => {
    setDraft((current) =>
      current ? { ...current, ...patch, updatedAt: Date.now() } : current,
    );
  }, []);

  const setStep = (step: YearSetupStep) => {
    setError(null);
    patchDraft({ step });
  };

  const saveYear = useMutation({
    mutationFn: async (current: YearSetupDraft) => {
      const scale = Number(current.year.scale) || 20;
      const year = {
        name: current.year.name.trim(),
        startsAt: new Date(current.year.startsAt),
        endsAt: new Date(current.year.endsAt),
        scale,
        defaultOutOf: scale,
        passingRatio: 0.5,
        decimals: 2,
      };
      if (current.yearId) {
        return client.years.update({ yearId: current.yearId, ...year });
      }
      return client.presets.setupYear({
        idempotencyKey: current.idempotencyKey,
        year,
        presetId: null,
        periodTemplateId: "none",
        periodNames: [],
      });
    },
  });

  const advanceFromYear = async () => {
    if (!draft || !userId) return;
    setError(null);
    await persistYearSetupDraft(userId, draft);
    try {
      const year = await saveYear.mutateAsync(draft);
      mergeYearIntoList(year);
      const next = {
        ...draft,
        yearId: year.id,
        step: "subjects" as const,
        updatedAt: Date.now(),
      };
      await persistYearSetupDraft(userId, next);
      selectYearRef.current(year.id);
      haptic("success");
      if (!yearId) router.replace(yearSetupHref(year.id));
      else setDraft(next);
    } catch {
      haptic("error");
      setError(
        t("The year could not be saved. Your progress is kept on this device."),
      );
    }
  };

  const applyPreset = useMutation({
    mutationFn: ({
      presetId,
      replaceExisting,
    }: {
      presetId: string;
      replaceExisting: boolean;
    }) => client.presets.apply({ yearId: yearId!, presetId, replaceExisting }),
    onSuccess: async () => {
      haptic("success");
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: orpc.snapshot.get.queryKey({ input: { yearId: yearId! } }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.presets.status.queryKey({
            input: { yearId: yearId! },
          }),
        }),
        queryClient.invalidateQueries({
          queryKey: orpc.years.configurationStatus.queryKey({
            input: { yearId: yearId! },
          }),
        }),
      ]);
    },
    onError: () => {
      haptic("error");
      setError(
        t(
          "The preset could not be applied because existing data still depends on this configuration.",
        ),
      );
    },
  });

  const choosePreset = (presetId: string) => {
    const subjectCount =
      (snapshot.data as WizardSnapshot | undefined)?.subjects.length ?? 0;
    if (subjectCount === 0) {
      applyPreset.mutate({ presetId, replaceExisting: false });
      return;
    }
    Alert.alert(
      t("Replace this configuration?"),
      t(
        "This replaces the current subjects and averages. Avermate blocks the operation if any grade could be deleted.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Replace and link"),
          style: "destructive",
          onPress: () =>
            applyPreset.mutate({ presetId, replaceExisting: true }),
        },
      ],
    );
  };

  const advanceFromSubjects = () => {
    if (!draft) return;
    const subjects =
      (snapshot.data as WizardSnapshot | undefined)?.subjects ?? [];
    if (subjects.length === 0) {
      haptic("error");
      setError(t("Add at least one subject before continuing."));
      return;
    }
    const periods =
      draft.periods ??
      periodDraftsForTemplate(
        "trimesters",
        new Date(draft.year.startsAt),
        new Date(draft.year.endsAt),
      );
    setPeriodTemplate(draft.periods === null ? "trimesters" : null);
    patchDraft({ step: "periods", periods });
  };

  const savePeriods = useMutation({
    mutationFn: (periods: PersistedPeriodDraft[]) =>
      client.periods.replaceAll({
        yearId: yearId!,
        periods: periods.map((period) => ({
          periodId: period.periodId,
          name: period.name.trim(),
          startAt: new Date(period.startsAt),
          endAt: new Date(period.endsAt),
          isCumulative: period.isCumulative,
        })),
      }),
  });

  const finish = async () => {
    if (!draft || !draft.periods || !userId || !yearId) return;
    if (!validPeriodDrafts(draft.periods)) {
      haptic("error");
      setError(t("Periods must be named, ordered and must not overlap."));
      return;
    }
    setError(null);
    await persistYearSetupDraft(userId, draft);
    try {
      const periods = await savePeriods.mutateAsync(draft.periods);
      queryClient.setQueryData(
        orpc.snapshot.get.queryKey({ input: { yearId } }),
        (current) => (current ? { ...current, periods } : current),
      );
      await queryClient.invalidateQueries({
        queryKey: orpc.presets.status.queryKey({ input: { yearId } }),
      });
      await queryClient.invalidateQueries({
        queryKey: orpc.years.configurationStatus.queryKey({
          input: { yearId },
        }),
      });
      await clearYearSetupDraft(userId, draft.idempotencyKey);
      selectYearRef.current(yearId);
      haptic("success");
      router.dismissTo("/(tabs)");
    } catch {
      haptic("error");
      setError(
        t(
          "The periods could not be saved. Your progress is kept on this device.",
        ),
      );
    }
  };

  const discardSavedSetup = () => {
    if (!draft || !userId) return;
    Alert.alert(
      t("Discard saved setup?"),
      t(
        "The year stays in your account, but this device will stop offering to resume its setup.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Discard"),
          style: "destructive",
          onPress: () => {
            void clearYearSetupDraft(userId, draft.idempotencyKey).then(() =>
              router.back(),
            );
          },
        },
      ],
    );
  };

  const replaceOtherSetup = () => {
    if (!otherDraft || !userId) return;
    Alert.alert(
      t("Replace the saved setup?"),
      t(
        "The other year stays in your account. Only its unfinished setup progress on this device is discarded.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Replace"),
          style: "destructive",
          onPress: () => {
            void clearYearSetupDraft(
              userId,
              otherDraft.idempotencyKey,
            ).then(() => setOtherDraft(null));
          },
        },
      ],
    );
  };

  if (storageLoaded && yearId && otherDraft) {
    const resumeHref = otherDraft.yearId
      ? yearSetupHref(otherDraft.yearId)
      : ("/year/new" as const);
    return (
      <>
        <Stack.Screen options={{ title: t("Set up school year") }} />
        <Screen>
          <Title
            subtitle={t(
              "Choose which setup to continue. Nothing is discarded automatically.",
            )}
          >
            {t("Another setup is in progress")}
          </Title>
          <Card>
            <Text selectable style={[type.heading, { color: palette.text }]}>
              {otherDraft.year.name}
            </Text>
            <Text
              selectable
              style={[type.footnote, { color: palette.textMuted }]}
            >
              {t("Saved at step {step}", {
                step: t(
                  otherDraft.step === "year"
                    ? "Year"
                    : otherDraft.step === "subjects"
                      ? "Subjects"
                      : "Periods",
                ),
              })}
            </Text>
          </Card>
          <Button
            label={t("Resume {name}", { name: otherDraft.year.name })}
            onPress={() => router.replace(resumeHref)}
          />
          <Button
            label={t("Configure this year instead")}
            variant="ghost"
            onPress={replaceOtherSetup}
          />
        </Screen>
      </>
    );
  }

  if (
    storageLoaded &&
    yearId &&
    (snapshot.isError || configurationStatus.isError)
  ) {
    return (
      <>
        <Stack.Screen options={{ title: t("Set up school year") }} />
        <Screen>
          <Title subtitle={t("Your saved progress has not been removed.")}>
            {t("This year could not be loaded")}
          </Title>
          <Button
            label={t("Try again")}
            onPress={() => {
              void Promise.all([
                snapshot.refetch(),
                configurationStatus.refetch(),
              ]);
            }}
          />
          {draft ? (
            <Button
              label={t("Discard saved setup")}
              variant="ghost"
              onPress={discardSavedSetup}
            />
          ) : null}
        </Screen>
      </>
    );
  }

  if (
    !storageLoaded ||
    !draft ||
    (yearId && (snapshot.isLoading || configurationStatus.isLoading))
  ) {
    return <Loading />;
  }

  const step = draft.step;
  const subjects =
    (snapshot.data as unknown as WizardSnapshot | undefined)?.subjects ?? [];
  const rows = flattenSubjects(subjects);
  const ready = isValidYearSetup(
    draft.year.name,
    new Date(draft.year.startsAt),
    new Date(draft.year.endsAt),
    draft.year.scale,
  );

  return (
    <>
      <Stack.Screen options={{ title: t("Set up school year") }} />
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={{ flex: 1 }}
      >
        <Screen
          footer={
            <View style={{ gap: space.sm }}>
              <Button
                label={
                  step === "periods"
                    ? t("Finish setup")
                    : step === "year" && !draft.yearId
                      ? t("Create and continue")
                      : t("Continue")
                }
                onPress={() => {
                  if (step === "year") void advanceFromYear();
                  else if (step === "subjects") advanceFromSubjects();
                  else void finish();
                }}
                disabled={
                  (step === "year" && !ready) ||
                  (step === "subjects" && subjects.length === 0)
                }
                loading={
                  saveYear.isPending ||
                  applyPreset.isPending ||
                  savePeriods.isPending
                }
              />
              {step !== "year" ? (
                <Pressable
                  accessibilityRole="button"
                  onPress={() =>
                    setStep(step === "periods" ? "subjects" : "year")
                  }
                  style={{ paddingVertical: space.sm }}
                >
                  <Text
                    style={[
                      type.callout,
                      { color: palette.textMuted, textAlign: "center" },
                    ]}
                  >
                    {t("Back")}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          }
        >
          <WizardProgress active={setupStepIndex(step)} />

          {step === "year" ? (
            <YearStep
              draft={draft}
              onChange={(year) => patchDraft({ year })}
              existing={Boolean(draft.yearId)}
            />
          ) : null}

          {step === "subjects" && yearId ? (
            <SubjectsStep
              yearId={yearId}
              rows={rows}
              presets={presets.data ?? []}
              linkedPresetId={configurationStatus.data?.preset.presetId ?? null}
              linked={configurationStatus.data?.preset.state === "current"}
              applying={applyPreset.isPending}
              onChoosePreset={choosePreset}
            />
          ) : null}

          {step === "periods" && draft.periods ? (
            <PeriodsStep
              periods={draft.periods}
              template={periodTemplate}
              yearStartsAt={new Date(draft.year.startsAt)}
              yearEndsAt={new Date(draft.year.endsAt)}
              onTemplate={(template) => {
                setPeriodTemplate(template);
                patchDraft({
                  periods: periodDraftsForTemplate(
                    template,
                    new Date(draft.year.startsAt),
                    new Date(draft.year.endsAt),
                  ),
                });
              }}
              onChange={(periods) => {
                setPeriodTemplate(null);
                patchDraft({ periods });
              }}
            />
          ) : null}

          {error ? <Problem>{error}</Problem> : null}
        </Screen>
      </KeyboardAvoidingView>
    </>
  );
}

function WizardProgress({ active }: { active: number }) {
  const palette = usePalette();
  const labels = [t("Year"), t("Subjects"), t("Periods")];
  return (
    <View style={{ gap: space.sm, paddingTop: space.sm }}>
      <View style={{ flexDirection: "row", gap: space.xs }}>
        {labels.map((label, index) => (
          <View
            key={label}
            style={{
              height: 4,
              flex: index === active ? 2 : 1,
              borderRadius: radius.pill,
              backgroundColor:
                index <= active ? palette.accent : palette.accentSoft,
            }}
          />
        ))}
      </View>
      <Text selectable style={[type.label, { color: palette.textFaint }]}>
        {t("Step {current} of {total}: {name}", {
          current: active + 1,
          total: labels.length,
          name: labels[active]!,
        })}
      </Text>
    </View>
  );
}

function YearStep({
  draft,
  existing,
  onChange,
}: {
  draft: YearSetupDraft;
  existing: boolean;
  onChange: (year: YearSetupDraft["year"]) => void;
}) {
  const patch = (values: Partial<YearSetupDraft["year"]>) =>
    onChange({ ...draft.year, ...values });
  return (
    <>
      <Title
        subtitle={
          existing
            ? t("Review the dates and grading scale before continuing.")
            : t("You can change all of this later.")
        }
      >
        {existing ? t("The year itself") : t("Set up your year")}
      </Title>
      {!existing ? (
        <Note>
          {t("The year is created now, so the rest of setup can be resumed.")}
        </Note>
      ) : null}
      <FieldGroup>
        <TextField
          label={t("Year name")}
          value={draft.year.name}
          onChangeText={(name) => patch({ name })}
          autoFocus={!existing}
        />
        <DateField
          label={t("Starts")}
          value={new Date(draft.year.startsAt)}
          onChange={(startsAt) => patch({ startsAt: startsAt.toISOString() })}
        />
        <DateField
          label={t("Ends")}
          value={new Date(draft.year.endsAt)}
          onChange={(endsAt) => patch({ endsAt: endsAt.toISOString() })}
          min={new Date(draft.year.startsAt)}
        />
        <ChoiceField
          label={t("Grades are out of")}
          columns={2}
          value={draft.year.scale}
          onChange={(scale) => patch({ scale })}
          choices={[
            { value: "20", label: "20", hint: t("France") },
            { value: "100", label: "100", hint: t("Percentage") },
            { value: "6", label: "6", hint: t("Germany") },
            { value: "4", label: "4", hint: t("GPA") },
          ]}
        />
      </FieldGroup>
    </>
  );
}

interface SubjectRow {
  subject: Subject;
  depth: number;
}

function flattenSubjects(subjects: readonly Subject[]): SubjectRow[] {
  const children = new Map<string | null, Subject[]>();
  for (const subject of subjects) {
    const list = children.get(subject.parentId) ?? [];
    list.push(subject);
    children.set(subject.parentId, list);
  }
  const walk = (parentId: string | null, depth: number): SubjectRow[] =>
    (children.get(parentId) ?? [])
      .toSorted(
        (left, right) =>
          left.sortOrder - right.sortOrder ||
          left.name.localeCompare(right.name),
      )
      .flatMap((subject) => [
        { subject, depth },
        ...walk(subject.id, depth + 1),
      ]);
  return walk(null, 0);
}

function SubjectsStep({
  yearId,
  rows,
  presets,
  linkedPresetId,
  linked,
  applying,
  onChoosePreset,
}: {
  yearId: string;
  rows: SubjectRow[];
  presets: Awaited<ReturnType<typeof client.presets.list>>;
  linkedPresetId: string | null;
  linked: boolean;
  applying: boolean;
  onChoosePreset: (presetId: string) => void;
}) {
  const router = useRouter();
  const palette = usePalette();
  return (
    <>
      <Title
        subtitle={t("Use a preset, then adapt it, or build your own list.")}
      >
        {t("Your subjects")}
      </Title>
      <Note>
        {t(
          "Pick the closest one — you can rename and reweigh everything after.",
        )}
      </Note>

      {presets.length > 0 ? (
        <ChoiceField
          label={t("What do you study?")}
          value={linkedPresetId ?? (rows.length > 0 ? "__manual__" : null)}
          onChange={(value) => {
            if (value !== "__manual__") onChoosePreset(value);
          }}
          choices={[
            {
              value: "__manual__",
              label: t("Start from scratch"),
              hint: t("Add your own subjects"),
            },
            ...presets.map((preset) => ({
              value: preset.id,
              label: preset.name,
              hint: t("{count} subjects", { count: preset.subjectCount }),
              disabled: applying,
            })),
          ]}
        />
      ) : null}

      {linked ? (
        <Note>
          {t(
            "This year follows a managed preset. Editing a subject makes it a protected custom configuration.",
          )}
        </Note>
      ) : null}

      <Section
        title={t("Subjects")}
        action={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("Add a subject")}
            hitSlop={10}
            onPress={() => router.push(`/subject/new?yearId=${yearId}&setup=1`)}
          >
            <Ionicons name="add-circle" size={24} color={palette.accent} />
          </Pressable>
        }
      >
        {rows.length === 0 ? (
          <Card>
            <Empty
              icon="albums-outline"
              title={t("No subjects yet")}
              body={t(
                "Apply a preset above or add the first subject yourself.",
              )}
              action={
                <Button
                  label={t("Add a subject")}
                  variant="secondary"
                  onPress={() =>
                    router.push(`/subject/new?yearId=${yearId}&setup=1`)
                  }
                />
              }
            />
          </Card>
        ) : (
          <Card padded={false}>
            {rows.map(({ subject, depth }, index) => (
              <Row
                key={subject.id}
                first={index === 0}
                indent={depth}
                title={subject.name}
                subtitle={
                  subject.kind === "category"
                    ? t("Category")
                    : t("Weight {value}", { value: subject.coefficient })
                }
                onPress={() =>
                  router.push(
                    `/subject/edit?id=${subject.id}&yearId=${yearId}&setup=1`,
                  )
                }
              />
            ))}
          </Card>
        )}
      </Section>
    </>
  );
}

function PeriodsStep({
  periods,
  template,
  yearStartsAt,
  yearEndsAt,
  onTemplate,
  onChange,
}: {
  periods: PersistedPeriodDraft[];
  template: PeriodTemplateChoice | null;
  yearStartsAt: Date;
  yearEndsAt: Date;
  onTemplate: (template: PeriodTemplateChoice) => void;
  onChange: (periods: PersistedPeriodDraft[]) => void;
}) {
  const palette = usePalette();
  const patch = (localId: string, values: Partial<PersistedPeriodDraft>) =>
    onChange(
      periods.map((period) =>
        period.localId === localId ? { ...period, ...values } : period,
      ),
    );

  const add = () => {
    const previous = periods.at(-1);
    let startsAt = previous ? new Date(previous.endsAt) : yearStartsAt;
    const endsAt = new Date(startsAt);
    endsAt.setMonth(endsAt.getMonth() + 3);
    let existing = periods;
    let resolvedEnd = endsAt > yearEndsAt ? yearEndsAt : endsAt;

    // A full-width last period has no room after it. Split its exact range in
    // two instead of creating a zero-day period or silently leaving the year.
    if (previous && startsAt >= yearEndsAt) {
      const previousStart = new Date(previous.startsAt);
      startsAt = new Date(
        previousStart.getTime() +
          (new Date(previous.endsAt).getTime() - previousStart.getTime()) / 2,
      );
      resolvedEnd = new Date(previous.endsAt);
      existing = periods.map((period) =>
        period.localId === previous.localId
          ? { ...period, endsAt: startsAt.toISOString() }
          : period,
      );
    }
    onChange([
      ...existing,
      {
        localId: `manual-${Crypto.randomUUID()}`,
        name: t("Period {number}", { number: periods.length + 1 }),
        startsAt: startsAt.toISOString(),
        endsAt: resolvedEnd.toISOString(),
        isCumulative: false,
      },
    ]);
  };

  return (
    <>
      <Title subtitle={t("Start with a layout, then adjust every exact date.")}>
        {t("Your periods")}
      </Title>
      <ChoiceField
        label={t("How is your year split?")}
        value={template}
        onChange={onTemplate}
        choices={[
          {
            value: "trimesters",
            label: t("Three terms"),
            hint: t("The usual French layout"),
          },
          { value: "semesters", label: t("Two semesters") },
          {
            value: "semesters-cumulative",
            label: t("Two semesters, cumulative"),
            hint: t("The second one includes the first"),
          },
          { value: "quarters", label: t("Four quarters") },
          {
            value: "none",
            label: t("No split"),
            hint: t("One average for the whole year"),
          },
        ]}
      />
      <Note>{t("Grades will fall into the right one on their own.")}</Note>

      {periods.length === 0 ? (
        <Card>
          <Empty
            icon="cube-outline"
            title={t("No split")}
            body={t("One average will cover the whole school year.")}
            action={
              <Button
                label={t("Add a period")}
                variant="secondary"
                onPress={add}
              />
            }
          />
        </Card>
      ) : (
        periods.map((period, index) => (
          <Section
            key={period.localId}
            title={t("Period {number}", { number: index + 1 })}
            action={
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t("Remove {name}", { name: period.name })}
                hitSlop={10}
                onPress={() =>
                  onChange(
                    periods.filter((item) => item.localId !== period.localId),
                  )
                }
              >
                <Ionicons
                  name="trash-outline"
                  size={19}
                  color={palette.negative}
                />
              </Pressable>
            }
          >
            <Card style={{ gap: space.md }}>
              <TextField
                label={t("Name")}
                value={period.name}
                onChangeText={(name) => patch(period.localId, { name })}
              />
              <DateField
                label={t("Starts")}
                value={new Date(period.startsAt)}
                onChange={(startsAt) =>
                  patch(period.localId, {
                    startsAt: startsAt.toISOString(),
                  })
                }
              />
              <DateField
                label={t("Ends")}
                value={new Date(period.endsAt)}
                min={new Date(period.startsAt)}
                onChange={(endsAt) =>
                  patch(period.localId, { endsAt: endsAt.toISOString() })
                }
              />
              <SwitchField
                label={t("Cumulative")}
                hint={t(
                  "Counts everything since the start of the year, not just this span.",
                )}
                value={period.isCumulative}
                onValueChange={(isCumulative) =>
                  patch(period.localId, { isCumulative })
                }
              />
            </Card>
          </Section>
        ))
      )}

      {periods.length > 0 ? (
        <Button
          label={t("Add another period")}
          icon="add"
          variant="secondary"
          onPress={add}
        />
      ) : null}
    </>
  );
}
