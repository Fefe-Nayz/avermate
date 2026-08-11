import { useEffect, useMemo, useState } from "react";
import { Alert, Text } from "react-native";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AdminGate } from "@/components/admin/admin-gate";
import { SwitchField, TextField } from "@/components/field";
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
} from "@/components/ui";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { type, usePalette } from "@/lib/theme";
import {
  EMPTY_PRESET_CONFIGURATION,
  presetConfigurationProblems,
  type ManagedPresetConfiguration,
} from "./admin-preset-model";
import { PresetConfigurationEditor } from "./preset-configuration-editor";

interface PresetDraft {
  configuration: ManagedPresetConfiguration;
  description: string;
  featured: boolean;
  name: string;
  tags: string;
}

const initialDraft = (): PresetDraft => ({
  configuration: EMPTY_PRESET_CONFIGURATION,
  description: "",
  featured: false,
  name: "",
  tags: "",
});

function tags(value: string): string[] {
  return value
    .split(",")
    .map((tag) => tag.trim())
    .filter(Boolean);
}

async function refreshPresets(presetId?: string): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: orpc.presets.admin.list.key() }),
    queryClient.invalidateQueries({ queryKey: orpc.presets.list.key() }),
    ...(presetId
      ? [
          queryClient.invalidateQueries({
            queryKey: orpc.presets.admin.get.queryKey({ input: { presetId } }),
          }),
        ]
      : []),
  ]);
}

export function AdminPresetsScreen() {
  const palette = usePalette();
  const router = useRouter();
  const presets = useQuery(orpc.presets.admin.list.queryOptions());

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Managed presets") }} />
      <Screen
        footer={
          <Button
            label={t("New managed preset")}
            onPress={() => router.push("/admin/preset/new")}
          />
        }
      >
        <Note>
          {t(
            "Publish versioned curriculum updates without overwriting school years that users customized.",
          )}
        </Note>
        {presets.isLoading ? <Loading /> : null}
        {presets.isError ? (
          <Problem>{t("Managed presets could not be loaded.")}</Problem>
        ) : null}
        {(presets.data?.length ?? 0) === 0 && !presets.isLoading ? (
          <Empty
            icon="layers-outline"
            title={t("No managed presets")}
            body={t(
              "Create one stable subject, then publish richer versions over time.",
            )}
          />
        ) : (
          <Card padded={false}>
            {presets.data?.map((preset, index) => (
              <Row
                key={preset.id}
                first={index === 0}
                title={preset.name}
                subtitle={`${t("Version {version}", {
                  version: preset.currentVersion,
                })} · ${t("{linked} linked · {customized} customized", {
                  linked: preset.adoption.linked,
                  customized: preset.adoption.customized,
                })}`}
                onPress={() => router.push(`/admin/preset/${preset.id}`)}
                trailing={
                  <Text
                    style={[
                      type.footnote,
                      {
                        color: preset.archived
                          ? palette.textFaint
                          : preset.adoption.updateAvailable > 0
                            ? palette.negative
                            : palette.textMuted,
                      },
                    ]}
                  >
                    {preset.archived
                      ? t("Archived")
                      : preset.adoption.updateAvailable > 0
                        ? t("{count} updates", {
                            count: preset.adoption.updateAvailable,
                          })
                        : t("Published")}
                  </Text>
                }
              />
            ))}
          </Card>
        )}
        <Note>
          {t(
            "Adoption is counted per school year. A user who customizes a linked preset leaves that preset until they explicitly rejoin.",
          )}
        </Note>
      </Screen>
    </AdminGate>
  );
}

export function AdminPresetCreateScreen() {
  const router = useRouter();
  const [presetId, setPresetId] = useState("");
  const [draft, setDraft] = useState<PresetDraft>(initialDraft);
  const problems = presetConfigurationProblems(draft.configuration);
  const create = useMutation({
    ...orpc.presets.admin.create.mutationOptions(),
    onSuccess: async (created) => {
      haptic("success");
      await refreshPresets(created?.id);
      if (created) router.replace(`/admin/preset/${created.id}`);
      else router.replace("/admin/presets");
    },
  });
  const ready =
    /^[a-zA-Z0-9_-]{3,80}$/.test(presetId.trim()) &&
    Boolean(draft.name.trim()) &&
    problems.length === 0;

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("New managed preset") }} />
      <Screen
        footer={
          <Button
            label={t("Create preset")}
            disabled={!ready || create.isPending}
            loading={create.isPending}
            onPress={() =>
              create.mutate({
                id: presetId.trim(),
                name: draft.name.trim(),
                description: draft.description.trim(),
                tags: tags(draft.tags),
                featured: draft.featured,
                configuration: draft.configuration,
              })
            }
          />
        }
      >
        <Section title={t("Preset identity")}>
          <TextField
            label={t("Stable ID")}
            value={presetId}
            onChangeText={setPresetId}
            autoCapitalize="none"
            placeholder="france-high-school"
          />
          <Note>
            {t(
              "Letters, numbers, underscores and hyphens. This cannot change later.",
            )}
          </Note>
          <TextField
            label={t("Name")}
            value={draft.name}
            onChangeText={(name) => setDraft((value) => ({ ...value, name }))}
          />
          <TextField
            label={t("Description")}
            value={draft.description}
            onChangeText={(description) =>
              setDraft((value) => ({ ...value, description }))
            }
            multiline
          />
          <TextField
            label={t("Tags")}
            value={draft.tags}
            onChangeText={(value) =>
              setDraft((draftValue) => ({ ...draftValue, tags: value }))
            }
            placeholder={t("Separate tags with commas")}
          />
          <SwitchField
            label={t("Featured")}
            hint={t("Highlight this preset during onboarding")}
            value={draft.featured}
            onValueChange={(featured) =>
              setDraft((value) => ({ ...value, featured }))
            }
          />
        </Section>
        <PresetConfigurationEditor
          value={draft.configuration}
          onChange={(configuration) =>
            setDraft((value) => ({ ...value, configuration }))
          }
        />
        {create.isError ? (
          <Problem>
            {t(
              "The preset could not be created. Verify stable keys and references.",
            )}
          </Problem>
        ) : null}
      </Screen>
    </AdminGate>
  );
}

export function AdminPresetDetailScreen() {
  const palette = usePalette();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [draft, setDraft] = useState<PresetDraft | null>(null);
  const [loadedVersion, setLoadedVersion] = useState<number | null>(null);
  const [changeNote, setChangeNote] = useState("");
  const detail = useQuery({
    ...orpc.presets.admin.get.queryOptions({ input: { presetId: id } }),
    enabled: Boolean(id),
  });
  const currentVersion = useMemo(
    () =>
      detail.data?.versions.find(
        (version) => version.version === detail.data?.currentVersion,
      ),
    [detail.data],
  );

  useEffect(() => {
    if (
      !detail.data ||
      !currentVersion ||
      loadedVersion === currentVersion.version
    ) {
      return;
    }
    setDraft({
      name: detail.data.name,
      description: detail.data.description,
      tags: detail.data.tags.join(", "),
      featured: detail.data.featured,
      configuration: currentVersion.configuration as ManagedPresetConfiguration,
    });
    setLoadedVersion(currentVersion.version);
    setChangeNote("");
  }, [currentVersion, detail.data, loadedVersion]);

  const publish = useMutation({
    ...orpc.presets.admin.publish.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setLoadedVersion(null);
      await refreshPresets(id);
    },
  });
  const archive = useMutation({
    ...orpc.presets.admin.archive.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      await refreshPresets(id);
    },
  });
  const problems = draft
    ? presetConfigurationProblems(draft.configuration)
    : [];

  const publishDraft = () => {
    if (!draft || !detail.data || !changeNote.trim() || problems.length > 0) {
      return;
    }
    Alert.alert(
      t("Publish preset version {version}?", {
        version: detail.data.currentVersion + 1,
      }),
      t(
        "Linked years can then adopt this version. Customized years are never overwritten automatically.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Publish"),
          onPress: () =>
            publish.mutate({
              presetId: id,
              name: draft.name.trim(),
              description: draft.description.trim(),
              tags: tags(draft.tags),
              featured: draft.featured,
              changeNote: changeNote.trim(),
              configuration: draft.configuration,
            }),
        },
      ],
    );
  };

  return (
    <AdminGate>
      <Stack.Screen
        options={{ title: detail.data?.name ?? t("Managed preset") }}
      />
      {detail.isLoading || !draft ? <Loading /> : null}
      {detail.isError ? (
        <Screen>
          <Problem>{t("This managed preset could not be loaded.")}</Problem>
        </Screen>
      ) : null}
      {detail.data && draft ? (
        <Screen
          footer={
            <Button
              label={t("Publish new version")}
              disabled={
                !draft.name.trim() ||
                !changeNote.trim() ||
                problems.length > 0 ||
                publish.isPending
              }
              loading={publish.isPending}
              onPress={publishDraft}
            />
          }
        >
          <Section title={t("Version status")}>
            <Card padded={false}>
              <Row
                first
                title={t("Current version")}
                subtitle={String(detail.data.currentVersion)}
              />
              <Row
                title={t("State")}
                subtitle={detail.data.archived ? t("Archived") : t("Published")}
              />
            </Card>
            <Button
              label={
                detail.data.archived ? t("Restore preset") : t("Archive preset")
              }
              variant={detail.data.archived ? "secondary" : "destructive"}
              loading={archive.isPending}
              onPress={() =>
                Alert.alert(
                  detail.data.archived
                    ? t("Restore this preset?")
                    : t("Archive this preset?"),
                  t(
                    "Existing linked years remain intact. This only changes catalogue availability.",
                  ),
                  [
                    { text: t("Cancel"), style: "cancel" },
                    {
                      text: detail.data.archived ? t("Restore") : t("Archive"),
                      style: detail.data.archived ? "default" : "destructive",
                      onPress: () =>
                        archive.mutate({
                          presetId: id,
                          archived: !detail.data.archived,
                        }),
                    },
                  ],
                )
              }
            />
          </Section>

          <Section title={t("Metadata")}>
            <TextField
              label={t("Name")}
              value={draft.name}
              onChangeText={(name) =>
                setDraft((value) => value && { ...value, name })
              }
            />
            <TextField
              label={t("Description")}
              value={draft.description}
              onChangeText={(description) =>
                setDraft((value) => value && { ...value, description })
              }
              multiline
            />
            <TextField
              label={t("Tags")}
              value={draft.tags}
              onChangeText={(value) =>
                setDraft(
                  (draftValue) => draftValue && { ...draftValue, tags: value },
                )
              }
            />
            <SwitchField
              label={t("Featured")}
              value={draft.featured}
              onValueChange={(featured) =>
                setDraft((value) => value && { ...value, featured })
              }
            />
          </Section>

          <PresetConfigurationEditor
            value={draft.configuration}
            onChange={(configuration) =>
              setDraft((value) => value && { ...value, configuration })
            }
          />

          <Section title={t("Publication note")}>
            <TextField
              label={t("What changed?")}
              value={changeNote}
              onChangeText={setChangeNote}
              multiline
            />
            <Note>
              {t(
                "Users see this note before deciding whether to adopt the update.",
              )}
            </Note>
          </Section>

          <Section title={t("Version history")}>
            <Card padded={false}>
              {detail.data.versions.toReversed().map((version, index) => (
                <Row
                  key={version.id}
                  first={index === 0}
                  title={t("Version {version}", { version: version.version })}
                  subtitle={`${version.changeNote} · ${new Date(
                    version.createdAt,
                  ).toLocaleDateString()}`}
                  trailing={
                    <Text style={[type.footnote, { color: palette.textMuted }]}>
                      {version.version === detail.data.currentVersion
                        ? t("Current")
                        : ""}
                    </Text>
                  }
                />
              ))}
            </Card>
          </Section>

          {publish.isError || archive.isError ? (
            <Problem>
              {t("The preset changed elsewhere or could not be updated.")}
            </Problem>
          ) : null}
        </Screen>
      ) : null}
    </AdminGate>
  );
}
