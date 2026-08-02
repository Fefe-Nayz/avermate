export interface PresetSubject {
  name: string;
  shortName?: string;
  /** Omitted means a plain subject; "category" lets children weigh in above it. */
  kind?: "category";
  isMain?: boolean;
  coefficient?: number;
  children?: PresetSubject[];
}

export interface PresetAverageEntry {
  /** Matched against the subject names the preset itself creates. */
  name: string;
  coefficient?: number | null;
  includeChildren?: boolean;
}

export interface PresetAverage {
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
