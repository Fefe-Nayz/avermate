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

export interface ManagedPresetConfiguration {
  subjects: ManagedPresetSubject[];
  averages: ManagedPresetAverage[];
}

export interface FlatPresetSubject {
  depth: number;
  subject: ManagedPresetSubject;
}

export const EMPTY_PRESET_CONFIGURATION: ManagedPresetConfiguration = {
  subjects: [
    {
      key: "first-subject",
      name: "First subject",
      kind: "subject",
      isMain: true,
      coefficient: 1,
      children: [],
    },
  ],
  averages: [],
};

export function flattenPresetSubjects(
  subjects: readonly ManagedPresetSubject[],
  depth = 0,
): FlatPresetSubject[] {
  return subjects.flatMap((subject) => [
    { subject, depth },
    ...flattenPresetSubjects(subject.children, depth + 1),
  ]);
}

export function updatePresetSubject(
  subjects: readonly ManagedPresetSubject[],
  key: string,
  update: (subject: ManagedPresetSubject) => ManagedPresetSubject,
): ManagedPresetSubject[] {
  return subjects.map((subject) =>
    subject.key === key
      ? update(subject)
      : {
          ...subject,
          children: updatePresetSubject(subject.children, key, update),
        },
  );
}

export function addPresetSubject(
  subjects: readonly ManagedPresetSubject[],
  parentKey: string | null,
  subject: ManagedPresetSubject,
): ManagedPresetSubject[] {
  if (parentKey === null) return [...subjects, subject];
  return updatePresetSubject(subjects, parentKey, (parent) => ({
    ...parent,
    kind: "category",
    children: [...parent.children, subject],
  }));
}

function subtreeKeys(subject: ManagedPresetSubject): string[] {
  return [
    subject.key,
    ...subject.children.flatMap((child) => subtreeKeys(child)),
  ];
}

export function removePresetSubject(
  configuration: ManagedPresetConfiguration,
  key: string,
): ManagedPresetConfiguration {
  const removed = new Set<string>();
  const visit = (
    subjects: readonly ManagedPresetSubject[],
  ): ManagedPresetSubject[] =>
    subjects.flatMap((subject) => {
      if (subject.key === key) {
        for (const nestedKey of subtreeKeys(subject)) removed.add(nestedKey);
        return [];
      }
      return [{ ...subject, children: visit(subject.children) }];
    });
  const subjects = visit(configuration.subjects);
  return {
    subjects,
    averages: configuration.averages.flatMap((average) => {
      const entries = average.entries.filter(
        (entry) => !removed.has(entry.subjectKey),
      );
      return entries.length > 0 ? [{ ...average, entries }] : [];
    }),
  };
}

export function parseManagedPresetConfiguration(
  raw: string,
): ManagedPresetConfiguration {
  const value = JSON.parse(raw) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Configuration must be an object");
  }
  const configuration = value as Partial<ManagedPresetConfiguration>;
  if (
    !Array.isArray(configuration.subjects) ||
    configuration.subjects.length === 0
  ) {
    throw new Error("At least one subject is required");
  }
  if (!Array.isArray(configuration.averages)) {
    throw new Error("Averages must be an array");
  }
  return configuration as ManagedPresetConfiguration;
}

export function presetConfigurationProblems(
  configuration: ManagedPresetConfiguration,
): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();
  if (configuration.subjects.length === 0) {
    problems.push("At least one subject is required");
  }
  if (configuration.subjects.length > 300) {
    problems.push("Too many top-level subjects");
  }
  for (const { subject } of flattenPresetSubjects(configuration.subjects)) {
    if (!/^[a-zA-Z0-9:._-]{1,128}$/.test(subject.key)) {
      problems.push(`Invalid subject key: ${subject.key}`);
    }
    if (keys.has(subject.key))
      problems.push(`Duplicate subject key: ${subject.key}`);
    keys.add(subject.key);
    if (!subject.name.trim() || subject.name.trim().length > 96)
      problems.push(`Subject ${subject.key} has no name`);
    if ((subject.shortName?.trim().length ?? 0) > 24) {
      problems.push(`Subject ${subject.key} has an invalid short name`);
    }
    if (
      !Number.isFinite(subject.coefficient) ||
      subject.coefficient < 0 ||
      subject.coefficient > 1000
    ) {
      problems.push(`Subject ${subject.key} has an invalid coefficient`);
    }
    if (subject.children.length > 200) {
      problems.push(`Subject ${subject.key} has too many children`);
    }
    if (subject.kind === "subject" && subject.children.length > 0) {
      problems.push(`Plain subject ${subject.key} cannot have children`);
    }
  }
  const averageKeys = new Set<string>();
  if (configuration.averages.length > 100) {
    problems.push("Too many custom averages");
  }
  for (const average of configuration.averages) {
    if (!/^[a-zA-Z0-9:._-]{1,128}$/.test(average.key)) {
      problems.push(`Invalid average key: ${average.key}`);
    }
    if (averageKeys.has(average.key)) {
      problems.push(`Duplicate average key: ${average.key}`);
    }
    averageKeys.add(average.key);
    if (!average.name.trim() || average.name.trim().length > 64) {
      problems.push(`Average ${average.key} has no name`);
    }
    if (average.entries.length === 0 || average.entries.length > 200) {
      problems.push(`Average ${average.key} needs a subject`);
    }
    const entryKeys = new Set<string>();
    for (const entry of average.entries) {
      if (!keys.has(entry.subjectKey)) {
        problems.push(`Average ${average.key} references ${entry.subjectKey}`);
      }
      if (entryKeys.has(entry.subjectKey)) {
        problems.push(
          `Average ${average.key} repeats subject ${entry.subjectKey}`,
        );
      }
      entryKeys.add(entry.subjectKey);
      if (
        entry.coefficient !== null &&
        (!Number.isFinite(entry.coefficient) ||
          entry.coefficient < 0 ||
          entry.coefficient > 1000)
      ) {
        problems.push(`Average ${average.key} has an invalid coefficient`);
      }
    }
  }
  return problems;
}
