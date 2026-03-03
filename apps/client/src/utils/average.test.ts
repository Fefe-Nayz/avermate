/// <reference types="node" />

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { average } from "./average";
import type { PartialGrade } from "../types/grade";
import type { Subject } from "../types/subject";

type SubjectInput = {
  id: string;
  name: string;
  parentId: string | null;
  isDisplaySubject: boolean;
  coefficient?: number;
  grades?: Array<{
    value: number;
    outOf: number;
    coefficient?: number;
    passedAt?: string;
    periodId?: string | null;
    name?: string;
  }>;
};

function makeGrade(
  id: string,
  subjectId: string,
  input: {
    value: number;
    outOf: number;
    coefficient?: number;
    passedAt?: string;
    periodId?: string | null;
    name?: string;
  }
): PartialGrade {
  return {
    id,
    name: input.name ?? `Grade ${id}`,
    value: input.value,
    outOf: input.outOf,
    coefficient: input.coefficient ?? 100,
    passedAt: input.passedAt ?? "2026-03-01T00:00:00.000Z",
    subjectId,
    createdAt: "2026-03-01T00:00:00.000Z",
    userId: "u1",
    periodId: input.periodId ?? null,
    yearId: "y1",
  };
}

function makeSubjects(inputs: SubjectInput[]): Subject[] {
  return inputs.map((input) => ({
    id: input.id,
    name: input.name,
    parentId: input.parentId,
    yearId: "y1",
    coefficient: input.coefficient ?? 100,
    userId: "u1",
    depth: 0,
    grades: (input.grades ?? []).map((grade, index) =>
      makeGrade(`${input.id}-g${index + 1}`, input.id, grade)
    ),
    isMainSubject: false,
    isDisplaySubject: input.isDisplaySubject,
    createdAt: new Date("2026-03-01T00:00:00.000Z"),
  }));
}

function closeTo(actual: number | null, expected: number, precision = 4) {
  assert.notEqual(actual, null);
  const delta = Math.abs((actual as number) - expected);
  const tolerance = 10 ** -precision;
  assert.ok(
    delta <= tolerance,
    `Expected ${actual} to be within ${tolerance} of ${expected} (delta=${delta})`
  );
}

describe("average() - conformité calcul moyenne", () => {
  const subjects = makeSubjects([
    // Module Scientifique (display)
    { id: "module-sci", name: "Module Scientifique", parentId: null, isDisplaySubject: true },
    { id: "info", name: "Informatique", parentId: "module-sci", isDisplaySubject: false, grades: [{ value: 1500, outOf: 2000, periodId: "p1" }] },

    { id: "maths", name: "Mathématiques", parentId: "module-sci", isDisplaySubject: true },
    { id: "maths-oral", name: "Mathématiques - Oral", parentId: "maths", isDisplaySubject: false, grades: [{ value: 1200, outOf: 2000, periodId: "p1" }] },
    { id: "maths-ecrit", name: "Mathématiques - Écrit", parentId: "maths", isDisplaySubject: false, grades: [{ value: 1600, outOf: 2000, periodId: null }] },

    { id: "pc", name: "Physique-Chimie", parentId: "module-sci", isDisplaySubject: true },
    { id: "pc-oral", name: "Physique-Chimie - Oral", parentId: "pc", isDisplaySubject: false, grades: [{ value: 1000, outOf: 2000, periodId: "p1" }] },
    { id: "pc-tp", name: "Physique-Chimie - TP", parentId: "pc", isDisplaySubject: false, grades: [{ value: 1400, outOf: 2000, periodId: "p2" }] },
    { id: "pc-ecrit", name: "Physique-Chimie - Écrit", parentId: "pc", isDisplaySubject: false, grades: [{ value: 1800, outOf: 2000, periodId: null }] },

    { id: "si", name: "Sciences Industrielles", parentId: "module-sci", isDisplaySubject: true },
    { id: "si-oral", name: "SI - Oral", parentId: "si", isDisplaySubject: false, grades: [{ value: 1100, outOf: 2000, periodId: "p1" }] },
    { id: "si-tp", name: "SI - TP", parentId: "si", isDisplaySubject: false, grades: [{ value: 1300, outOf: 2000, periodId: "p2" }] },
    { id: "si-ecrit", name: "SI - Écrit", parentId: "si", isDisplaySubject: false, grades: [{ value: 1700, outOf: 2000, periodId: null }] },

    { id: "tipe", name: "TIPE", parentId: "module-sci", isDisplaySubject: false, grades: [{ value: 1900, outOf: 2000, periodId: "p1" }] },

    // Module Sciences Humaines (display)
    { id: "module-sh", name: "Module Sciences Humaines", parentId: null, isDisplaySubject: true },

    { id: "anglais", name: "Anglais", parentId: "module-sh", isDisplaySubject: true },
    { id: "anglais-oral", name: "Anglais - Oral", parentId: "anglais", isDisplaySubject: false, grades: [{ value: 1400, outOf: 2000, periodId: "p1" }] },
    { id: "anglais-ecrit", name: "Anglais - Écrit", parentId: "anglais", isDisplaySubject: false, grades: [{ value: 1600, outOf: 2000, periodId: null }] },

    { id: "francais", name: "Français", parentId: "module-sh", isDisplaySubject: true },
    { id: "fr-oral", name: "Français - Oral", parentId: "francais", isDisplaySubject: false, grades: [{ value: 1100, outOf: 2000, periodId: "p2" }] },
    { id: "fr-ecrit", name: "Français - Écrit", parentId: "francais", isDisplaySubject: false, grades: [{ value: 1500, outOf: 2000, periodId: null }] },

    { id: "bde", name: "BDE / Club / Communications", parentId: "module-sh", isDisplaySubject: false, grades: [{ value: 1300, outOf: 2000, periodId: "p1" }] },
    { id: "lv2", name: "LV2", parentId: "module-sh", isDisplaySubject: false, grades: [{ value: 1200, outOf: 2000, periodId: "p2" }] },
    { id: "sport", name: "Sport", parentId: "module-sh", isDisplaySubject: false, grades: [{ value: 1800, outOf: 2000, periodId: null }] },
    { id: "tipe-ct", name: "TIPE - Compétences Transversales", parentId: "module-sh", isDisplaySubject: false, grades: [{ value: 1700, outOf: 2000, periodId: "p2" }] },
  ]);

  it("calcule correctement une matière feuille", () => {
    closeTo(average("info", subjects), 15);
  });

  it("calcule correctement une catégorie display (visuel) via ses enfants", () => {
    closeTo(average("maths", subjects), 14);
    closeTo(average("pc", subjects), 14);
    closeTo(average("anglais", subjects), 15);
  });

  it("ignore les nœuds display dans la moyenne du parent (remonte les descendants non-display)", () => {
    closeTo(average("module-sci", subjects), 14.5);
    closeTo(average("module-sh", subjects), 14.5);
  });

  it("calcule correctement la moyenne générale", () => {
    closeTo(average(undefined, subjects), 14.5);
  });

  it("retourne null quand aucune note exploitable n'existe", () => {
    const empty = makeSubjects([
      { id: "root", name: "Root", parentId: null, isDisplaySubject: true },
      { id: "cat", name: "Cat", parentId: "root", isDisplaySubject: true },
      { id: "leaf", name: "Leaf", parentId: "cat", isDisplaySubject: false, grades: [] },
    ]);

    assert.equal(average(undefined, empty), null);
    assert.equal(average("root", empty), null);
    assert.equal(average("leaf", empty), null);
  });
});
