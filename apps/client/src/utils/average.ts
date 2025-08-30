import { Subject } from "@/types/subject";
import { Period } from "@/types/period";
import { startOfDay } from "date-fns";
import { Average } from "@/types/average";
import { Grade } from "@/types/grade";
import { Year } from "@/types/year";

/**
 * Calculates the average score for a specific subject or overall.
 *
 * @param subjectId - The ID of the subject to calculate the average for. If undefined, calculates the general average.
 * @param subjects - An array of all subjects.
 * @param customAverage - Optional custom average configuration.
 * @returns The calculated average as a number, or null if it cannot be determined.
 *
 * @details
 * This function serves as the primary entry point for calculating averages. It determines whether to use a custom average configuration
 * or to compute a general average based on the provided `subjectId`.
 *
 * - **Custom Average Calculation**: If a `customAverage` is provided, it delegates the computation to `calculateCustomAverage`, which processes
 *   the average based on specific configurations such as custom coefficients and inclusion of child subjects.
 *
 * - **General Average Calculation**:
 *   - **Overall Average**: If `subjectId` is undefined, it filters the subjects to include only root subjects (those without a parent) and computes
 *     the average across these subjects using `calculateAverageForSubjects`.
 *   - **Specific Subject Average**: If a `subjectId` is provided, it locates the corresponding subject and calculates its average using `calculateAverageForSubject`.
 *
 * If the specified subject is not found, the function returns `null`.
 */
export function average(
  subjectId: string | undefined,
  subjects: Subject[],
  customAverage?: Average
): number | null {
  if (customAverage) {
    return calculateCustomAverage(subjectId, subjects, customAverage);
  }

  if (!subjectId) {
    const rootSubjects = subjects.filter((s) => s.parentId === null);
    return calculateAverageForSubjects(rootSubjects, subjects);
  }

  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return null;

  return calculateAverageForSubject(subject, subjects);
}

/**
 * Calculates a custom average based on a provided configuration.
 *
 * @param subjectId - The ID of the subject to calculate the average for. If undefined, calculates the general average.
 * @param subjects - An array of all subjects.
 * @param customAverage - Custom average configuration.
 * @returns The calculated custom average as a number, or null if it cannot be determined.
 *
 * @details
 * This function processes averages based on a custom configuration provided through the `customAverage` parameter.
 * The custom configuration allows for specific subjects to have custom coefficients and to determine whether their child subjects
 * should be included in the average calculation.
 *
 * Steps:
 * 1. **Build Custom Configuration**: It constructs a `Map` from the `customAverage.subjects`, mapping each subject ID to its custom coefficient
 *    and inclusion flag.
 * 2. **Filter Included Subjects**: It filters the `subjects` array to include only those subjects that are part of the custom average,
 *    determined by the `isSubjectIncludedInCustomAverage` function.
 * 3. **Calculate Average**:
 *    - If `subjectId` is undefined, it calculates the average across all included subjects using `calculateAverageForSubjects`.
 *    - If a specific `subjectId` is provided, it ensures the target subject is included and calculates its average using `calculateAverageForSubject`.
 *
 * If no subjects are included after filtering, or if the target subject is not found within the included subjects, the function returns `null`.
 */
function calculateCustomAverage(
  subjectId: string | undefined,
  subjects: Subject[],
  customAverage: Average
): number | null {
  const customConfig = buildCustomConfig(customAverage);

  const includedSubjects = subjects.filter((subj) =>
    isSubjectIncludedInCustomAverage(subj, subjects, customConfig)
  );
  if (includedSubjects.length === 0) {
    return null;
  }

  if (!subjectId) {
    return calculateAverageForSubjects(includedSubjects, includedSubjects, customConfig, true);
  }

  const targetSubject = includedSubjects.find((s) => s.id === subjectId);
  if (!targetSubject) {
    return null;
  }

  return calculateAverageForSubject(targetSubject, includedSubjects, customConfig, true);
}

/**
 * Determines if a subject is included in a custom average configuration.
 *
 * @param subject - The subject to check.
 * @param allSubjects - An array of all subjects.
 * @param customConfig - Custom average configuration map.
 * @returns True if the subject is included, otherwise false.
 *
 * @details
 * This function checks whether a given `subject` should be included in the custom average calculation based on the `customConfig`.
 *
 * Inclusion Criteria:
 * 1. **Explicit Inclusion**: If the subject's ID is directly present in the `customConfig`, it is included.
 * 2. **Inherited Inclusion**: If any ancestor of the subject is included in the `customConfig` with the `includeChildren` flag set to `true`,
 *    the subject is also included.
 *
 * The function traverses up the subject hierarchy by following the `parentId` links until it either finds an ancestor that includes the subject
 * or reaches the root without finding such an ancestor.
 */
export function isSubjectIncludedInCustomAverage(
  subject: Subject,
  allSubjects: Subject[],
  customConfig: Map<string, { customCoefficient: number | null; includeChildren: boolean }>
): boolean {
  if (customConfig.has(subject.id)) {
    return true;
  }

  let current = subject;
  while (current.parentId) {
    if (customConfig.has(current.parentId)) {
      const parentCfg = customConfig.get(current.parentId);
      if (parentCfg && parentCfg.includeChildren) {
        return true;
      }
    }
    const parent = allSubjects.find((s) => s.id === current.parentId);
    if (!parent) break;
    current = parent;
  }

  return false;
}

/**
 * Calculates the average for a single subject, optionally considering custom configurations.
 *
 * @param subject - The subject to calculate the average for.
 * @param subjects - An array of all subjects.
 * @param customConfig - Optional custom average configuration map.
 * @param isCustom - Indicates if a custom average is being calculated.
 * @returns The calculated average as a number, or null if it cannot be determined.
 *
 * @details
 * This function computes the average score for a specific `subject`. It takes into account the subject's own grades as well as the grades
 * of its descendant subjects, based on whether a custom configuration is applied.
 *
 * Calculation Steps:
 * 1. **Initialize Totals**: Initializes variables to accumulate weighted percentages and coefficients.
 * 2. **Process Subject's Grades**:
 *    - Iterates over the subject's grades.
 *    - For each grade, calculates the percentage score (`grade.value / grade.outOf`) and applies the grade's coefficient.
 *    - Accumulates the weighted percentage and the coefficient.
 * 3. **Retrieve Descendant Subjects**:
 *    - If `isCustom` is `true`, it retrieves all included descendant subjects based on the `customConfig`.
 *    - Otherwise, it retrieves all non-display descendant subjects.
 * 4. **Process Descendant Grades**:
 *    - For each descendant subject, recursively calculates its average.
 *    - Applies any custom coefficients if specified in the `customConfig`.
 *    - Accumulates the weighted percentage and the coefficient.
 * 5. **Compute Final Average**:
 *    - If the total coefficients are zero, returns `null` to indicate that an average cannot be computed.
 *    - Otherwise, calculates the average percentage and scales it appropriately.
 *
 * The function ensures that subjects are not double-counted and that only relevant grades are included in the calculation.
 */
function calculateAverageForSubject(
  subject: Subject,
  subjects: Subject[],
  customConfig?: Map<string, { customCoefficient: number | null; includeChildren: boolean }>,
  isCustom = false
): number | null {
  let totalWeightedPercentages = 0;
  let totalCoefficients = 0;

  if (subject.grades && subject.grades.length > 0) {
    for (const grade of subject.grades) {
      const gradeValue = grade.value / 100;
      const outOf = grade.outOf / 100;
      const gradeCoefficient = (grade.coefficient ?? 100) / 100;
      if (outOf === 0) continue;

      const percentage = gradeValue / outOf;
      totalWeightedPercentages += percentage * gradeCoefficient;
      totalCoefficients += gradeCoefficient;
    }
  }

  let descendants: Subject[];
  if (isCustom && customConfig) {
    descendants = getAllIncludedDescendants(subject, subjects, customConfig);
    descendants = descendants.filter((s) => s.id !== subject.id);
  } else {
    const allNonDisplaySubjects = getAllNonDisplaySubjects(subject, subjects);
    descendants = allNonDisplaySubjects.filter((s) => s.id !== subject.id);
  }

  for (const child of descendants) {
    const childAverage = calculateAverageForSubject(child, subjects, customConfig, isCustom);
    if (childAverage !== null) {
      const childPercentage = childAverage / 20;
      let childCoefficient = (child.coefficient ?? 100) / 100;

      if (customConfig && customConfig.has(child.id)) {
        const cc = customConfig.get(child.id)!;
        if (cc.customCoefficient !== null) {
          childCoefficient = cc.customCoefficient;
        }
      }

      totalWeightedPercentages += childPercentage * childCoefficient;
      totalCoefficients += childCoefficient;
    }
  }

  if (totalCoefficients === 0) return null;

  const averagePercentage = totalWeightedPercentages / totalCoefficients;
  return averagePercentage * 20;
}

/**
 * Calculates the average for multiple subjects, optionally considering custom configurations.
 *
 * @param subjects - The subjects to calculate the average for.
 * @param allSubjects - An array of all subjects.
 * @param customConfig - Optional custom average configuration map.
 * @param isCustom - Indicates if a custom average is being calculated.
 * @returns The calculated average as a number, or null if it cannot be determined.
 *
 * @details
 * This function computes the overall average for a group of `subjects`. It aggregates the averages of individual subjects,
 * taking into account any custom configurations that may affect the calculation.
 *
 * Calculation Steps:
 * 1. **Initialize Totals**: Initializes variables to accumulate weighted percentages and coefficients.
 * 2. **Iterate Over Each Subject**:
 *    - For each subject, determines the relevant subjects to consider based on whether a custom configuration is applied.
 *    - Retrieves included or non-display descendant subjects as necessary.
 * 3. **Process Each Considered Subject**:
 *    - Calculates the average for each considered subject using `calculateAverageForSubject`.
 *    - Applies any custom coefficients from the `customConfig`.
 *    - Accumulates the weighted percentage and the coefficient.
 * 4. **Compute Final Average**:
 *    - If the total coefficients are zero, returns `null`.
 *    - Otherwise, calculates the average percentage and scales it appropriately.
 *
 * This function ensures that all relevant subjects are included in the average calculation without double-counting.
 */
function calculateAverageForSubjects(
  subjects: Subject[],
  allSubjects: Subject[],
  customConfig?: Map<string, { customCoefficient: number | null; includeChildren: boolean }>,
  isCustom = false
): number | null {
  let totalWeightedPercentages = 0;
  let totalCoefficients = 0;

  for (const subject of subjects) {
    let consideredSubjects: Subject[];
    if (isCustom && customConfig) {
      consideredSubjects = getAllIncludedDescendants(subject, allSubjects, customConfig);
    } else {
      consideredSubjects = getAllNonDisplaySubjects(subject, allSubjects);
    }

    for (const nonDisplaySubject of consideredSubjects) {
      const subjectAverage = calculateAverageForSubject(nonDisplaySubject, allSubjects, customConfig, isCustom);
      if (subjectAverage !== null) {
        const subjectPercentage = subjectAverage / 20;
        let subjectCoefficient = (nonDisplaySubject.coefficient ?? 100) / 100;
        if (customConfig && customConfig.has(nonDisplaySubject.id)) {
          const cc = customConfig.get(nonDisplaySubject.id)!;
          if (cc.customCoefficient !== null) {
            subjectCoefficient = cc.customCoefficient;
          }
        }
        totalWeightedPercentages += subjectPercentage * subjectCoefficient;
        totalCoefficients += subjectCoefficient;
      }
    }
  }

  if (totalCoefficients === 0) return null;

  const averagePercentage = totalWeightedPercentages / totalCoefficients;
  return averagePercentage * 20;
}

/**
 * Retrieves all non-display subjects under a given subject.
 *
 * @param subject - The parent subject.
 * @param subjects - An array of all subjects.
 * @returns An array of non-display subjects.
 *
 * @details
 * This function collects all subjects that are marked as non-display (`isDisplaySubject` is `false`) within the hierarchy
 * of the given `subject`. It traverses the subject tree recursively, ensuring that only relevant subjects are included.
 *
 * Steps:
 * 1. **Check Current Subject**: If the current `subject` is not a display subject, it is added to the `nonDisplayList`.
 * 2. **Traverse Children**:
 *    - For each child of the current subject, the function checks if it is a display subject.
 *    - If it is a display subject, the function recursively collects its non-display descendants.
 *    - If it is not a display subject, it is directly added to the `nonDisplayList`.
 *
 * The result is a flattened array of all non-display subjects within the subtree rooted at the specified `subject`.
 */
function getAllNonDisplaySubjects(subject: Subject, subjects: Subject[]): Subject[] {
  const children = subjects.filter((s) => s.parentId === subject.id);
  let nonDisplayList: Subject[] = [];

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

/**
 * Retrieves all included descendants for a subject based on custom configurations.
 *
 * @param subject - The parent subject.
 * @param allSubjects - An array of all subjects.
 * @param customConfig - Custom average configuration map.
 * @returns An array of included descendant subjects.
 *
 * @details
 * This function gathers all descendant subjects of a given `subject` that are included in the custom average configuration.
 * Inclusion is determined by whether the subject itself is included or if it inherits inclusion from an ancestor with `includeChildren` set to `true`.
 *
 * Steps:
 * 1. **Check Current Subject**: If the current `subject` is included in the custom average, it is added to the `included` array.
 * 2. **Traverse Children**:
 *    - For each child of the current subject, the function checks if it is included based on the custom configuration.
 *    - If included, the function recursively collects its included descendants and adds them to the `included` array.
 *
 * The result is a comprehensive list of all subjects within the subtree that meet the inclusion criteria defined by the custom configuration.
 */
function getAllIncludedDescendants(
  subject: Subject,
  allSubjects: Subject[],
  customConfig: Map<string, { customCoefficient: number | null; includeChildren: boolean }>
): Subject[] {
  const included: Subject[] = [];

  if (isSubjectIncludedInCustomAverage(subject, allSubjects, customConfig)) {
    included.push(subject);
  }

  const children = allSubjects.filter((s) => s.parentId === subject.id);
  for (const child of children) {
    if (isSubjectIncludedInCustomAverage(child, allSubjects, customConfig)) {
      included.push(...getAllIncludedDescendants(child, allSubjects, customConfig));
    }
  }

  return included;
}

/**
 * Computes the impact of a specific grade on the average.
 *
 * @param gradeId - The ID of the grade to assess.
 * @param subjectId - The ID of the subject to calculate the impact for. If undefined, calculates for the general average.
 * @param subjects - An array of all subjects.
 * @param customAverage - Optional custom average configuration.
 * @returns An object containing the difference and percentage change, or null if not applicable.
 *
 * @details
 * This function evaluates how a particular grade affects the overall average by comparing the average with and without the grade.
 *
 * Calculation Steps:
 * 1. **Clone Subjects**: Creates a deep copy of the `subjects` array to avoid mutating the original data.
 * 2. **Locate Grade**: Searches for the grade with the specified `gradeId` within the cloned subjects.
 * 3. **Calculate Average With Grade**: Computes the average including the grade using the `average` function.
 * 4. **Remove Grade**: Eliminates the grade from its respective subject in the cloned data.
 * 5. **Calculate Average Without Grade**: Computes the average after removing the grade.
 * 6. **Determine Impact**:
 *    - Calculates the difference between the averages.
 *    - Computes the percentage change relative to the average without the grade.
 *
 * If the grade is not found or the averages cannot be determined, the function returns `null`.
 */
export function gradeImpact(
  gradeId: string,
  subjectId: string | undefined,
  subjects: Subject[],
  customAverage?: Average
): { difference: number; percentageChange: number | null } | null {
  const subjectsCopy = deepCloneSubjects(subjects);

  let gradeSubject: Subject | null = null;
  let gradeIndex = -1;

  for (const subj of subjectsCopy) {
    const idx = subj.grades.findIndex((g) => g.id === gradeId);
    if (idx !== -1) {
      gradeSubject = subj;
      gradeIndex = idx;
      break;
    }
  }

  if (!gradeSubject || gradeIndex === -1) {
    return null;
  }

  const avgWithGrade = average(subjectId, subjectsCopy, customAverage);

  gradeSubject.grades.splice(gradeIndex, 1);

  const avgWithoutGrade = average(subjectId, subjectsCopy, customAverage);

  if (avgWithGrade !== null && avgWithoutGrade !== null) {
    const difference = avgWithGrade - avgWithoutGrade;
    let percentageChange: number | null = null;
    if (avgWithoutGrade !== 0) {
      percentageChange = (difference / avgWithoutGrade) * 100;
    }
    return { difference, percentageChange };
  }
  return null;
}

/**
 * Determines if a specific grade is included in a custom average configuration.
 *
 * @param grade - The grade to check.
 * @param allSubjects - An array of all subjects.
 * @param customAvg - Custom average configuration.
 * @returns True if the grade is included, otherwise false.
 *
 * @details
 * This function assesses whether a given `grade` should be considered in a custom average calculation. It checks if the grade's
 * subject is directly included in the custom configuration or inherits inclusion from an ancestor with `includeChildren` set to `true`.
 *
 * Steps:
 * 1. **Build Configuration Map**: Constructs a `Map` from the `customAvg` to easily reference custom coefficients and inclusion flags.
 * 2. **Locate Subject**: Finds the subject associated with the grade using `grade.subjectId`.
 * 3. **Check Direct Inclusion**: If the subject is directly present in the configuration map, the grade is included.
 * 4. **Check Ancestors**:
 *    - Traverses up the subject hierarchy to see if any ancestor is included with `includeChildren` enabled.
 *    - If such an ancestor is found, the grade is included.
 *
 * If the subject is not found or does not meet any inclusion criteria, the grade is excluded.
 */
export function isGradeIncludedInCustomAverage(
  grade: Grade,
  allSubjects: Subject[],
  customAvg: Average
): boolean {
  const configMap = buildCustomConfig(customAvg);

  const subject = allSubjects.find((subj) => subj.id === grade.subjectId);
  if (!subject) {
    return false;
  }

  if (configMap.has(subject.id)) {
    return true;
  }

  let current = subject;
  while (current.parentId) {
    if (configMap.has(current.parentId)) {
      const parentCfg = configMap.get(current.parentId);
      if (parentCfg && parentCfg.includeChildren) {
        return true;
      }
    }
    current = allSubjects.find((s) => s.id === current.parentId) || current;
    if (!current) break;
  }

  return false;
}

/**
 * Builds a custom configuration map from a custom average configuration.
 *
 * @param customAverage - Custom average configuration.
 * @returns A map with subject IDs as keys and their custom configurations as values.
 *
 * @details
 * This utility function transforms a `customAverage` object into a `Map` for efficient lookup during average calculations.
 * Each entry in the map associates a subject ID with its corresponding custom coefficient and inclusion flag.
 *
 * This structure facilitates quick access to custom configurations when determining how each subject should be treated
 * in average computations.
 */
export function buildCustomConfig(
  customAverage: Average
): Map<string, { customCoefficient: number | null; includeChildren: boolean }> {
  const cfg = new Map<string, { customCoefficient: number | null; includeChildren: boolean }>();
  for (const s of customAverage.subjects) {
    cfg.set(s.id, {
      customCoefficient: s.customCoefficient ?? null,
      includeChildren: s.includeChildren ?? true,
    });
  }
  return cfg;
}

/**
 * Retrieves all children (including descendants) of a specific subject.
 *
 * @param subjects - An array of all subjects.
 * @param subjectId - The ID of the parent subject.
 * @returns An array of child subject IDs.
 *
 * @details
 * This recursive function collects all descendant subject IDs under a given `subjectId`. It starts by identifying direct children
 * and then recursively collects the children of each child, ensuring that all levels of the hierarchy are traversed.
 *
 * The result is a flat array containing the IDs of all subjects that are descendants of the specified parent subject.
 */
export function getChildren(subjects: Subject[], subjectId: string): string[] {
  const directChildren = subjects.filter((s) => s.parentId === subjectId);
  let childrenIds = directChildren.map((child) => child.id);

  for (const child of directChildren) {
    childrenIds = childrenIds.concat(getChildren(subjects, child.id));
  }

  return childrenIds;
}

/**
 * Retrieves all parent subjects (ancestors) of a specific subject.
 *
 * @param subjects - An array of all subjects.
 * @param subjectId - The ID of the subject.
 * @returns An array of parent subject IDs.
 *
 * @details
 * This function traverses the subject hierarchy upwards from a given `subjectId`, collecting the IDs of all ancestor subjects.
 * It continues to follow the `parentId` links until it reaches a root subject (one without a parent).
 *
 * The resulting array contains the IDs of all ancestor subjects, ordered from immediate parent upwards to the root.
 */
export function getParents(subjects: Subject[], subjectId: string): string[] {
  const parents: string[] = [];
  let currentSubject = subjects.find((s) => s.id === subjectId);

  while (currentSubject && currentSubject.parentId !== null) {
    parents.push(currentSubject.parentId);
    currentSubject = subjects.find((s) => s.id === currentSubject?.parentId);
  }

  return parents;
}

/**
 * Deep clones an array of subjects to prevent mutation of original data.
 *
 * @param subjects - The array of subjects to clone.
 * @returns A deep-cloned array of subjects.
 *
 * @details
 * This utility function creates a deep copy of the provided `subjects` array, including deep copies of each subject's grades.
 * Cloning ensures that any modifications made to the cloned data do not affect the original subjects array, preserving data integrity.
 */
function deepCloneSubjects(subjects: Subject[]): Subject[] {
  return subjects.map((subject) => ({
    ...subject,
    grades: subject.grades.map((grade) => ({ ...grade })),
  }));
}

/**
 * Calculates the impact of a subject on the average.
 *
 * @param impactingSubjectIds - The ID of the subject to assess the impact of.
 * @param impactedSubjectId - The ID of the subject whose average is being impacted. If undefined, impacts the general average.
 * @param subjects - An array of all subjects.
 * @param customAverage - Optional custom average configuration.
 * @returns An object containing the difference and percentage change, or null if not applicable.
 *
 * @details
 * This function evaluates how removing a specific subject (and its descendants) affects the overall average score.
 *
 * Calculation Steps:
 * 1. **Clone Subjects**: Creates a deep copy of the `subjects` array to avoid mutating the original data.
 * 2. **Identify Subjects to Exclude**: Determines all subjects that need to be excluded from the average calculation, including the `impactingSubjectId` and all its descendants.
 * 3. **Calculate Average With Subject**: Computes the average including all subjects.
 * 4. **Remove Impacting Subjects**: Filters out the impacting subjects from the cloned data.
 * 5. **Calculate Average Without Subject**: Computes the average after excluding the impacting subjects.
 * 6. **Determine Impact**:
 *    - Calculates the difference between the averages.
 *    - Computes the percentage change relative to the average without the subject.
 *
 * If the impacting subject is not found or the averages cannot be determined, the function returns `null`.
 */
export function subjectImpact(
  impactingSubjectIds: string | string[],
  impactedSubjectId: string | undefined,
  subjects: Subject[],
  customAverage?: Average
): { difference: number; percentageChange: number | null } | null {
  const subjectsCopy = deepCloneSubjects(subjects);

  // Handle both single string and array of strings
  const impactingIds = Array.isArray(impactingSubjectIds)
    ? impactingSubjectIds
    : [impactingSubjectIds];

  // Get all impacting IDs including children
  const allImpactingIds = impactingIds.flatMap(id =>
    [id, ...getChildren(subjectsCopy, id)]
  );

  const avgWithSubject = average(impactedSubjectId, subjectsCopy, customAverage);
  const subjectsWithoutImpacting = subjectsCopy.filter(
    (s) => !allImpactingIds.includes(s.id)
  );
  const avgWithoutSubject = average(impactedSubjectId, subjectsWithoutImpacting, customAverage);

  if (avgWithSubject !== null && avgWithoutSubject !== null) {
    const difference = avgWithSubject - avgWithoutSubject;
    let percentageChange: number | null = null;
    if (avgWithoutSubject !== 0) {
      percentageChange = (difference / avgWithoutSubject) * 100;
    }
    return { difference, percentageChange };
  }
  return null;
}

/**
 * Calculates the trend (slope) of average scores over time.
 *
 * @param data - An array of objects containing dates and their corresponding averages.
 * @returns The slope of the trend as a number.
 *
 * @details
 * This function performs a linear regression to determine the trend of average scores over time.
 * The trend is represented by the slope of the best-fit line through the data points.
 *
 * Calculation Steps:
 * 1. **Filter Valid Data**: Excludes any data entries where the average is `null`.
 * 2. **Check Data Availability**: If there are no valid data points, returns a slope of `0`.
 * 3. **Normalize Dates**: Converts dates to a numerical format (days since the first date) to use as the independent variable.
 * 4. **Compute Sums**:
 *    - `sumX`: Sum of all normalized date values.
 *    - `sumY`: Sum of all average values.
 *    - `sumXY`: Sum of the product of each normalized date and its corresponding average.
 *    - `sumX2`: Sum of the squares of the normalized date values.
 * 5. **Calculate Slope**: Uses the formula for the slope of the best-fit line:
 *    \[
 *    \text{slope} = \frac{n \times \text{sumXY} - \text{sumX} \times \text{sumY}}{n \times \text{sumX2} - (\text{sumX})^2}
 *    \]
 *    If the denominator is `0`, indicating no variation in the independent variable, the function returns a slope of `0`.
 *
 * The resulting slope indicates the direction and steepness of the trend:
 * - Positive slope: Increasing trend.
 * - Negative slope: Decreasing trend.
 * - Zero slope: No trend.
 */
export function getTrend(
  data: { date: Date; average: number | null }[]
): number {
  const filteredData = data.filter((entry) => entry.average !== null) as {
    date: Date;
    average: number;
  }[];

  const n = filteredData.length;
  if (n === 0) {
    return 0;
  }

  const firstTimestamp = filteredData[0].date.getTime();
  const xValues = filteredData.map(
    (entry) => (entry.date.getTime() - firstTimestamp) / (1000 * 3600 * 24)
  ); // Convert to days
  const yValues = filteredData.map((entry) => entry.average);

  const sumX = xValues.reduce((acc, x) => acc + x, 0);
  const sumY = yValues.reduce((acc, y) => acc + y, 0);
  const sumXY = xValues.reduce((acc, x, i) => acc + x * yValues[i], 0);
  const sumX2 = xValues.reduce((acc, x) => acc + x ** 2, 0);

  const numerator = n * sumXY - sumX * sumY;
  const denominator = n * sumX2 - sumX ** 2;

  if (denominator === 0) {
    return 0;
  }

  const slope = numerator / denominator;

  return slope;
}

/**
 * Creates an array of dates from a start date to an end date with a specified interval.
 *
 * @param start - The start date.
 * @param end - The end date.
 * @param interval - The number of days between each date in the array.
 * @returns An array of Date objects.
 *
 * @details
 * This utility function generates a sequence of dates starting from the `start` date up to and including the `end` date.
 * The `interval` parameter specifies the number of days between each consecutive date in the array.
 *
 * Steps:
 * 1. **Initialize**: Starts with the `currentDate` set to the `start` date.
 * 2. **Iterate**: Continues to add `currentDate` to the `dates` array and increments it by the specified `interval` until it surpasses the `end` date.
 *
 * This function is useful for creating time-based ranges for trend analysis or averaging over specific periods.
 */
export function createDateRange(
  start: Date,
  end: Date,
  interval: number
): Date[] {
  const dates: Date[] = [];
  const currentDate = new Date(start);

  while (currentDate <= end) {
    dates.push(new Date(currentDate));
    currentDate.setDate(currentDate.getDate() + interval);
  }

  return dates;
}

/**
 * Calculates the trend of a subject's average score over a specified period.
 *
 * @param subjects - An array of all subjects.
 * @param subjectId - The ID of the subject to analyze.
 * @param period - The time period to consider.
 * @returns The trend slope as a number, or null if no data is available.
 *
 * @details
 * This function determines the trend of a specific subject's average scores over time within a given period.
 * It leverages the `averageOverTime` function to obtain average scores across the specified dates and then applies
 * the `getTrend` function to compute the slope of these averages.
 *
 * Steps:
 * 1. **Calculate Averages Over Time**: Retrieves an array of average scores corresponding to each date within the period.
 * 2. **Check for Data Availability**: If all averages are `null`, the function returns `null`.
 * 3. **Generate Date Range**: Creates a sequence of dates covering the entire period.
 * 4. **Prepare Data for Trend Calculation**: Maps each average to its corresponding date.
 * 5. **Compute Trend**: Calculates the slope of the average scores over time using linear regression.
 *
 * The resulting slope indicates whether the subject's performance is improving, declining, or stable over the specified period.
 */
export function getSubjectTrend(
  subjects: Subject[],
  subjectId: string,
  period: Period,
  periods: Period[]
): number | null {
  const averages = averageOverTime(subjects, subjectId, period, periods);

  if (averages.every((avg) => avg === null)) {
    return null;
  }

  const startDate = new Date(period.startAt);
  const endDate = new Date(period.endAt);
  const dates = createDateRange(startDate, endDate, 1);

  const data = averages.map((avg, index) => ({
    date: dates[index],
    average: avg,
  }));

  const trend = getTrend(data);

  return trend;
}

/**
 * Retrieves the average scores of subjects over a specified time period.
 *
 * @param subjects - An array of all subjects.
 * @param subjectId - The ID of the subject to calculate the average for. If undefined, calculates for all subjects.
 * @param period - The time period to consider.
 * @returns An array of averages corresponding to each date in the period.
 *
 * @details
 * This function computes the average scores of subjects within a specified time frame. It considers grades that fall within the period
 * and calculates averages incrementally over time.
 *
 * Calculation Steps:
 * 1. **Determine Period Bounds**: Uses `findPeriodBounds` to establish the start and end dates based on the provided `period`.
 * 2. **Normalize Dates**: Ensures that the start and end dates are set to the beginning of their respective days.
 * 3. **Generate Date Range**: Creates a list of dates spanning from the start to the end of the period.
 * 4. **Filter Relevant Grades**:
 *    - If a `subjectId` is provided, it includes grades from that subject and its descendants.
 *    - Otherwise, it includes grades from all subjects.
 *    - Filters grades based on whether they fall within the specified period unless the period is "full-year".
 * 5. **Adjust Grade Dates**: Normalizes grade dates to ensure they fall within the period bounds.
 * 6. **Ensure Unique Grade Dates**: Removes duplicate dates to optimize processing.
 * 7. **Calculate Averages for Each Date**:
 *    - For each date in the range, it adjusts the subjects' grades up to that date.
 *    - Computes the average using the `average` function.
 *    - Returns `null` for dates without relevant grade updates.
 *
 * The resulting array provides a time series of average scores, which can be used for trend analysis or visualizations.
 */
/**
 * Retrieves the average scores of subjects over a specified time period.
 *
 * @param subjects - An array of all subjects.
 * @param subjectId - The ID of the subject to calculate the average for. If undefined, calculates for all subjects.
 * @param period - The single period to consider (may have isCumulative).
 * @param periods - All periods (needed to figure out "previous" ones if cumulative).
 * @returns An array of averages corresponding to each date in the period.
 *
 * @details
 * This function computes the average scores of subjects within a specified time frame. It considers grades that fall within
 * the relevant period IDs and calculates averages incrementally over time. For a cumulative period, it includes the
 * current period plus all prior periods in chronological order, from their earliest grade to this period's end.
 *
 * Calculation Steps:
 * 1. Determine which period IDs to include:
 *    - If "full-year", include *all* grades, ignoring period IDs.
 *    - Else if isCumulative, gather all period IDs from the first user period up to the current one.
 *    - Otherwise, just the current period ID.
 * 2. Determine the start date:
 *    - If "full-year", use period's `startAt` (or your existing `findPeriodBounds` logic).
 *    - If isCumulative, use the earliest `startAt` among included periods.
 *    - Otherwise, just use the current period's `startAt`.
 * 3. Set the end date to the current period's `endAt` (unless "full-year").
 * 4. Generate the daily date range between [start, end].
 * 5. Filter subjects and grades to keep only:
 *    - The selected subjects (subjectId + children, or all if none given).
 *    - The relevant period IDs (or all if "full-year").
 *    - Then clamp each grade date and gather "event" dates.
 * 6. For each date in the range, compute or return `null` if there is no event (but always compute on the last date).
 * 7. Return the array of incremental averages.
 */

export function averageOverTime(
  subjects: Subject[],
  subjectId: string | undefined,
  period: Period,
  periods: Period[]
): (number | null)[] {
  const isFullYear = period.id === "full-year";
  const isCumulative = !!period.isCumulative;

  // Sort all periods by start date
  const sortedPeriods = [...periods].sort(
    (a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime()
  );

  // Find the index of our current period
  const currentIndex = sortedPeriods.findIndex((p) => p.id === period.id);

  // Build a list of relevant period IDs
  let relevantPeriodIds: string[] = [];
  if (isFullYear) {
    // "full-year" => We'll ignore period IDs below
  } else if (isCumulative && currentIndex !== -1) {
    // Gather all period IDs from the first up to currentIndex
    relevantPeriodIds = sortedPeriods.slice(0, currentIndex + 1).map((p) => p.id);
  } else {
    // Non-cumulative => just the current one
    relevantPeriodIds = [period.id];
  }

  // Determine the earliest start date for cumulative
  // or just the current period's start date if not cumulative
  let earliestStart = new Date(period.startAt);
  if (isCumulative && currentIndex !== -1) {
    earliestStart = new Date(sortedPeriods[0].startAt);
  }

  // Now we have the final start/end to pass to findPeriodBounds, or we do manual clamping
  // If you have logic in findPeriodBounds, you can adapt. We'll do a simplified approach:

  // Force the start/end from the earliest relevant or from the period itself
  const normalizedStartDate = startOfDay(
    isFullYear ? new Date(period.startAt) : earliestStart
  );
  const normalizedEndDate = startOfDay(new Date(period.endAt));

  // Create the day-by-day date range
  const dates = createDateRange(normalizedStartDate, normalizedEndDate, 1);

  // 1) Filter the subjects to only the target subject & its descendants (if subjectId provided)
  const filteredSubjects = subjects.filter(
    (subj) =>
      !subjectId ||
      subj.id === subjectId ||
      getChildren(subjects, subjectId).includes(subj.id)
  );

  // 2) Flatten out all their grades but keep only the relevant ones
  //    - If "full-year", no periodId filtering
  //    - Otherwise, keep grade.periodId in relevantPeriodIds
  const relevantGrades = filteredSubjects.flatMap((subj) =>
    subj.grades.filter((grade) => {
      if (isFullYear) return true; // Keep all
      return relevantPeriodIds.includes(grade.periodId ?? "");
    })
  );

  // 3) "Clamp" each grade date to [start, end] to build event dates
  const clampedGradeDates = relevantGrades.map((g) => {
    const gDate = new Date(g.passedAt);
    if (gDate < normalizedStartDate) return normalizedStartDate;
    if (gDate > normalizedEndDate) return normalizedEndDate;
    return gDate;
  });

  // 4) Identify unique event dates
  const uniqueGradeDates = Array.from(
    new Set(clampedGradeDates.map((d) => d.getTime()))
  ).map((time) => new Date(time));

  // 5) For each date in [start, end], either compute an average or return null
  return dates.map((date, index) => {
    // We do want a final data point on the last day, so check index == dates.length - 1
    const isRelevantDate =
      uniqueGradeDates.some((gd) => gd.getTime() === date.getTime()) ||
      index === dates.length - 1;

    if (!isRelevantDate) {
      return null;
    }

    // Now we build a version of each subject that only includes grades up to `date`
    const subjectsWithAdjustedGrades = filteredSubjects.map((subj) => {
      // Keep only relevant grades
      const subjRelevantGrades = subj.grades.filter((grade) => {
        if (isFullYear) return true;
        return relevantPeriodIds.includes(grade.periodId ?? "");
      });

      // Clamp each grade date & keep only those <= current date
      const clamped = subjRelevantGrades
        .map((grade) => {
          const originalDate = new Date(grade.passedAt);
          let adjustedDate = originalDate;
          if (originalDate < normalizedStartDate) {
            adjustedDate = normalizedStartDate;
          } else if (originalDate > normalizedEndDate) {
            adjustedDate = normalizedEndDate;
          }
          return {
            ...grade,
            passedAt: adjustedDate.toISOString(),
          };
        })
        .filter((clampedGrade) => new Date(clampedGrade.passedAt) <= date);

      return { ...subj, grades: clamped };
    });

    // Compute the average (use your existing `average(subjectId, subjectsWithAdjustedGrades)`)
    return average(subjectId, subjectsWithAdjustedGrades);
  });
}


/**
 * Retrieves the average scores for each subject.
 *
 * @param subjects - An array of all subjects.
 * @returns An array of objects containing subject IDs, their averages, and a flag indicating if they are main subjects.
 *
 * @details
 * This function iterates through each subject and calculates its average score using `calculateAverageForSubject`.
 * It compiles a list of subjects along with their corresponding averages and a boolean flag indicating if they are main subjects.
 *
 * Steps:
 * 1. **Map Subjects to Averages**: For each subject, computes its average score.
 * 2. **Filter Out Null Averages**: Excludes subjects for which an average could not be determined (`null`).
 * 3. **Return Structured Data**: Provides an array of objects containing the subject ID, its average, and its main subject status.
 *
 * This function is useful for generating summaries or leaderboards based on subject performance.
 */
export function getSubjectAverages(
  subjects: Subject[]
): { id: string; average: number; isMainSubject: boolean }[] {
  return subjects
    .map((subject) => {
      const averageValue = calculateAverageForSubject(subject, subjects);
      return averageValue !== null
        ? {
          id: subject.id,
          average: averageValue,
          isMainSubject: subject.isMainSubject ?? false,
        }
        : null;
    })
    .filter(
      (
        entry
      ): entry is { id: string; average: number; isMainSubject: boolean } =>
        entry != null
    );
}

/**
 * Compares a subject's average with other subjects or a specified group.
 *
 * @param subjects - An array of all subjects.
 * @param subjectIdToCompare - The ID of the subject to compare.
 * @param isMainSubject - If true, compares with all main subjects.
 * @param subjectsId - An array of subject IDs to compare with.
 * @returns An object containing the difference and percentage change, or null if not applicable.
 *
 * @details
 * This function assesses how a specific subject's average compares to others. The comparison can be against:
 * - A specified list of subjects (`subjectsId`).
 * - All main subjects (`isMainSubject`).
 * - All other subjects by default.
 *
 * Comparison Process:
 * 1. **Input Validation**: Ensures that both `isMainSubject` and `subjectsId` are not specified simultaneously.
 * 2. **Retrieve Subject Average**: Calculates the average for the subject identified by `subjectIdToCompare`.
 * 3. **Determine Comparison Group**:
 *    - If `subjectsId` is provided, it uses the averages of these specific subjects.
 *    - If `isMainSubject` is `true`, it uses the averages of all main subjects excluding the subject being compared.
 *    - Otherwise, it compares against the averages of all other subjects.
 * 4. **Calculate Comparison Average**: Computes the average of the comparison group.
 * 5. **Determine Difference and Percentage Change**:
 *    - Calculates the difference between the subject's average and the comparison average.
 *    - Computes the percentage change relative to the comparison average.
 *
 * If the subject's average or the comparison average cannot be determined, the function returns `null`.
 */
export function getSubjectAverageComparison(
  subjects: Subject[],
  subjectIdToCompare: string,
  isMainSubject?: boolean,
  subjectsId?: string[]
): { difference: number; percentageChange: number | null } | null {
  if (isMainSubject && subjectsId && subjectsId.length > 0) {
    throw new Error("Cannot specify both isMainSubject and subjectsId");
  }

  const subjectAverage = average(subjectIdToCompare, subjects);

  if (subjectAverage === null) {
    return null;
  }

  let comparisonAverage: number | null = null;

  if (subjectsId && subjectsId.length > 0) {
    const averages = subjectsId
      .filter((id) => id !== subjectIdToCompare)
      .map((id) => average(id, subjects))
      .filter((avg): avg is number => avg !== null);

    if (averages.length === 0) {
      return null;
    }

    comparisonAverage =
      averages.reduce((acc, avg) => acc + avg, 0) / averages.length;
  } else if (isMainSubject) {
    const mainSubjects = subjects.filter(
      (s) => s.isMainSubject && s.id !== subjectIdToCompare
    );
    const averages = mainSubjects
      .map((s) => average(s.id, subjects))
      .filter((avg): avg is number => avg !== null);

    if (averages.length === 0) {
      return null;
    }

    comparisonAverage =
      averages.reduce((acc, avg) => acc + avg, 0) / averages.length;
  } else {
    const otherSubjects = subjects.filter((s) => s.id !== subjectIdToCompare);
    const averages = otherSubjects
      .map((s) => average(s.id, subjects))
      .filter((avg): avg is number => avg !== null);

    if (averages.length === 0) {
      return null;
    }

    comparisonAverage =
      averages.reduce((acc, avg) => acc + avg, 0) / averages.length;
  }

  const difference = subjectAverage - comparisonAverage;

  let percentageChange: number | null = null;
  if (comparisonAverage !== 0) {
    percentageChange = (difference / comparisonAverage) * 100;
  }

  return { difference, percentageChange };
}

/**
 * Retrieves the subject with the highest average score.
 *
 * @param subjects - An array of all subjects.
 * @param isMainSubject - If true, considers only main subjects.
 * @returns The subject with the best average, or null if none found.
 *
 * @details
 * This function identifies the subject that has achieved the highest average score. In cases where multiple subjects share the highest average,
 * it selects the one with the highest coefficient to break the tie.
 *
 * Selection Process:
 * 1. **Retrieve Subject Averages**: Obtains the average scores for all subjects using `getSubjectAverages`.
 * 2. **Filter Main Subjects**: If `isMainSubject` is `true`, it filters the averages to include only main subjects.
 * 3. **Determine Best Average**: Identifies the maximum average value among the filtered subjects.
 * 4. **Identify Best Subjects**: Collects all subjects that have this best average.
 * 5. **Break Ties by Coefficient**: Among the best subjects, selects the one with the highest coefficient.
 *
 * If no subjects are available or no averages can be determined, the function returns `null`.
 */
export function getBestSubject(
  subjects: Subject[],
  isMainSubject: boolean = false
): Subject | null {
  let subjectAverages = getSubjectAverages(subjects);

  if (isMainSubject) {
    subjectAverages = subjectAverages.filter(
      (subject) => subject.isMainSubject
    );
  }

  if (subjectAverages.length === 0) {
    return null;
  }

  const bestAverage = Math.max(
    ...subjectAverages.map((entry) => entry.average)
  );

  const bestSubjects = subjects.filter((subject) =>
    subjectAverages.some(
      (entry) => entry.id === subject.id && entry.average === bestAverage
    )
  );

  if (bestSubjects.length === 0) {
    return null;
  }

  let bestSubject = bestSubjects[0];
  let maxCoefficient = bestSubject.coefficient ?? 100;

  for (const subject of bestSubjects) {
    const coeff = subject.coefficient ?? 100;
    if (coeff > maxCoefficient) {
      maxCoefficient = coeff;
      bestSubject = subject;
    }
  }

  return bestSubject;
}

/**
 * Retrieves the subject with the lowest average score.
 *
 * @param subjects - An array of all subjects.
 * @param isMainSubject - If true, considers only main subjects.
 * @returns The subject with the worst average, or null if none found.
 *
 * @details
 * This function identifies the subject that has the lowest average score. In cases where multiple subjects share the lowest average,
 * it selects the one with the highest coefficient to break the tie.
 *
 * Selection Process:
 * 1. **Retrieve Subject Averages**: Obtains the average scores for all subjects using `getSubjectAverages`.
 * 2. **Filter Main Subjects**: If `isMainSubject` is `true`, it filters the averages to include only main subjects.
 * 3. **Determine Worst Average**: Identifies the minimum average value among the filtered subjects.
 * 4. **Identify Worst Subjects**: Collects all subjects that have this worst average.
 * 5. **Break Ties by Coefficient**: Among the worst subjects, selects the one with the highest coefficient.
 *
 * If no subjects are available or no averages can be determined, the function returns `null`.
 */
export function getWorstSubject(
  subjects: Subject[],
  isMainSubject: boolean = false
): Subject | null {
  let subjectAverages = getSubjectAverages(subjects);

  if (isMainSubject) {
    subjectAverages = subjectAverages.filter(
      (subject) => subject.isMainSubject
    );
  }

  if (subjectAverages.length === 0) {
    return null;
  }

  const worstAverage = Math.min(
    ...subjectAverages.map((entry) => entry.average)
  );

  const worstSubjects = subjects.filter((subject) =>
    subjectAverages.some(
      (entry) => entry.id === subject.id && entry.average === worstAverage
    )
  );

  if (worstSubjects.length === 0) {
    return null;
  }

  let worstSubject = worstSubjects[0];
  let maxCoefficient = worstSubject.coefficient ?? 100;

  for (const subject of worstSubjects) {
    const coeff = subject.coefficient ?? 100;
    if (coeff > maxCoefficient) {
      maxCoefficient = coeff;
      worstSubject = subject;
    }
  }

  return worstSubject;
}

/**
 * Retrieves the best grade across all subjects, adjusted by the 'outOf' value.
 *
 * @param subjects - An array of all subjects.
 * @returns An object containing the best grade details, or null if no grades are present.
 *
 * @details
 * This function scans through all grades in all subjects to identify the highest-performing grade based on the percentage score (`value / outOf`).
 * In cases where multiple grades have the same percentage, the grade with the highest coefficient is selected.
 *
 * Selection Process:
 * 1. **Initialize Best Grade**: Starts with `bestGrade` set to `null`.
 * 2. **Iterate Through Grades**:
 *    - For each grade, calculates its percentage score.
 *    - Compares the grade's percentage with the current `bestGrade`.
 *    - If the grade has a higher percentage, it becomes the new `bestGrade`.
 *    - If the percentage is equal, the grade with the higher coefficient is preferred.
 * 3. **Return Best Grade**: After evaluating all grades, returns the details of the `bestGrade` if found.
 *
 * The returned object includes comprehensive details about the grade, including its value, subject, name, coefficient, and timestamps.
 */
export function getBestGrade(subjects: Subject[]): {
  grade: number;
  outOf: number;
  subject: Subject;
  name: string;
  coefficient: number;
  passedAt: string;
  createdAt: string;
} | null {
  let bestGrade = null;

  for (const subject of subjects) {
    for (const grade of subject.grades) {
      const percentage = grade.value / grade.outOf;
      const coefficient = grade.coefficient ?? 100;

      if (bestGrade === null) {
        bestGrade = {
          grade: grade.value,
          outOf: grade.outOf,
          subject,
          percentage,
          coefficient,
          name: grade.name,
          passedAt: grade.passedAt,
          createdAt: grade.createdAt,
        };
      } else if (percentage > bestGrade.percentage) {
        bestGrade = {
          grade: grade.value,
          outOf: grade.outOf,
          subject,
          percentage,
          coefficient,
          name: grade.name,
          passedAt: grade.passedAt,
          createdAt: grade.createdAt,
        };
      } else if (percentage === bestGrade.percentage) {
        if (coefficient > bestGrade.coefficient) {
          bestGrade = {
            grade: grade.value,
            outOf: grade.outOf,
            subject,
            percentage,
            coefficient,
            name: grade.name,
            passedAt: grade.passedAt,
            createdAt: grade.createdAt,
          };
        }
      }
    }
  }

  return bestGrade
    ? {
      grade: bestGrade.grade,
      outOf: bestGrade.outOf,
      subject: bestGrade.subject,
      name: bestGrade.name,
      coefficient: bestGrade.coefficient,
      passedAt: bestGrade.passedAt,
      createdAt: bestGrade.createdAt,
    }
    : null;
}

/**
 * Retrieves the worst grade across all subjects, adjusted by the 'outOf' value.
 *
 * @param subjects - An array of all subjects.
 * @returns An object containing the worst grade details, or null if no grades are present.
 *
 * @details
 * This function scans through all grades in all subjects to identify the lowest-performing grade based on the percentage score (`value / outOf`).
 * In cases where multiple grades have the same percentage, the grade with the highest coefficient is selected.
 *
 * Selection Process:
 * 1. **Initialize Worst Grade**: Starts with `worstGrade` set to `null`.
 * 2. **Iterate Through Grades**:
 *    - For each grade, calculates its percentage score.
 *    - Compares the grade's percentage with the current `worstGrade`.
 *    - If the grade has a lower percentage, it becomes the new `worstGrade`.
 *    - If the percentage is equal, the grade with the higher coefficient is preferred.
 * 3. **Return Worst Grade**: After evaluating all grades, returns the details of the `worstGrade` if found.
 *
 * The returned object includes comprehensive details about the grade, including its value, subject, name, coefficient, and timestamps.
 */
export function getWorstGrade(subjects: Subject[]): {
  grade: number;
  outOf: number;
  subject: Subject;
  name: string;
  coefficient: number;
  passedAt: string;
  createdAt: string;
} | null {
  let worstGrade = null;

  for (const subject of subjects) {
    for (const grade of subject.grades) {
      const percentage = grade.value / grade.outOf;
      const coefficient = grade.coefficient ?? 100;

      if (worstGrade === null) {
        worstGrade = {
          grade: grade.value,
          outOf: grade.outOf,
          subject,
          percentage,
          coefficient,
          name: grade.name,
          passedAt: grade.passedAt,
          createdAt: grade.createdAt,
        };
      } else if (percentage < worstGrade.percentage) {
        worstGrade = {
          grade: grade.value,
          outOf: grade.outOf,
          subject,
          percentage,
          coefficient,
          name: grade.name,
          passedAt: grade.passedAt,
          createdAt: grade.createdAt,
        };
      } else if (percentage === worstGrade.percentage) {
        if (coefficient > worstGrade.coefficient) {
          worstGrade = {
            grade: grade.value,
            outOf: grade.outOf,
            subject,
            percentage,
            coefficient,
            name: grade.name,
            passedAt: grade.passedAt,
            createdAt: grade.createdAt,
          };
        }
      }
    }
  }

  return worstGrade
    ? {
      grade: worstGrade.grade,
      outOf: worstGrade.outOf,
      subject: worstGrade.subject,
      name: worstGrade.name,
      coefficient: worstGrade.coefficient,
      passedAt: worstGrade.passedAt,
      createdAt: worstGrade.createdAt,
    }
    : null;
}

/**
 * Retrieves the best grade within a specific subject and its children.
 *
 * @param subjects - An array of all subjects.
 * @param subjectId - The ID of the subject to search within.
 * @returns An object containing the best grade details, or null if not found.
 *
 * @details
 * This function identifies the highest-performing grade within a specific subject and all of its descendant subjects.
 *
 * Selection Process:
 * 1. **Locate Subject**: Finds the subject corresponding to `subjectId`.
 * 2. **Retrieve Children**: Collects all descendant subjects using `getChildren`.
 * 3. **Combine Subjects**: Forms a combined array of the target subject and its children.
 * 4. **Determine Best Grade**: Uses `getBestGrade` to find the best grade within this combined array.
 *
 * If the target subject is not found or no grades are present within the scope, the function returns `null`.
 */
export function getBestGradeInSubject(
  subjects: Subject[],
  subjectId: string
): {
  grade: number;
  outOf: number;
  subject: Subject;
  name: string;
  coefficient: number;
  passedAt: string;
  createdAt: string;
} | null {
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return null;

  const childrenIds = getChildren(subjects, subjectId);
  const children = subjects.filter((s) => childrenIds.includes(s.id));

  const bestGrade = getBestGrade([subject, ...children]);
  return bestGrade;
}

/**
 * Retrieves the worst grade within a specific subject and its children.
 *
 * @param subjects - An array of all subjects.
 * @param subjectId - The ID of the subject to search within.
 * @returns An object containing the worst grade details, or null if not found.
 *
 * @details
 * This function identifies the lowest-performing grade within a specific subject and all of its descendant subjects.
 *
 * Selection Process:
 * 1. **Locate Subject**: Finds the subject corresponding to `subjectId`.
 * 2. **Retrieve Children**: Collects all descendant subjects using `getChildren`.
 * 3. **Combine Subjects**: Forms a combined array of the target subject and its children.
 * 4. **Determine Worst Grade**: Uses `getWorstGrade` to find the worst grade within this combined array.
 *
 * If the target subject is not found or no grades are present within the scope, the function returns `null`.
 */
export function getWorstGradeInSubject(
  subjects: Subject[],
  subjectId: string
): {
  grade: number;
  outOf: number;
  subject: Subject;
  name: string;
  coefficient: number;
  passedAt: string;
  createdAt: string;
} | null {
  const subject = subjects.find((s) => s.id === subjectId);
  if (!subject) return null;

  const childrenIds = getChildren(subjects, subjectId);
  const children = subjects.filter((s) => childrenIds.includes(s.id));

  const worstGrade = getWorstGrade([subject, ...children]);
  return worstGrade;
}

/**
 * Retrieves all dates on which grades were received for a specific subject or all subjects.
 *
 * @param subjects - An array of all subjects.
 * @param subjectId - Optional ID of the subject to filter by.
 * @returns An array of unique Date objects representing when grades were received.
 *
 * @details
 * This function compiles a list of unique dates on which grades were awarded. If a `subjectId` is provided, it includes grades
 * from that subject and all its descendants. Otherwise, it includes grades from all subjects.
 *
 * Steps:
 * 1. **Initialize Dates Array**: Starts with an empty array to store unique dates.
 * 2. **Filter Subjects**:
 *    - If `subjectId` is specified, it locates the subject and its descendants.
 *    - Otherwise, it considers all subjects.
 * 3. **Collect Grade Dates**:
 *    - Iterates through the relevant subjects' grades.
 *    - Converts each grade's `passedAt` timestamp to a `Date` object.
 *    - Adds the date to the `dates` array if it is not already present.
 *
 * The resulting array contains all unique dates when grades were received, which can be used for time-based analyses.
 */
export function getGradeDates(subjects: Subject[], subjectId?: string): Date[] {
  const dates: Date[] = [];

  if (subjectId) {
    const subject = subjects.find((s) => s.id === subjectId);
    if (!subject) return dates;

    subject.grades.forEach((grade) => {
      const passedAt = new Date(grade.passedAt);
      if (!dates.some((date) => date.getTime() === passedAt.getTime())) {
        dates.push(passedAt);
      }
    });

    const childrenIds = getChildren(subjects, subjectId);
    const children = subjects.filter((s) => childrenIds.includes(s.id));

    children.forEach((child) => {
      child.grades.forEach((grade) => {
        const passedAt = new Date(grade.passedAt);
        if (!dates.some((date) => date.getTime() === passedAt.getTime())) {
          dates.push(passedAt);
        }
      });
    });
  } else {
    subjects.forEach((subject) => {
      subject.grades.forEach((grade) => {
        const passedAt = new Date(grade.passedAt);
        if (!dates.some((date) => date.getTime() === passedAt.getTime())) {
          dates.push(passedAt);
        }
      });
    });
  }
  return dates;
}

/**
 * Determines the start and end bounds for a given period, ensuring all grades are included.
 *
 * @param period - The period to evaluate.
 * @param subjects - An array of all subjects.
 * @returns An object containing the start and end Date objects.
 *
 * @details
 * This function establishes the temporal boundaries for calculating averages or trends based on the specified `period`.
 * It ensures that all relevant grades are encompassed within these bounds.
 *
 * Handling Different Period Types:
 * - **Full Year or Undefined**:
 *   - **Start Date**: Defaults to September 1st of the current year.
 *   - **End Date**: Defaults to the current date.
 *   - **Adjustment**: If any grades fall outside these bounds, the function adjusts the start or end dates accordingly to include all grades.
 * - **Specific Period**:
 *   - Uses the `startAt` and `endAt` dates provided in the `period`.
 *
 * Steps for Full Year:
 * 1. **Set Default Bounds**: September 1st to the current date.
 * 2. **Collect All Grade Dates**: Gathers all dates when grades were received.
 * 3. **Determine Extreme Dates**:
 *    - Finds the earliest grade date and compares it to the default start date.
 *    - Finds the latest grade date and compares it to the default end date.
 * 4. **Adjust Bounds**: Expands the start or end dates if necessary to include all grade dates.
 *
 * For specific periods, it directly uses the provided `startAt` and `endAt` dates.
 */
export function findPeriodBounds(period: Period, subjects: Subject[], year?: Year): { startAt: Date; endAt: Date } {
  // TODO: FIX LATER USING YEAR DATERANGE (dont break this pls)
  if (period.id === "full-year" || period.id === null) {
    // By default
    const now = new Date();
    let academicYear = now.getFullYear();
    if (now.getMonth() < 8) {
      academicYear--;
    }
    let startDate = new Date(academicYear, 8, 1);
    let endDate = now;

    // Use year date range
    if (year) {
      startDate = new Date(year.startDate);
      endDate = new Date(year.endDate);
    }

    const allGradeDates = getGradeDates(subjects);
    const firstGradeDate = allGradeDates.reduce((acc, date) => (date < acc ? date : acc), endDate);
    const lastGradeDate = allGradeDates.reduce((acc, date) => (date > acc ? date : acc), startDate);
    return { startAt: firstGradeDate < startDate ? firstGradeDate : startDate, endAt: lastGradeDate > endDate ? lastGradeDate : endDate };
  }
  return { startAt: new Date(period.startAt), endAt: new Date(period.endAt) };
}

/**
 * Generates a default period representing the full year, ensuring all grades are included.
 *
 * @param subjects - An array of all subjects.
 * @returns A Period object representing the full year.
 *
 * @details
 * This function creates a `Period` object that spans the full academic year. It leverages `findPeriodBounds` to determine the appropriate
 * start and end dates, ensuring that all grades are encompassed within this period.
 *
 * The generated period includes:
 * - **ID**: Set to `"full-year"`.
 * - **Name**: Set to `"Toute l'année"`.
 * - **StartAt and EndAt**: Derived from the period bounds.
 * - **Timestamps**: Sets `createdAt` to the current date and time.
 * - **User Association**: Sets `userId` to an empty string (this can be modified as needed).
 *
 * This function is useful for scenarios where an overview of the entire academic year's performance is required.
 */
export function fullYearPeriod(subjects: Subject[], year?: Year): Period {
  const bounds = findPeriodBounds({ id: "full-year" } as Period, subjects, year);
  return {
    id: "full-year",
    name: "Toute l'année",
    startAt: bounds.startAt.toISOString(),
    endAt: bounds.endAt.toISOString(),
    createdAt: new Date().toISOString(),
    userId: "",
    isCumulative: false,
    yearId: year?.id || "full-year-period-none-id",
  };
}

/**
 * Calculates the median average for each subject.
 *
 * @param subjects - An array of all subjects.
 * @returns A map where the key is the subject ID and the value is the median average.
 *
 * @details
 * This function computes the median grade for each subject, providing a central value that represents the typical performance
 * without being skewed by outliers. The median is particularly useful when grade distributions are not symmetrical.
 *
 * Steps:
 * 1. **Initialize a Map**: Creates a new `Map` to store the median averages keyed by subject ID.
 * 2. **Iterate Over Subjects**: For each subject in the provided array:
 *    a. **Extract and Convert Grades**: Maps each grade to a standardized percentage scale by dividing the grade value by the maximum possible value (`outOf`) and scaling to 20.
 *    b. **Sort Grades**: Sorts the converted grades in ascending order to prepare for median calculation.
 *    c. **Determine Median**:
 *       - If there are no grades, assigns `null` as the median.
 *       - If the number of grades is odd, selects the middle value.
 *       - If even, calculates the average of the two middle values.
 * 3. **Store Median in Map**: Associates the calculated median with the respective subject ID in the map.
 * 4. **Return the Map**: After processing all subjects, returns the map containing median averages.
 */
export function getMedianAverages(subjects: Subject[]): Map<string, number | null> {
  const medianAverages = new Map<string, number | null>();

  subjects.forEach((subject) => {
    const sortedGrades = subject.grades
      .map((grade) => grade.value / grade.outOf * 20)
      .sort((a, b) => a - b);

    const len = sortedGrades.length;
    if (len === 0) {
      medianAverages.set(subject.id, null);
      return;
    }

    const mid = Math.floor(len / 2);
    let median: number;

    if (len % 2 === 0) {
      median = (sortedGrades[mid - 1] + sortedGrades[mid]) / 2;
    } else {
      median = sortedGrades[mid];
    }

    medianAverages.set(subject.id, median);
  });

  return medianAverages;
}

/**
 * Calculates the standard deviation of grades for each subject.
 *
 * @param subjects - An array of all subjects.
 * @returns A map where the key is the subject ID and the value is the standard deviation of grades.
 *
 * @details
 * This function measures the amount of variation or dispersion in the grades for each subject.
 * A low standard deviation indicates that grades are close to the mean, suggesting consistency,
 * while a high standard deviation implies a wide range of grades, indicating variability in performance.
 *
 * Steps:
 * 1. **Initialize a Map**: Creates a new `Map` to store standard deviations keyed by subject ID.
 * 2. **Iterate Over Subjects**: For each subject in the provided array:
 *    a. **Convert Grades**: Transforms each grade to a standardized percentage scale.
 *    b. **Calculate Mean**: Computes the average grade for the subject.
 *    c. **Compute Variance**: Calculates the average of the squared differences from the mean.
 *    d. **Determine Standard Deviation**: Takes the square root of the variance to obtain the standard deviation.
 *    e. **Handle Edge Cases**: If there are no grades, assigns `null` as the standard deviation.
 * 3. **Store Standard Deviation in Map**: Associates the calculated standard deviation with the respective subject ID.
 * 4. **Return the Map**: After processing all subjects, returns the map containing standard deviations.
 */
export function getGradeStandardDeviation(subjects: Subject[]): Map<string, number | null> {
  const stdDevs = new Map<string, number | null>();

  subjects.forEach((subject) => {
    const grades = subject.grades.map((grade) => grade.value / grade.outOf * 20);
    const len = grades.length;
    if (len === 0) {
      stdDevs.set(subject.id, null);
      return;
    }

    const mean = grades.reduce((acc, val) => acc + val, 0) / len;
    const variance = grades.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / len;
    const stdDev = Math.sqrt(variance);

    stdDevs.set(subject.id, stdDev);
  });

  return stdDevs;
}

/**
 * Calculates the grade distribution for each subject.
 *
 * @param subjects - An array of all subjects.
 * @returns A map where the key is the subject ID and the value is another map representing grade counts.
 *
 * @details
 * This function categorizes grades into predefined letter grades (A, B, C, D, F) based on their percentage scores.
 * It then counts the frequency of each letter grade within each subject, providing insights into the distribution
 * of grades achieved.
 *
 * Steps:
 * 1. **Initialize a Map**: Creates a new `Map` to store grade distributions keyed by subject ID.
 * 2. **Iterate Over Subjects**: For each subject in the provided array:
 *    a. **Initialize Category Map**: Creates a nested `Map` to count occurrences of each grade category.
 *    b. **Iterate Over Grades**: For each grade in the subject:
 *       - **Determine Grade Letter**: Assigns a letter grade based on the percentage score.
 *       - **Increment Count**: Updates the count for the determined grade letter in the category map.
 *    c. **Store Distribution in Map**: Associates the category map with the respective subject ID.
 * 3. **Return the Map**: After processing all subjects, returns the map containing grade distributions.
 */
export function getGradeDistribution(subjects: Subject[]): Map<string, Map<string, number>> {
  const distributions = new Map<string, Map<string, number>>();

  subjects.forEach((subject) => {
    const distribution = new Map<string, number>();

    subject.grades.forEach((grade) => {
      const percentage = (grade.value / grade.outOf) * 100;
      let gradeLetter: string;

      if (percentage >= 90) gradeLetter = 'A';
      else if (percentage >= 80) gradeLetter = 'B';
      else if (percentage >= 70) gradeLetter = 'C';
      else if (percentage >= 60) gradeLetter = 'D';
      else gradeLetter = 'F';

      distribution.set(gradeLetter, (distribution.get(gradeLetter) || 0) + 1);
    });

    distributions.set(subject.id, distribution);
  });

  return distributions;
}

/**
 * Calculates the pass rate for each subject.
 *
 * @param subjects - An array of all subjects.
 * @param passingThreshold - The minimum average percentage to consider as passing.
 * @returns A map where the key is the subject ID and the value is the pass rate as a percentage.
 *
 * @details
 * This function determines the proportion of grades that meet or exceed a specified passing threshold.
 * The pass rate is calculated as the percentage of grades that are considered passing out of the total number of grades.
 *
 * Steps:
 * 1. **Initialize a Map**: Creates a new `Map` to store pass rates keyed by subject ID.
 * 2. **Iterate Over Subjects**: For each subject in the provided array:
 *    a. **Convert Grades**: Transforms each grade to a standardized percentage scale.
 *    b. **Calculate Pass Count**: Counts the number of grades that meet or exceed the `passingThreshold`.
 *    c. **Compute Pass Rate**: Divides the pass count by the total number of grades and multiplies by 100 to get a percentage.
 *    d. **Handle Edge Cases**: If there are no grades, assigns `null` as the pass rate.
 * 3. **Store Pass Rate in Map**: Associates the calculated pass rate with the respective subject ID.
 * 4. **Return the Map**: After processing all subjects, returns the map containing pass rates.
 */
export function getPassRates(subjects: Subject[], passingThreshold: number = 60): Map<string, number | null> {
  const passRates = new Map<string, number | null>();

  subjects.forEach((subject) => {
    const grades = subject.grades.map((grade) => (grade.value / grade.outOf) * 100);
    const len = grades.length;
    if (len === 0) {
      passRates.set(subject.id, null);
      return;
    }

    const passed = grades.filter((grade) => grade >= passingThreshold).length;
    const passRate = (passed / len) * 100;

    passRates.set(subject.id, passRate);
  });

  return passRates;
}

/**
 * Calculates the improvement trend of grades over time for each subject.
 *
 * @param subjects - An array of all subjects.
 * @returns A map where the key is the subject ID and the value is the trend slope.
 *
 * @details
 * This function analyzes the progression of a student's grades over time within each subject by calculating the trend slope.
 * A positive slope indicates improvement, while a negative slope suggests a decline in performance.
 *
 * Steps:
 * 1. **Initialize a Map**: Creates a new `Map` to store improvement trends keyed by subject ID.
 * 2. **Iterate Over Subjects**: For each subject in the provided array:
 *    a. **Sort Grades by Date**: Orders the grades chronologically based on the `passedAt` date.
 *    b. **Handle Edge Cases**: If there are no grades, assigns `null` as the trend.
 *    c. **Prepare Data for Trend Calculation**: Maps each grade to an object containing the date and standardized average score.
 *    d. **Calculate Trend**: Uses the `getTrend` function to compute the slope of the grades over time.
 *    e. **Store Trend in Map**: Associates the calculated trend with the respective subject ID.
 * 3. **Return the Map**: After processing all subjects, returns the map containing improvement trends.
 */
export function getImprovementTrends(subjects: Subject[]): Map<string, number | null> {
  const trends = new Map<string, number | null>();

  subjects.forEach((subject) => {
    const sortedGrades = subject.grades
      .map((grade) => ({
        date: new Date(grade.passedAt),
        value: (grade.value / grade.outOf) * 20, // Convert to percentage scale
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    if (sortedGrades.length === 0) {
      trends.set(subject.id, null);
      return;
    }

    const data = sortedGrades.map((grade, index) => ({
      date: grade.date,
      average: grade.value,
    }));

    const trend = getTrend(data);
    trends.set(subject.id, trend);
  });

  return trends;
}

/**
 * Predicts the final average for each subject based on current grades and assumed future performance.
 *
 * @param subjects - An array of all subjects.
 * @param assumedFutureGrade - The assumed grade percentage for future grades.
 * @param remainingGradesCount - The number of remaining grades expected.
 * @returns A map where the key is the subject ID and the value is the predicted final average.
 *
 * @details
 * This function forecasts a student's final average grade in each subject by combining their current performance with an
 * assumed performance in future assessments. It provides an estimate based on the number of remaining grades and the
 * grades already achieved.
 *
 * Steps:
 * 1. **Initialize a Map**: Creates a new `Map` to store predicted final averages keyed by subject ID.
 * 2. **Iterate Over Subjects**: For each subject in the provided array:
 *    a. **Convert Current Grades**: Transforms existing grades to a standardized percentage scale.
 *    b. **Handle Edge Cases**:
 *       - If there are no current grades and no remaining grades, assigns `null`.
 *       - If there are no remaining grades, assigns `null` since no further performance can be predicted.
 *    c. **Calculate Total Expected Score**: Sums the current grades and adds the product of the assumed future grade and the number of remaining grades.
 *    d. **Compute Predicted Final Average**: Divides the total expected score by the total number of grades (current + remaining) to obtain the predicted average.
 * 3. **Store Prediction in Map**: Associates the calculated predicted average with the respective subject ID.
 * 4. **Return the Map**: After processing all subjects, returns the map containing predicted final averages.
 */
export function getPredictedFinalAverages(
  subjects: Subject[],
  assumedFutureGrade: number = 70, // Default assumed grade
  remainingGradesCount: number = 5
): Map<string, number | null> {
  const predictions = new Map<string, number | null>();

  subjects.forEach((subject) => {
    const currentGrades = subject.grades.map((grade) => (grade.value / grade.outOf) * 100);
    const currentCount = currentGrades.length;

    if (currentCount === 0 && remainingGradesCount === 0) {
      predictions.set(subject.id, null);
      return;
    }

    const total = currentGrades.reduce((acc, val) => acc + val, 0) + assumedFutureGrade * remainingGradesCount;
    const finalAverage = total / (currentCount + remainingGradesCount);

    predictions.set(subject.id, finalAverage);
  });

  return predictions;
}

/**
 * Calculates the moving average of grades for each subject over a specified window size.
 *
 * @param subjects - An array of all subjects.
 * @param windowSize - The number of recent grades to include in each moving average calculation.
 * @returns A map where the key is the subject ID and the value is an array of moving average values.
 *
 * @details
 * This function computes the moving average of a student's grades within each subject, providing a smoothed trend
 * that highlights recent performance while mitigating the impact of outlier grades. The moving average is calculated
 * over a sliding window of a specified number of recent grades.
 *
 * Steps:
 * 1. **Initialize a Map**: Creates a new `Map` to store moving averages keyed by subject ID.
 * 2. **Iterate Over Subjects**: For each subject in the provided array:
 *    a. **Sort Grades by Date**: Orders the grades chronologically to ensure accurate moving average calculations.
 *    b. **Initialize Averages Array**: Creates an array to store moving average values corresponding to each grade.
 *    c. **Iterate Over Sorted Grades**:
 *       - For each grade, if there are enough previous grades to form a complete window, calculates the average of the grades within the window.
 *       - If not enough grades are present to form a complete window, assigns `null` to indicate insufficient data.
 *    d. **Store Moving Averages in Map**: Associates the array of moving averages with the respective subject ID.
 * 3. **Return the Map**: After processing all subjects, returns the map containing moving averages.
 */
export function getMovingAverages(
  subjects: Subject[],
  windowSize: number = 3
): Map<string, (number | null)[]> {
  const movingAverages = new Map<string, (number | null)[]>();

  subjects.forEach((subject) => {
    const sortedGrades = subject.grades
      .map((grade) => ({
        date: new Date(grade.passedAt),
        value: (grade.value / grade.outOf) * 20, // Convert to percentage scale
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const averages: (number | null)[] = [];

    for (let i = 0; i < sortedGrades.length; i++) {
      if (i < windowSize - 1) {
        averages.push(null); // Not enough data points for the moving average
        continue;
      }

      const windowGrades = sortedGrades.slice(i - windowSize + 1, i + 1).map(g => g.value);
      const windowAverage = windowGrades.reduce((acc, val) => acc + val, 0) / windowSize;
      averages.push(windowAverage);
    }

    movingAverages.set(subject.id, averages);
  });

  return movingAverages;
}

/**
 * Identifies the top N subjects with the highest improvement trends.
 *
 * @param subjects - An array of all subjects.
 * @param topN - The number of top improved subjects to retrieve.
 * @returns An array of subjects sorted by highest improvement trends.
 *
 * @details
 * This function highlights subjects where a student's performance is improving over time by identifying positive trend slopes.
 * It leverages the trend data calculated by the `getImprovementTrends` function and selects the subjects with the highest values.
 *
 * Steps:
 * 1. **Calculate Improvement Trends**: Uses the `getImprovementTrends` function to obtain trend slopes for each subject.
 * 2. **Filter Positive Trends**: Selects subjects with trend slopes that are positive, indicating an improvement in performance.
 * 3. **Compile Subject Trends**: Aggregates the filtered subjects and their trends into an array.
 * 4. **Sort Subjects by Improvement**: Orders the subjects in descending order based on their trend slopes.
 * 5. **Select Top N Improved Subjects**: Extracts the top N subjects with the highest trend slopes.
 * 6. **Return the Array**: Provides the sorted list of the top improved subjects.
 */
export function getTopImprovedSubjects(
  subjects: Subject[],
  topN: number = 3
): { subject: Subject; trend: number }[] {
  const improvementTrends = getImprovementTrends(subjects);
  const subjectTrends: { subject: Subject; trend: number }[] = [];

  subjects.forEach((subject) => {
    const trend = improvementTrends.get(subject.id);
    if (trend != null && trend > 0) {
      subjectTrends.push({ subject, trend });
    }
  });

  subjectTrends.sort((a, b) => b.trend - a.trend);
  return subjectTrends.slice(0, topN);
}


/**
 * Projects the required grades to achieve a desired final average for each subject,
 * a specific subject, or a custom average configuration.
 *
 * @param subjects - An array of all subjects.
 * @param desiredAverage - The target average percentage the student aims to achieve.
 * @param totalGradesCount - The total number of grades expected for the calculation.
 * @param options - Optional parameters to specify the scope of the calculation.
 *                  - `subjectId`: The ID of a specific subject to calculate for.
 *                  - `customAverage`: A custom average configuration object.
 * @returns A map where the key is the subject ID (or a special key for global/custom averages)
 *          and the value is the required average for remaining grades.
 *
 * @details
 * This function calculates the average grade a student needs to achieve in their remaining assessments
 * to reach a specified final average. It can operate in three modes:
 *
 * 1. **Global Average**: Calculates the required average across all subjects.
 * 2. **Custom Average**: Calculates based on a custom average configuration.
 * 3. **Specific Subject Average**: Calculates for a particular subject.
 *
 * The function handles edge cases where the current number of grades exceeds or meets the total expected grades.
 */
export function getRequiredGradesForDesiredAverage(
  subjects: Subject[],
  desiredAverage: number = 85,
  totalGradesCount: number = 10,
  options?: {
    subjectId?: string;
    customAverage?: Average;
  }
): Map<string, number | null> {
  const requiredGrades = new Map<string, number | null>();

  // **Mode 1: Specific Subject Average**
  if (options?.subjectId) {
    const subject = subjects.find((s) => s.id === options.subjectId);
    if (!subject) {
      console.warn(`Subject with ID ${options.subjectId} not found.`);
      requiredGrades.set(options.subjectId, null);
      return requiredGrades;
    }

    const currentGrades = subject.grades.map((grade) => (grade.value / grade.outOf) * 100);
    const currentCount = currentGrades.length;

    if (currentCount > totalGradesCount) {
      requiredGrades.set(subject.id, null);
      return requiredGrades;
    }

    const remainingGrades = totalGradesCount - currentCount;
    if (remainingGrades === 0) {
      requiredGrades.set(subject.id, null);
      return requiredGrades;
    }

    const currentTotal = currentGrades.reduce((acc, val) => acc + val, 0);
    const requiredTotal = desiredAverage * totalGradesCount;
    const requiredFutureTotal = requiredTotal - currentTotal;

    const requiredFutureAverage = requiredFutureTotal / remainingGrades;

    requiredGrades.set(subject.id, requiredFutureAverage);
    return requiredGrades;
  }

  // **Mode 2: Custom Average Configuration**
  if (options?.customAverage) {
    const customConfig = buildCustomConfig(options.customAverage);
    const includedSubjects = subjects.filter((s) => isSubjectIncludedInCustomAverage(s, subjects, customConfig));

    const totalSubjects = includedSubjects.length;
    const currentGrades: number[] = [];

    includedSubjects.forEach((subject) => {
      subject.grades.forEach((grade) => {
        const percentage = (grade.value / grade.outOf) * 100;
        const coefficient = (grade.coefficient ?? 100) / 100;
        currentGrades.push(percentage * coefficient);
      });
    });

    const currentCount = currentGrades.length;

    if (currentCount > totalGradesCount) {
      requiredGrades.set('custom-average', null);
      return requiredGrades;
    }

    const remainingGrades = totalGradesCount - currentCount;
    if (remainingGrades === 0) {
      requiredGrades.set('custom-average', null);
      return requiredGrades;
    }

    const currentTotal = currentGrades.reduce((acc, val) => acc + val, 0);
    const requiredTotal = desiredAverage * totalGradesCount;
    const requiredFutureTotal = requiredTotal - currentTotal;

    const requiredFutureAverage = requiredFutureTotal / remainingGrades;

    requiredGrades.set('custom-average', requiredFutureAverage);
    return requiredGrades;
  }

  // **Mode 3: Global Average**
  // Calculate across all subjects
  subjects.forEach((subject) => {
    const currentGrades = subject.grades.map((grade) => (grade.value / grade.outOf) * 100);
    const currentCount = currentGrades.length;

    if (currentCount > totalGradesCount) {
      requiredGrades.set(subject.id, null);
      return;
    }

    const remainingGrades = totalGradesCount - currentCount;
    if (remainingGrades === 0) {
      requiredGrades.set(subject.id, null);
      return;
    }

    const currentTotal = currentGrades.reduce((acc, val) => acc + val, 0);
    const requiredTotal = desiredAverage * totalGradesCount;
    const requiredFutureTotal = requiredTotal - currentTotal;

    const requiredFutureAverage = requiredFutureTotal / remainingGrades;

    requiredGrades.set(subject.id, requiredFutureAverage);
  });

  return requiredGrades;
}


/**
 * Identifies subjects with a negative trend in average grades.
 *
 * @param subjects - An array of all subjects.
 * @returns An array of subjects that are experiencing a decline in performance.
 *
 * @details
 * This function detects subjects where the student's performance is declining over time by identifying negative trend slopes.
 * Such insights enable students to focus their efforts on improving in areas where performance is waning.
 *
 * Steps:
 * 1. **Calculate Improvement Trends**: Utilizes the `getImprovementTrends` function to obtain trend slopes for each subject.
 * 2. **Filter Negative Trends**: Selects subjects with trend slopes that are negative, indicating a decline in performance.
 * 3. **Compile Declining Subjects**: Aggregates the filtered subjects into an array.
 * 4. **Return the Array**: Provides the list of subjects that are experiencing declining trends.
 */
export function getDecliningSubjects(subjects: Subject[]): Subject[] {
  const improvementTrends = getImprovementTrends(subjects);
  const decliningSubjects: Subject[] = [];

  subjects.forEach((subject) => {
    const trend = improvementTrends.get(subject.id);
    if (trend != null && trend < 0) {
      decliningSubjects.push(subject);
    }
  });

  return decliningSubjects;
}


/**
 * Calculates the Pearson correlation coefficient between two subjects' grades.
 *
 * @param subjects - An array of all subjects.
 * @param subjectId1 - The ID of the first subject.
 * @param subjectId2 - The ID of the second subject.
 * @returns The Pearson correlation coefficient, or null if insufficient data.
 *
 * @details
 * This function assesses the linear relationship between grades in two different subjects by computing the Pearson correlation coefficient.
 * A coefficient close to 1 indicates a strong positive correlation, -1 indicates a strong negative correlation, and 0 indicates no correlation.
 *
 * Steps:
 * 1. **Locate Subjects**: Finds the two subjects corresponding to `subjectId1` and `subjectId2`.
 * 2. **Handle Missing Subjects**: If either subject is not found, returns `null`.
 * 3. **Extract and Sort Grades**: Converts grades to a standardized percentage scale and sorts them to align corresponding grades by order.
 * 4. **Determine Common Length**: Uses the minimum number of grades between the two subjects to ensure paired comparison.
 * 5. **Check Data Availability**: If there are no common grades, returns `null`.
 * 6. **Compute Means**: Calculates the mean of each subject's grades.
 * 7. **Calculate Covariance and Variance**:
 *    - Computes the covariance between the two sets of grades.
 *    - Computes the variance for each subject's grades.
 * 8. **Compute Pearson Correlation Coefficient**: Divides the covariance by the product of the standard deviations of both subjects.
 *    - If either variance is zero, indicating no variability, returns `null`.
 * 9. **Return the Coefficient**: Provides the calculated Pearson correlation coefficient.
 */
export function getGradeCorrelation(
  subjects: Subject[],
  subjectId1: string,
  subjectId2: string
): number | null {
  const subject1 = subjects.find((s) => s.id === subjectId1);
  const subject2 = subjects.find((s) => s.id === subjectId2);

  if (!subject1 || !subject2) return null;

  // Assuming grades are ordered by date, align grades by their indices
  const grades1 = subject1.grades
    .map((g) => (g.value / g.outOf) * 100)
    .sort((a, b) => a - b);
  const grades2 = subject2.grades
    .map((g) => (g.value / g.outOf) * 100)
    .sort((a, b) => a - b);

  const len = Math.min(grades1.length, grades2.length);
  if (len === 0) return null;

  const x = grades1.slice(0, len);
  const y = grades2.slice(0, len);

  const meanX = x.reduce((acc, val) => acc + val, 0) / len;
  const meanY = y.reduce((acc, val) => acc + val, 0) / len;

  let numerator = 0;
  let denominatorX = 0;
  let denominatorY = 0;

  for (let i = 0; i < len; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    numerator += dx * dy;
    denominatorX += dx * dx;
    denominatorY += dy * dy;
  }

  if (denominatorX === 0 || denominatorY === 0) return null;

  return numerator / Math.sqrt(denominatorX * denominatorY);
}

/**
 * Identifies subjects with the most consistent grades based on the lowest standard deviation.
 *
 * @param subjects - An array of all subjects.
 * @param topN - The number of top consistent subjects to retrieve.
 * @returns An array of subjects sorted by consistency.
 *
 * @details
 * This function highlights subjects where a student's grades show minimal variability, indicating consistent performance.
 * It leverages the standard deviation calculated by the `getGradeStandardDeviation` function and selects the subjects with the lowest values.
 *
 * Steps:
 * 1. **Calculate Standard Deviations**: Uses the `getGradeStandardDeviation` function to obtain standard deviations for each subject.
 * 2. **Filter and Pair Subjects with Their Standard Deviations**: Creates an array of objects pairing each subject with its standard deviation.
 * 3. **Sort Subjects by Consistency**: Orders the subjects in ascending order based on their standard deviations, prioritizing lower values.
 * 4. **Select Top N Consistent Subjects**: Extracts the top N subjects with the lowest standard deviations.
 * 5. **Return the Array**: Provides the sorted list of the most consistent subjects.
 */
export function getMostConsistentSubjects(
  subjects: Subject[],
  topN: number = 3
): { subject: Subject; standardDeviation: number }[] {
  const stdDevs = getGradeStandardDeviation(subjects);
  const consistentSubjects: { subject: Subject; standardDeviation: number }[] = [];

  subjects.forEach((subject) => {
    const stdDev = stdDevs.get(subject.id);

    if (stdDev != null) {
      consistentSubjects.push({ subject, standardDeviation: stdDev });
    }
  });

  consistentSubjects.sort((a, b) => a.standardDeviation - b.standardDeviation);
  return consistentSubjects.slice(0, topN);
}


/**
 * Identifies subjects with the least consistent grades based on the highest standard deviation.
 *
 * @param subjects - An array of all subjects.
 * @param topN - The number of top least consistent subjects to retrieve.
 * @returns An array of subjects sorted by least consistency.
 *
 * @details
 * This function highlights subjects where a student's grades exhibit significant variability, indicating inconsistent performance.
 * It leverages the standard deviation calculated by the `getGradeStandardDeviation` function and selects the subjects with the highest values.
 *
 * Steps:
 * 1. **Calculate Standard Deviations**: Uses the `getGradeStandardDeviation` function to obtain standard deviations for each subject.
 * 2. **Filter and Pair Subjects with Their Standard Deviations**: Creates an array of objects pairing each subject with its standard deviation.
 * 3. **Sort Subjects by Consistency**: Orders the subjects in descending order based on their standard deviations, prioritizing higher values.
 * 4. **Select Top N Least Consistent Subjects**: Extracts the top N subjects with the highest standard deviations.
 * 5. **Return the Array**: Provides the sorted list of the least consistent subjects.
 */
export function getLeastConsistentSubjects(
  subjects: Subject[],
  topN: number = 3
): { subject: Subject; standardDeviation: number }[] {
  const stdDevs = getGradeStandardDeviation(subjects);
  const leastConsistentSubjects: { subject: Subject; standardDeviation: number }[] = [];

  subjects.forEach((subject) => {
    const stdDev = stdDevs.get(subject.id);
    // Check for both null and undefined to ensure stdDev is a number
    if (stdDev != null) { // This checks for both null and undefined
      leastConsistentSubjects.push({ subject, standardDeviation: stdDev });
    }
  });

  // Sort subjects by their standard deviation in descending order
  leastConsistentSubjects.sort((a, b) => b.standardDeviation - a.standardDeviation);

  // Return the top N least consistent subjects
  return leastConsistentSubjects.slice(0, topN);
}


/**
 * Projects future grades for each subject based on current trends.
 *
 * @param subjects - An array of all subjects.
 * @param futureGradesCount - The number of future grades to project.
 * @returns A map where the key is the subject ID and the value is an array of projected grades.
 *
 * @details
 * This function forecasts future grades by extrapolating current performance trends. It provides students with an estimate of their potential
 * grades in upcoming assessments, aiding in goal setting and performance planning.
 *
 * Calculation Steps:
 * 1. **Iterate Through Subjects**: For each subject, extract and sort grades by date.
 * 2. **Compute Trend Slope**: Determine the trend slope using the `getTrend` function.
 * 3. **Project Future Grades**:
 *    - Use the trend slope to estimate future grades.
 *    - Clamp projected grades between 0 and 100 to maintain realistic values.
 * 4. **Store Results**: Populate the `projections` map with the array of projected grades for each subject.
 *
 * Note:
 * - The accuracy of projections depends on the consistency and length of existing grade data.
 * - Trend-based projections assume that current performance trends will continue.
 */
export function getFutureGradeProjections(
  subjects: Subject[],
  futureGradesCount: number = 3
): Map<string, number[]> {
  const projections = new Map<string, number[]>();

  subjects.forEach((subject) => {
    const grades = subject.grades
      .map((grade) => ({
        date: new Date(grade.passedAt),
        value: (grade.value / grade.outOf) * 20, // Convert to percentage scale
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());

    const len = grades.length;
    if (len === 0) {
      projections.set(subject.id, []);
      return;
    }

    // Simple linear projection based on the trend
    const trend = getTrend(grades.map(g => ({ date: g.date, average: g.value })));
    const lastGrade = grades[grades.length - 1].value;

    const projectedGrades: number[] = [];
    for (let i = 1; i <= futureGradesCount; i++) {
      const projected = lastGrade + trend * i;
      projectedGrades.push(Math.min(Math.max(projected, 0), 100)); // Clamp between 0 and 100
    }

    projections.set(subject.id, projectedGrades);
  });

  return projections;
}

/**
 * Calculates the streak of consecutive grades that contribute to an increasing average.
 * If a grade decreases the average, the streak is decreased by one instead of resetting.
 *
 * @param subjects - An array of all subjects.
 * @param options - Optional parameters to specify the scope of the streak calculation.
 *                  - `subjectId`: The ID of a specific subject to calculate the streak for.
 *                  - `customAverage`: A custom average configuration object.
 * @returns The calculated streak as a number.
 *
 * @details
 * This function iterates through the grades in chronological order, calculating the average at each step.
 * It maintains a streak count that increases when the average increases and decreases by one when the average decreases.
 * The streak reflects the number of consecutive grades contributing to the growth of the average.
 *
 * The function supports three modes:
 * 1. **Global Streak**: Considers all subjects.
 * 2. **Custom Streak**: Based on a custom average configuration.
 * 3. **Specific Subject Streak**: Focuses on a particular subject.
 */
export function calculateStreak(
  subjects: Subject[],
  options?: {
    subjectId?: string;
    customAverage?: Average;
  }
): number {
  let relevantGrades: { date: Date; value: number; coefficient?: number }[] = [];

  // **Mode 1: Specific Subject Streak**
  if (options?.subjectId) {
    const subject = subjects.find((s) => s.id === options.subjectId);
    if (!subject) {
      console.warn(`Subject with ID ${options.subjectId} not found.`);
      return 0;
    }

    relevantGrades = subject.grades.map((grade) => ({
      date: new Date(grade.passedAt),
      value: (grade.value / grade.outOf) * 100,
      coefficient: grade.coefficient,
    }));
  }
  // **Mode 2: Custom Streak**
  else if (options?.customAverage) {
    const customConfig = buildCustomConfig(options.customAverage);
    const includedSubjects = subjects.filter((s) => isSubjectIncludedInCustomAverage(s, subjects, customConfig));

    includedSubjects.forEach((subject) => {
      subject.grades.forEach((grade) => {
        const percentage = (grade.value / grade.outOf) * 100;
        const coefficient = (grade.coefficient ?? 100) / 100;
        relevantGrades.push({
          date: new Date(grade.passedAt),
          value: percentage * coefficient,
          coefficient: grade.coefficient,
        });
      });
    });
  }
  // **Mode 3: Global Streak**
  else {
    subjects.forEach((subject) => {
      subject.grades.forEach((grade) => {
        const percentage = (grade.value / grade.outOf) * 100;
        const coefficient = (grade.coefficient ?? 100) / 100;
        relevantGrades.push({
          date: new Date(grade.passedAt),
          value: percentage * coefficient,
          coefficient: grade.coefficient,
        });
      });
    });
  }

  // **Sort Grades Chronologically**
  relevantGrades.sort((a, b) => a.date.getTime() - b.date.getTime());

  let streak = 0;
  let previousAverage: number | null = null;

  relevantGrades.forEach((grade) => {
    if (previousAverage === null) {
      previousAverage = grade.value;
      streak = 1;
      return;
    }

    const newAverage = (previousAverage + grade.value) / 2;

    if (newAverage > previousAverage) {
      streak += 1;
    } else if (newAverage < previousAverage) {
      streak = Math.max(streak - 1, 0);
    }

    previousAverage = newAverage;
  });

  return streak;
}

export function buildVirtualSubject(
  average: Average | null,
  subjects: Subject[]
): Subject {
  // For general average
  if (!average) {
    return buildGeneralAverageSubject();
  }

  // For custom averages
  const includedSubjects = subjects.filter(subject =>
    average.subjects.some(avgSubj => {
      if (avgSubj.id === subject.id) {
        return true;
      }
      // Check if parent subject and includeChildren is true
      if (avgSubj.includeChildren) {
        const parents = getParents(subjects, subject.id);
        return parents.includes(avgSubj.id);
      }
      return false;
    })
  );

  return {
    id: average.id,
    name: average.name,
    parentId: null,
    coefficient: 100,
    isDisplaySubject: true,
    depth: 0,
    grades: [],
    createdAt: new Date(),
    userId: "",
    isMainSubject: false,
    yearId: average.yearId,
  };
}

export function buildGeneralAverageSubject(): Subject {
  return {
    id: "general-average",
    name: "General Average",
    parentId: null,
    coefficient: 100,
    isDisplaySubject: true,
    depth: 0,
    grades: [],
    createdAt: new Date(),
    userId: "",
    isMainSubject: false,
    yearId: "buildGeneralAverageSubjectId",
  };
}

export function addGeneralAverageToSubjects(
  subjects: Subject[],
  customAverage?: Average
): Subject[] {
  if (!customAverage) {
    // Handle general average case
    const modifiedSubjects = subjects.map(subject => ({
      ...subject,
      depth: subject.depth + 1,
      parentId: subject.parentId === null ? "general-average" : subject.parentId
    }));
    return [buildGeneralAverageSubject(), ...modifiedSubjects];
  }

  // Handle custom average case
  const includedSubjects = subjects.filter(subject =>
    customAverage.subjects.some(avgSubj => {
      if (avgSubj.id === subject.id) {
        return true;
      }
      // Check if parent subject and includeChildren is true
      if (avgSubj.includeChildren) {
        const parents = getParents(subjects, subject.id);
        return parents.includes(avgSubj.id);
      }
      return false;
    })
  );

  // Modify subjects with custom coefficients if specified
  const modifiedSubjects = includedSubjects.map(subject => {
    const customSubject = customAverage.subjects.find(s => s.id === subject.id);
    return {
      ...subject,
      depth: 1,
      parentId: customAverage.id,
      // Override coefficient if custom coefficient is specified
      coefficient: customSubject?.customCoefficient != null
        ? customSubject!.customCoefficient * 100
        : subject.coefficient
    };
  });

  return [buildVirtualSubject(customAverage, subjects), ...modifiedSubjects];
}