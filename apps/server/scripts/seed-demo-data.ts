/**
 * Pure, deterministic demo-data generator.
 *
 * This module deliberately has no database or schema dependency: the seed
 * runner can map these records to the current persistence layer without
 * coupling fixture generation to Drizzle.
 */

export type DemoProvider = "credential" | "google" | "microsoft";
export type DemoRole = "user" | "admin";
export type DemoSubjectKind = "category" | "subject";

export interface DemoActivity {
  createdAt: Date;
  lastActiveAt: Date;
  activeDays30: number;
  gradeEvents30: number;
}

export interface DemoProfile {
  id: string;
  isSynthetic: true;
  name: string;
  email: string;
  emailVerified: boolean;
  banned: boolean;
  banReason: string | null;
  role: DemoRole;
  provider: DemoProvider;
  academicData: "dense" | "none";
  activity: DemoActivity;
}

export interface DemoPeriod {
  id: string;
  name: string;
  startAt: Date;
  endAt: Date;
  isCumulative: boolean;
  sortOrder: number;
}

export interface DemoSubject {
  id: string;
  name: string;
  shortName: string | null;
  parentId: string | null;
  coefficient: number;
  kind: DemoSubjectKind;
  isMain: boolean;
  sortOrder: number;
}

export interface DemoGradeComponent {
  id: string;
  name: string;
  value: number;
  outOf: 20 | 50 | 60;
  coefficient: 1 | 2 | 3 | 4;
  sortOrder: number;
}

export interface DemoGrade {
  id: string;
  name: string;
  value: number;
  outOf: 20 | 50 | 60;
  coefficient: 1 | 2 | 3 | 4;
  isComposite: boolean;
  note: string | null;
  passedAt: Date;
  subjectId: string;
  periodId: string;
  components: DemoGradeComponent[];
}

export interface DemoCustomAverageEntry {
  subjectId: string;
  coefficient: number | null;
  includeChildren: boolean;
}

export interface DemoCustomAverage {
  id: string;
  name: string;
  isMain: boolean;
  sortOrder: number;
  entries: DemoCustomAverageEntry[];
}

export interface DemoGoal {
  id: string;
  name: string;
  kind: "general" | "subject" | "custom";
  referenceId: string | null;
  targetRatio: number;
  periodId: string | null;
  dueAt: Date | null;
  achievedAt: Date | null;
  isPinned: boolean;
  sortOrder: number;
}

export interface DemoYear {
  id: string;
  name: string;
  track: string;
  startsAt: Date;
  endsAt: Date;
  scale: 20;
  defaultOutOf: 20;
  passingRatio: 0.5;
  decimals: 2;
  sortOrder: number;
  periods: DemoPeriod[];
  subjects: DemoSubject[];
  grades: DemoGrade[];
  customAverages: DemoCustomAverage[];
  goals: DemoGoal[];
}

export interface DemoUser {
  profile: DemoProfile;
  years: DemoYear[];
}

export interface BuildDemoCohortOptions {
  size?: number;
  seed?: number;
  now?: Date;
}

/** Mulberry32: compact, reproducible and more than adequate for fixtures. */
class Random {
  constructor(private state: number) {}

  next(): number {
    this.state |= 0;
    this.state = (this.state + 0x6d2b79f5) | 0;
    let value = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  }

  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(values: readonly T[]): T {
    return values[this.int(0, values.length - 1)]!;
  }
}

const DAY = 86_400_000;
const HOUR = 3_600_000;
const DEFAULT_SEED = 0x41564552;
const OUT_OF = [20, 20, 50, 20, 60, 20] as const;
const COEFFICIENTS = [1, 1, 2, 1, 3, 4] as const;
const LANGUAGES = ["Espagnol", "Allemand", "Italien"] as const;
const PROVIDERS = [
  "credential",
  "credential",
  "credential",
  "credential",
  "credential",
  "credential",
  "credential",
  "credential",
  "credential",
  "credential",
  "credential",
  "credential",
  "credential",
  "google",
  "google",
  "google",
  "google",
  "google",
  "microsoft",
  "microsoft",
] as const satisfies readonly DemoProvider[];

interface DisciplineDefinition {
  name: string;
  shortName: string;
  coefficient: number;
  modalities: readonly string[];
}

interface TrackDefinition {
  label: string;
  disciplines: readonly [
    DisciplineDefinition,
    DisciplineDefinition,
    DisciplineDefinition,
  ];
}

const TRACKS = [
  {
    label: "MPSI → MP",
    disciplines: [
      {
        name: "Mathématiques",
        shortName: "Maths",
        coefficient: 4,
        modalities: ["Écrit", "Oral", "Approfondissement"],
      },
      {
        name: "Physique-Chimie",
        shortName: "PC",
        coefficient: 3,
        modalities: ["Écrit", "Oral", "TP"],
      },
      {
        name: "Informatique",
        shortName: "Info",
        coefficient: 2,
        modalities: ["Écrit", "TP"],
      },
    ],
  },
  {
    label: "PCSI → PC",
    disciplines: [
      {
        name: "Physique-Chimie",
        shortName: "PC",
        coefficient: 4,
        modalities: ["Écrit", "Oral", "TP"],
      },
      {
        name: "Mathématiques",
        shortName: "Maths",
        coefficient: 3,
        modalities: ["Écrit", "Oral", "Approfondissement"],
      },
      {
        name: "Sciences industrielles",
        shortName: "SII",
        coefficient: 2,
        modalities: ["Écrit", "TP"],
      },
    ],
  },
  {
    label: "PTSI → PT",
    disciplines: [
      {
        name: "Sciences industrielles",
        shortName: "SII",
        coefficient: 4,
        modalities: ["Écrit", "Oral", "TP"],
      },
      {
        name: "Mathématiques",
        shortName: "Maths",
        coefficient: 3,
        modalities: ["Écrit", "Oral", "Approfondissement"],
      },
      {
        name: "Physique-Chimie",
        shortName: "PC",
        coefficient: 2,
        modalities: ["Écrit", "TP"],
      },
    ],
  },
  {
    label: "BCPST",
    disciplines: [
      {
        name: "Biologie-Géologie",
        shortName: "SVT",
        coefficient: 4,
        modalities: ["Écrit", "Oral", "TP"],
      },
      {
        name: "Physique-Chimie",
        shortName: "PC",
        coefficient: 3,
        modalities: ["Écrit", "Oral", "TP"],
      },
      {
        name: "Mathématiques",
        shortName: "Maths",
        coefficient: 2,
        modalities: ["Écrit", "Oral"],
      },
    ],
  },
] as const satisfies readonly TrackDefinition[];

function pad(value: number): string {
  return String(value).padStart(3, "0");
}

function id(...parts: Array<string | number>): string {
  return `synthetic_${parts.join("_")}`;
}

function utcDate(year: number, month: number, day: number, hour = 12): Date {
  return new Date(Date.UTC(year, month, day, hour));
}

function dateBetween(random: Random, from: Date, to: Date): Date {
  const lower = from.getTime();
  const upper = Math.max(lower, to.getTime());
  const timestamp = lower + Math.floor(random.next() * (upper - lower));
  return new Date(Math.floor(timestamp / 60_000) * 60_000);
}

function shiftDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function makePeriods(
  userNumber: number,
  yearNumber: number,
  startYear: number,
) {
  const prefix = id(`u${pad(userNumber)}`, `y${yearNumber}`, "period");
  const startsAt = utcDate(startYear, 8, 1);
  const semesterBoundary = utcDate(startYear + 1, 0, 31, 23);
  const secondSemesterStart = utcDate(startYear + 1, 1, 1, 0);
  const endsAt = utcDate(startYear + 1, 6, 15, 23);

  return [
    {
      id: `${prefix}_s1`,
      name: "Semestre 1",
      startAt: startsAt,
      endAt: semesterBoundary,
      isCumulative: false,
      sortOrder: 0,
    },
    {
      id: `${prefix}_s2`,
      name: "Semestre 2",
      startAt: secondSemesterStart,
      endAt: endsAt,
      isCumulative: false,
      sortOrder: 1,
    },
    {
      id: `${prefix}_year`,
      name: "Année complète",
      startAt: startsAt,
      endAt: endsAt,
      isCumulative: true,
      sortOrder: 2,
    },
  ] satisfies DemoPeriod[];
}

function makeSubjects(
  userNumber: number,
  yearNumber: number,
  track: TrackDefinition,
  language: (typeof LANGUAGES)[number],
): DemoSubject[] {
  const subjects: DemoSubject[] = [];
  const makeId = (index: number) =>
    id(`u${pad(userNumber)}`, `y${yearNumber}`, `subject${pad(index + 1)}`);

  const add = (
    name: string,
    shortName: string | null,
    parentId: string | null,
    coefficient: number,
    kind: DemoSubjectKind,
    isMain = false,
  ) => {
    const subject: DemoSubject = {
      id: makeId(subjects.length),
      name,
      shortName,
      parentId,
      coefficient,
      kind,
      isMain,
      sortOrder: subjects.length,
    };
    subjects.push(subject);
    return subject;
  };

  const sciences = add(
    "Sciences et techniques",
    "Sciences",
    null,
    4,
    "category",
  );
  for (const discipline of track.disciplines) {
    const parent = add(
      discipline.name,
      discipline.shortName,
      sciences.id,
      discipline.coefficient,
      "category",
      true,
    );
    for (const modality of discipline.modalities) {
      add(
        `${discipline.name} — ${modality}`,
        `${discipline.shortName} ${modality}`,
        parent.id,
        modality === "Écrit" ? 3 : modality === "Oral" ? 2 : 1,
        "subject",
      );
    }
  }

  const humanities = add(
    "Humanités et langues",
    "Humanités",
    null,
    2,
    "category",
  );
  for (const discipline of [
    { name: "Français-Philosophie", shortName: "Français-Philo" },
    { name: "Anglais", shortName: "Anglais" },
    { name: language, shortName: "LVB" },
  ]) {
    const parent = add(
      discipline.name,
      discipline.shortName,
      humanities.id,
      discipline.name === "Français-Philosophie" ? 2 : 1,
      "category",
      true,
    );
    add(
      `${discipline.name} — Écrit`,
      `${discipline.shortName} Écrit`,
      parent.id,
      2,
      "subject",
    );
    add(
      `${discipline.name} — Oral`,
      `${discipline.shortName} Oral`,
      parent.id,
      1,
      "subject",
    );
  }

  const general = add("Formation générale", "Général", null, 1, "category");
  add("TIPE", "TIPE", general.id, 2, "subject", true);
  add("Éducation physique", "EPS", general.id, 1, "subject");

  return subjects;
}

function gradeName(index: number, subjectName: string): string {
  const modality = subjectName.split(" — ").at(-1) ?? subjectName;
  const sequence = Math.floor(index / 6) + 1;
  if (modality === "TP") return `TP ${sequence}`;
  if (modality === "Oral") return `Colle ${sequence}`;
  return [
    `Devoir surveillé ${sequence}`,
    `Interrogation ${sequence}`,
    `Devoir maison ${sequence}`,
    `Concours blanc ${sequence}`,
    `Exercice noté ${sequence}`,
    `Bilan ${sequence}`,
  ][index % 6]!;
}

function makeComponents(
  random: Random,
  gradeId: string,
  baseRatio: number,
  offset: number,
): DemoGradeComponent[] {
  const count = offset % 2 === 0 ? 2 : 3;
  const labels = ["Partie écrite", "Problème", "Restitution orale"];
  return Array.from({ length: count }, (_, index) => {
    const outOf = OUT_OF[(offset + index + 2) % OUT_OF.length]!;
    const coefficient = COEFFICIENTS[(offset + index) % COEFFICIENTS.length]!;
    const ratio = clamp(baseRatio + (random.next() - 0.5) * 0.18, 0.18, 0.99);
    return {
      id: `${gradeId}_component_${index + 1}`,
      name: labels[index]!,
      value: round(ratio * outOf, outOf === 20 ? 2 : 1),
      outOf,
      coefficient,
      sortOrder: index,
    };
  });
}

function componentRatio(components: DemoGradeComponent[]): number {
  const weight = components.reduce(
    (total, component) => total + component.coefficient,
    0,
  );
  return (
    components.reduce(
      (total, component) =>
        total + (component.value / component.outOf) * component.coefficient,
      0,
    ) / weight
  );
}

function makeGrades(input: {
  random: Random;
  userNumber: number;
  yearNumber: number;
  subjects: DemoSubject[];
  periods: DemoPeriod[];
  startsAt: Date;
  endsAt: Date;
  now: Date;
  ability: number;
}): DemoGrade[] {
  const {
    random,
    userNumber,
    yearNumber,
    subjects,
    periods,
    startsAt,
    endsAt,
    now,
    ability,
  } = input;
  const leaves = subjects.filter((subject) => subject.kind === "subject");
  const count = random.int(82, 97);
  const upperDate = new Date(
    Math.max(
      startsAt.getTime(),
      Math.min(endsAt.getTime(), now.getTime() - 6 * HOUR),
    ),
  );
  const outOfOffset = random.int(0, OUT_OF.length - 1);
  const coefficientOffset = random.int(0, COEFFICIENTS.length - 1);
  const trend = (random.next() - 0.25) * 0.13;
  const grades: DemoGrade[] = [];

  for (let index = 0; index < count; index += 1) {
    const subject =
      leaves[(index * 7 + random.int(0, leaves.length - 1)) % leaves.length]!;
    const passedAt = dateBetween(random, startsAt, upperDate);
    const progress =
      upperDate.getTime() === startsAt.getTime()
        ? 0
        : (passedAt.getTime() - startsAt.getTime()) /
          (upperDate.getTime() - startsAt.getTime());
    const subjectBias = ((subjects.indexOf(subject) % 7) - 3) * 0.012;
    const rawRatio =
      ability + subjectBias + trend * progress + (random.next() - 0.5) * 0.31;
    const baseRatio = clamp(rawRatio, 0.16, 0.99);
    const outOf = OUT_OF[(index + outOfOffset) % OUT_OF.length]!;
    const coefficient =
      COEFFICIENTS[(index + coefficientOffset) % COEFFICIENTS.length]!;
    const gradeId = id(
      `u${pad(userNumber)}`,
      `y${yearNumber}`,
      `grade${pad(index + 1)}`,
    );
    const isComposite = (index + userNumber + yearNumber) % 14 === 0;
    const components = isComposite
      ? makeComponents(random, gradeId, baseRatio, index)
      : [];
    const ratio = isComposite ? componentRatio(components) : baseRatio;
    const periodId =
      passedAt.getTime() <= periods[0]!.endAt.getTime()
        ? periods[0]!.id
        : periods[1]!.id;

    grades.push({
      id: gradeId,
      name: gradeName(index, subject.name),
      value: round(ratio * outOf, outOf === 20 ? 2 : 1),
      outOf,
      coefficient,
      isComposite,
      note:
        index % 19 === 0
          ? [
              "Progression régulière",
              "Méthode à consolider",
              "Très bon raisonnement",
              "Revoir la gestion du temps",
            ][(index + userNumber) % 4]!
          : null,
      passedAt,
      subjectId: subject.id,
      periodId,
      components,
    });
  }

  return grades.sort(
    (left, right) => left.passedAt.getTime() - right.passedAt.getTime(),
  );
}

function makeCustomAverages(
  userNumber: number,
  yearNumber: number,
  subjects: DemoSubject[],
): DemoCustomAverage[] {
  const roots = subjects.filter((subject) => subject.parentId === null);
  const sciences = roots.find(
    (subject) => subject.name === "Sciences et techniques",
  )!;
  const written = subjects.filter((subject) =>
    subject.name.endsWith("— Écrit"),
  );
  const prefix = id(`u${pad(userNumber)}`, `y${yearNumber}`, "average");

  return [
    {
      id: `${prefix}_general`,
      name: "Moyenne générale CPGE",
      isMain: true,
      sortOrder: 0,
      entries: roots.map((subject) => ({
        subjectId: subject.id,
        coefficient: null,
        includeChildren: true,
      })),
    },
    {
      id: `${prefix}_science`,
      name: "Bloc scientifique",
      isMain: false,
      sortOrder: 1,
      entries: [
        {
          subjectId: sciences.id,
          coefficient: 4,
          includeChildren: true,
        },
      ],
    },
    {
      id: `${prefix}_written`,
      name: "Écrits de concours",
      isMain: false,
      sortOrder: 2,
      entries: written.map((subject) => ({
        subjectId: subject.id,
        coefficient: null,
        includeChildren: false,
      })),
    },
  ];
}

function makeGoals(input: {
  random: Random;
  userNumber: number;
  yearNumber: number;
  yearEndsAt: Date;
  now: Date;
  ability: number;
  subjects: DemoSubject[];
  periods: DemoPeriod[];
  averages: DemoCustomAverage[];
}): DemoGoal[] {
  const {
    random,
    userNumber,
    yearNumber,
    yearEndsAt,
    now,
    ability,
    subjects,
    periods,
    averages,
  } = input;
  const prefix = id(`u${pad(userNumber)}`, `y${yearNumber}`, "goal");
  const mainSubject = subjects.find(
    (subject) => subject.kind === "category" && subject.isMain,
  )!;
  const finished = yearEndsAt.getTime() < now.getTime();
  const achievedAt = finished
    ? dateBetween(random, periods[1]!.startAt, yearEndsAt)
    : null;

  return [
    {
      id: `${prefix}_general`,
      name: "Atteindre la moyenne cible",
      kind: "general",
      referenceId: null,
      targetRatio: round(clamp(ability + 0.04, 0.52, 0.88), 2),
      periodId: null,
      dueAt: yearEndsAt,
      achievedAt: userNumber % 3 === 0 ? achievedAt : null,
      isPinned: true,
      sortOrder: 0,
    },
    {
      id: `${prefix}_major`,
      name: `Progresser en ${mainSubject.name}`,
      kind: "subject",
      referenceId: mainSubject.id,
      targetRatio: round(clamp(ability + 0.08, 0.56, 0.92), 2),
      periodId: periods[1]!.id,
      dueAt: periods[1]!.endAt,
      achievedAt: userNumber % 4 === 0 ? achievedAt : null,
      isPinned: userNumber % 2 === 0,
      sortOrder: 1,
    },
    {
      id: `${prefix}_written`,
      name: "Renforcer les écrits de concours",
      kind: "custom",
      referenceId: averages[2]!.id,
      targetRatio: round(clamp(ability + 0.02, 0.5, 0.86), 2),
      periodId: null,
      dueAt: shiftDays(yearEndsAt, -21),
      achievedAt: userNumber % 5 === 0 ? achievedAt : null,
      isPinned: false,
      sortOrder: 2,
    },
  ];
}

function makeYear(input: {
  random: Random;
  userNumber: number;
  yearNumber: number;
  startYear: number;
  track: TrackDefinition;
  language: (typeof LANGUAGES)[number];
  now: Date;
  ability: number;
}): DemoYear {
  const {
    random,
    userNumber,
    yearNumber,
    startYear,
    track,
    language,
    now,
    ability,
  } = input;
  const startsAt = utcDate(startYear, 8, 1);
  const endsAt = utcDate(startYear + 1, 6, 15, 23);
  const periods = makePeriods(userNumber, yearNumber, startYear);
  const subjects = makeSubjects(userNumber, yearNumber, track, language);
  const grades = makeGrades({
    random,
    userNumber,
    yearNumber,
    subjects,
    periods,
    startsAt,
    endsAt,
    now,
    ability,
  });
  const customAverages = makeCustomAverages(userNumber, yearNumber, subjects);
  const goals = makeGoals({
    random,
    userNumber,
    yearNumber,
    yearEndsAt: endsAt,
    now,
    ability,
    subjects,
    periods,
    averages: customAverages,
  });

  return {
    id: id(`u${pad(userNumber)}`, `year${yearNumber}`),
    name: `${startYear}–${startYear + 1}`,
    track: track.label,
    startsAt,
    endsAt,
    scale: 20,
    defaultOutOf: 20,
    passingRatio: 0.5,
    decimals: 2,
    sortOrder: yearNumber - 1,
    periods,
    subjects,
    grades,
    customAverages,
    goals,
  };
}

function academicStartYear(now: Date): number {
  return now.getUTCFullYear() - (now.getUTCMonth() < 8 ? 1 : 0);
}

function makeProfile(input: {
  random: Random;
  index: number;
  userNumber: number;
  earliestYearStart: Date;
  now: Date;
}): DemoProfile {
  const { random, index, userNumber, earliestYearStart, now } = input;
  const historicalCreatedAt = shiftDays(
    earliestYearStart,
    -random.int(15, 160),
  );
  // A small recent-signup cohort keeps admin acquisition timelines useful.
  // Some of those accounts intentionally have no academic data yet, mirroring
  // users who registered but have not completed onboarding.
  const createdAt =
    index % 8 === 7 ? shiftDays(now, -random.int(1, 29)) : historicalCreatedAt;
  const activityTier = index % 5;
  const inactivityRanges = [
    [0, 1],
    [1, 4],
    [5, 12],
    [13, 30],
    [45, 180],
  ] as const;
  const [minimumInactive, maximumInactive] = inactivityRanges[activityTier]!;
  const candidateLastActive = shiftDays(
    now,
    -random.int(minimumInactive, maximumInactive),
  );
  const lastActiveAt = new Date(
    Math.max(createdAt.getTime(), candidateLastActive.getTime()),
  );
  const activeDayRanges = [
    [23, 30],
    [15, 22],
    [7, 14],
    [2, 6],
    [0, 1],
  ] as const;
  const eventRanges = [
    [14, 28],
    [8, 16],
    [3, 9],
    [1, 4],
    [0, 0],
  ] as const;
  const [minimumDays, maximumDays] = activeDayRanges[activityTier]!;
  const [minimumEvents, maximumEvents] = eventRanges[activityTier]!;
  const banned = index % 25 === 24;
  const academicData = index % 16 === 15 ? "none" : "dense";

  return {
    id: id(`user${pad(userNumber)}`),
    isSynthetic: true,
    name: `Élève synthétique ${pad(userNumber)}`,
    email: `eleve-synthetique-${pad(userNumber)}@seed.avermate.example`,
    emailVerified: index % 12 !== 11,
    banned,
    banReason: banned ? "Compte de démonstration suspendu" : null,
    role: index % 20 === 0 ? "admin" : "user",
    provider: PROVIDERS[index % PROVIDERS.length]!,
    academicData,
    activity: {
      createdAt,
      lastActiveAt,
      activeDays30: random.int(minimumDays, maximumDays),
      gradeEvents30:
        academicData === "none" ? 0 : random.int(minimumEvents, maximumEvents),
    },
  };
}

export function buildDemoCohort(
  options: BuildDemoCohortOptions = {},
): DemoUser[] {
  const size = options.size ?? 48;
  if (!Number.isInteger(size) || size < 0 || size > 500) {
    throw new RangeError("size must be an integer between 0 and 500");
  }

  const now = new Date(options.now ?? Date.now());
  if (Number.isNaN(now.getTime())) throw new RangeError("now must be valid");

  const seed = options.seed ?? DEFAULT_SEED;
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("seed must be a safe integer");
  }

  const random = new Random(seed);
  const latestStartYear = academicStartYear(now);

  return Array.from({ length: size }, (_, index) => {
    const userNumber = index + 1;
    const yearCount = 1 + (index % 3);
    const earliestYearStart = utcDate(latestStartYear - (yearCount - 1), 8, 1);
    const profile = makeProfile({
      random,
      index,
      userNumber,
      earliestYearStart,
      now,
    });
    const track =
      TRACKS[(index + random.int(0, TRACKS.length - 1)) % TRACKS.length]!;
    const language = random.pick(LANGUAGES);
    const ability = clamp(0.47 + random.next() * 0.4, 0.47, 0.87);
    const visibleStartYears = Array.from(
      { length: yearCount },
      (_, yearIndex) => latestStartYear - yearIndex,
    ).filter(
      (startYear) =>
        utcDate(startYear, 8, 1).getTime() <=
        profile.activity.lastActiveAt.getTime(),
    );
    const years =
      profile.academicData === "none"
        ? []
        : visibleStartYears.map((startYear, yearIndex) =>
            makeYear({
              random,
              userNumber,
              yearNumber: yearIndex + 1,
              startYear,
              track,
              language,
              now: profile.activity.lastActiveAt,
              ability: clamp(ability - yearIndex * 0.025, 0.4, 0.9),
            }),
          );

    return {
      profile,
      years,
    };
  });
}
