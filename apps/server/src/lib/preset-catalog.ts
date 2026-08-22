import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { presetDefinitions, presetVersions } from "../db/schema";
import {
  normalizeLegacyPreset,
  serializePresetConfiguration,
} from "../data/managed-presets";
import { PRESETS } from "../data/presets";

/**
 * Seed the former in-code catalogue as immutable version 1 records. Conflict
 * handling makes this safe at startup, in tests, and across several replicas.
 * Once an administrator has edited a preset, bootstrap never overwrites it.
 */
export async function ensurePresetCatalog(): Promise<void> {
  const statements = PRESETS.flatMap((preset) => [
    db
      .insert(presetDefinitions)
      .values({
        id: preset.id,
        name: preset.name,
        description: preset.description,
        tags: JSON.stringify(preset.tags),
        featured: preset.featured,
        archived: preset.archived,
        currentVersion: 1,
      })
      .onConflictDoNothing({ target: presetDefinitions.id }),
    db
      .insert(presetVersions)
      .values({
        presetId: preset.id,
        version: 1,
        configuration: serializePresetConfiguration(
          normalizeLegacyPreset(preset),
        ),
        changeNote: "Imported from the original Avermate preset catalogue",
      })
      .onConflictDoNothing({
        target: [presetVersions.presetId, presetVersions.version],
      }),
  ]);

  if (statements.length > 0) {
    await db.batch(
      statements as [
        (typeof statements)[number],
        ...(typeof statements)[number][],
      ],
    );
  }
}

export async function findPresetDefinition(presetId: string) {
  await ensurePresetCatalog();
  const [definition] = await db
    .select()
    .from(presetDefinitions)
    .where(eq(presetDefinitions.id, presetId))
    .limit(1);
  return definition ?? null;
}

export async function findPresetVersion(presetId: string, version: number) {
  await ensurePresetCatalog();
  const [row] = await db
    .select()
    .from(presetVersions)
    .where(
      and(
        eq(presetVersions.presetId, presetId),
        eq(presetVersions.version, version),
      ),
    )
    .limit(1);
  return row ?? null;
}
