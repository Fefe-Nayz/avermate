export interface PresetSubject {
  /** Stable across versions. Omitted only by the legacy bootstrap dataset. */
  key?: string;
  name: string;
  shortName?: string;
  /** Omitted means a plain subject; "category" lets children weigh in above it. */
  kind?: "category";
  isMain?: boolean;
  coefficient?: number;
  children?: PresetSubject[];
}

export interface PresetAverageEntry {
  /** Legacy presets match by name; managed versions use `subjectKey`. */
  name?: string;
  subjectKey?: string;
  coefficient?: number | null;
  includeChildren?: boolean;
}

export interface PresetAverage {
  /** Stable across versions. Omitted only by the legacy bootstrap dataset. */
  key?: string;
  name: string;
  isMain?: boolean;
  entries: PresetAverageEntry[];
}

/** Suggested period layout, expressed as fractions of the year. */
export interface PresetPeriod {
  name: string;
  /** 0..1 through the year. */
  from: number;
  to: number;
  isCumulative?: boolean;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  tags: string[];
  featured: boolean;
  archived: boolean;
  subjects: PresetSubject[];
  averages: PresetAverage[];
  periods?: PresetPeriod[];
}

export interface ManagedPresetSubject {
  key: string;
  name: string;
  shortName?: string;
  kind: "subject" | "category";
  isMain: boolean;
  coefficient: number;
  children: ManagedPresetSubject[];
}

export interface ManagedPresetAverageEntry {
  subjectKey: string;
  coefficient: number | null;
  includeChildren: boolean;
}

export interface ManagedPresetAverage {
  key: string;
  name: string;
  isMain: boolean;
  entries: ManagedPresetAverageEntry[];
}

/** The immutable payload stored for every published preset version. */
export interface ManagedPresetConfiguration {
  subjects: ManagedPresetSubject[];
  averages: ManagedPresetAverage[];
}
