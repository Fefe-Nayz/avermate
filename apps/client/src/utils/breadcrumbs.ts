import { Period } from "@/types/period";
import { Grade } from "@/types/grade";
import { Subject } from "@/types/subject";
import { getParents } from "@/utils/average";

export interface BreadcrumbItem {
  key: string;
  label: string;
  href: string;
  clickable: boolean;
}

interface BreadcrumbTranslations {
  overview: string;
  grades: string;
  generalAverage?: string;
}

function buildSubjectHierarchy(
  subject: Subject,
  allSubjects: Subject[],
  period: Period,
  basePath: string = "/dashboard/subjects"
): BreadcrumbItem[] {
  if (!subject || !allSubjects) return [];

  const hierarchy: BreadcrumbItem[] = [];

  // Get all parent IDs for this subject
  const parentIds = getParents(allSubjects, subject.id);

  // Build the hierarchy from root to current subject
  const buildPath = (currentSubject: Subject): BreadcrumbItem[] => {
    const path: BreadcrumbItem[] = [];

    // If this subject has a parent, add the parent first
    if (currentSubject.parentId) {
      const parentSubject = allSubjects.find(
        (s) => s.id === currentSubject.parentId
      );
      if (parentSubject) {
        path.push(...buildPath(parentSubject));
      }
    }

    // Add current subject
    path.push({
      key: `subject-${currentSubject.id}`,
      label: currentSubject.name,
      href: `${basePath}/${currentSubject.id}/${period.id}`,
      clickable: true,
    });

    return path;
  };

  return buildPath(subject);
}

export function createGradeBreadcrumbs(
  grade: Grade,
  period: Period,
  periodId: string,
  allSubjects: Subject[],
  translations: BreadcrumbTranslations
): BreadcrumbItem[] {
  const breadcrumbs: BreadcrumbItem[] = [
    {
      key: "dashboard",
      label: translations.overview,
      href: "/dashboard",
      clickable: true,
    },
    {
      key: "grades",
      label: translations.grades,
      href: "/dashboard/grades",
      clickable: true,
    },
  ];

  // Find the subject this grade belongs to
  const gradeSubject = allSubjects?.find((s) => s.id === grade.subjectId);

  if (gradeSubject) {
    // Add the complete subject hierarchy
    const subjectHierarchy = buildSubjectHierarchy(
      gradeSubject,
      allSubjects,
      period,
      "/dashboard/subjects"
    );
    breadcrumbs.push(...subjectHierarchy);
  }

  // Add the grade as the final item
  breadcrumbs.push({
    key: "grade",
    label: grade.name,
    href: "",
    clickable: false,
  });

  return breadcrumbs;
}

export function createSubjectBreadcrumbs(
  subject: Subject,
  period: Period,
  allSubjects: Subject[],
  translations: BreadcrumbTranslations
): BreadcrumbItem[] {
  const breadcrumbs: BreadcrumbItem[] = [
    {
      key: "dashboard",
      label: translations.overview,
      href: "/dashboard",
      clickable: true,
    },
    {
      key: "grades",
      label: translations.grades,
      href: "/dashboard/grades",
      clickable: true,
    },
  ];

  // Handle virtual subjects (general average, custom averages)
  if (subject?.id === "general-average") {
    breadcrumbs.push({
      key: "general-average",
      label: translations.generalAverage || "General Average",
      href: "",
      clickable: false,
    });
    return breadcrumbs;
  }

  if (subject?.id.startsWith("ca")) {
    breadcrumbs.push({
      key: "custom-average",
      label: subject.name,
      href: "",
      clickable: false,
    });
    return breadcrumbs;
  }

  // Build the complete subject hierarchy
  const subjectHierarchy = buildSubjectHierarchy(
    subject,
    allSubjects,
    period,
    "/dashboard/subjects"
  );

  // Add all but the last item (current subject) as clickable
  const hierarchyItems = subjectHierarchy.map((item, index) => ({
    ...item,
    clickable: index < subjectHierarchy.length - 1,
  }));

  // Set the last item as non-clickable (current page)
  if (hierarchyItems.length > 0) {
    hierarchyItems[hierarchyItems.length - 1].clickable = false;
    hierarchyItems[hierarchyItems.length - 1].href = "";
  }

  breadcrumbs.push(...hierarchyItems);

  return breadcrumbs;
}

// Helper function to get child subjects for navigation dropdowns
export function getChildSubjects(
  parentSubjectId: string,
  allSubjects: Subject[],
  period: Period
): { label: string; href: string }[] {
  return allSubjects
    .filter((subject) => subject.parentId === parentSubjectId)
    .map((subject) => ({
      label: subject.name,
      href: `/dashboard/subjects/${subject.id}/${period.id}`,
    }));
}

// Helper function to get grades for a subject for navigation dropdowns
export function getSubjectGrades(
  subjectId: string,
  allSubjects: Subject[],
  period: Period
): { label: string; href: string }[] {
  const subject = allSubjects.find((s) => s.id === subjectId);
  if (!subject) return [];

  return subject.grades
    .filter(
      (grade) => period.id === "full-year" || grade.periodId === period.id
    )
    .map((grade) => ({
      label: grade.name,
      href: `/dashboard/grades/${grade.id}/${period.id}`,
    }));
}
