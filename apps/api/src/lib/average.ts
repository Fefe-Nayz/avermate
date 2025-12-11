export type AverageGrade = {
  value: number;
  outOf: number;
  coefficient?: number | null;
};

export type AverageSubject = {
  id: string;
  parentId: string | null;
  coefficient?: number | null;
  isDisplaySubject: boolean;
  grades?: AverageGrade[];
};

/**
 * Computes an average on a /20 scale using the same subject-tree rules as the client:
 * - Uses subject coefficients (default 100 => 1.0)
 * - Uses grade coefficients (default 100 => 1.0)
 * - For a "global" average, display subjects act as containers; only non-display descendants are aggregated.
 */
export function computeAverage20(
  subjectId: string | undefined,
  subjects: AverageSubject[]
): number | null {
  if (!subjectId) {
    const rootSubjects = subjects.filter((s) => s.parentId === null);
    const otherSubjects = subjects.filter((s) => s.parentId !== null);

    const globalSubject: AverageSubject = {
      id: "GLOBAL_SUBJECT_ID",
      parentId: null,
      coefficient: 100,
      isDisplaySubject: true,
      grades: [],
    };

    const subjectsList: AverageSubject[] = [
      globalSubject,
      ...rootSubjects.map((s) => ({ ...s, parentId: globalSubject.id })),
      ...otherSubjects,
    ];

    return calculateAverageForSubject(globalSubject, subjectsList);
  }

  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return null;

  return calculateAverageForSubject(subject, subjects);
}

function calculateAverageForSubject(subject: AverageSubject, subjects: AverageSubject[]): number | null {
  let totalWeightedPercentages = 0;
  let totalCoefficients = 0;

  const subjectGrades = subject.grades ?? [];

  if (subjectGrades.length > 0) {
    for (const grade of subjectGrades) {
      const outOf = grade.outOf;
      if (!outOf) continue;

      const gradeCoefficient = (grade.coefficient ?? 100) / 100;
      const percentage = grade.value / outOf;

      totalWeightedPercentages += percentage * gradeCoefficient;
      totalCoefficients += gradeCoefficient;
    }
  }

  const descendants = getAllNonDisplaySubjects(subject, subjects).filter((s) => s.id !== subject.id);

  for (const child of descendants) {
    const childAverage = calculateAverageForSubject(child, subjects);
    if (childAverage !== null) {
      const childPercentage = childAverage / 20;
      const childCoefficient = (child.coefficient ?? 100) / 100;

      totalWeightedPercentages += childPercentage * childCoefficient;
      totalCoefficients += childCoefficient;
    }
  }

  if (totalCoefficients === 0) return null;

  const averagePercentage = totalWeightedPercentages / totalCoefficients;
  return averagePercentage * 20;
}

function getAllNonDisplaySubjects(subject: AverageSubject, subjects: AverageSubject[]): AverageSubject[] {
  const children = subjects.filter((s) => s.parentId === subject.id);
  let nonDisplayList: AverageSubject[] = [];

  if (!subject.isDisplaySubject) {
    nonDisplayList.push(subject);
  }

  for (const child of children) {
    if (child.isDisplaySubject) {
      nonDisplayList = nonDisplayList.concat(getAllNonDisplaySubjects(child, subjects));
    } else {
      nonDisplayList.push(child);
    }
  }

  return nonDisplayList;
}
