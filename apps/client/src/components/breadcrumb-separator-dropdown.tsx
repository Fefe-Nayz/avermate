"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  DropDrawer,
  DropDrawerContent,
  DropDrawerGroup,
  DropDrawerItem,
  DropDrawerLabel,
  DropDrawerTrigger,
} from "@/components/ui/dropdrawer";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { Subject } from "@/types/subject";
import { Period } from "@/types/period";
import { getChildSubjects, getSubjectGrades } from "@/utils/breadcrumbs";
import { useIsMobile } from "@/hooks/use-mobile";

interface BreadcrumbSeparatorDropdownProps {
  prevKey: string;
  allSubjects: Subject[];
  period: Period;
}

export function BreadcrumbSeparatorDropdown({
  prevKey,
  allSubjects,
  period,
}: BreadcrumbSeparatorDropdownProps) {
  const isMobile = useIsMobile();

  const getNavigationItems = (key: string) => {
    // Dashboard level - show main sections
    if (key === "dashboard") {
      return {
        sections: [
          { label: "Overview", href: "/dashboard" },
          { label: "Grades", href: "/dashboard/grades" },
          { label: "Settings", href: "/dashboard/settings" },
        ],
        grades: [],
      };
    }

    // Grades level - show periods or subjects
    if (key === "grades") {
      // Show root subjects for quick navigation
      const rootSubjects = allSubjects
        .filter((subject) => !subject.parentId)
        .slice(0, 10) // Limit to avoid overwhelming dropdown
        .map((subject) => ({
          label: subject.name,
          href: `/dashboard/subjects/${subject.id}/${period.id}`,
        }));

      return {
        sections: rootSubjects,
        grades: [],
      };
    }

    // Subject level - show child subjects and grades
    if (key.startsWith("subject-")) {
      const subjectId = key.replace("subject-", "");

      const childSubjects = getChildSubjects(subjectId, allSubjects, period);
      const subjectGrades = getSubjectGrades(subjectId, allSubjects, period);

      return {
        sections: childSubjects,
        grades: subjectGrades,
      };
    }

    return {
      sections: [],
      grades: [],
    };
  };

  const { sections, grades } = getNavigationItems(prevKey);
  const hasItems = sections.length > 0 || grades.length > 0;

  // If no items, show simple separator
  if (!hasItems) {
    return (
      <li
        data-slot="breadcrumb-separator"
        role="presentation"
        aria-hidden="true"
        className="[&>svg]:size-3.5"
      >
        <ChevronRight />
      </li>
    );
  }

  if (isMobile) {
    return (
      <li data-slot="breadcrumb-separator" className="relative">
        <DropDrawer>
          <DropDrawerTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-7 group"
              aria-label="Open next level"
            >
              <ChevronRight className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-90" />
            </Button>
          </DropDrawerTrigger>
          <DropDrawerContent>
            {sections.length > 0 && (
              <DropDrawerGroup>
                {sections.length > 0 && grades.length > 0 && (
                  <DropDrawerLabel>Subjects</DropDrawerLabel>
                )}
                {sections.map((item, index) => (
                  <Link key={`section-${item.href}-${index}`} href={item.href}>
                    <DropDrawerItem>{item.label}</DropDrawerItem>
                  </Link>
                ))}
              </DropDrawerGroup>
            )}

            {grades.length > 0 && (
              <DropDrawerGroup>
                {sections.length > 0 && grades.length > 0 && (
                  <DropDrawerLabel>Grades</DropDrawerLabel>
                )}
                {grades.map((item, index) => (
                  <Link key={`grade-${item.href}-${index}`} href={item.href}>
                    <DropDrawerItem>{item.label}</DropDrawerItem>
                  </Link>
                ))}
              </DropDrawerGroup>
            )}
          </DropDrawerContent>
        </DropDrawer>
      </li>
    );
  }

  return (
    <li data-slot="breadcrumb-separator" className="relative">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 group"
            aria-label="Open next level"
          >
            <ChevronRight className="size-3.5 transition-transform duration-200 group-data-[state=open]:rotate-90" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="max-h-[300px] overflow-y-auto"
        >
          {sections.length > 0 && (
            <>
              {sections.length > 0 && grades.length > 0 && (
                <DropdownMenuLabel>Subjects</DropdownMenuLabel>
              )}
              {sections.map((item, index) => (
                <DropdownMenuItem key={`section-${item.href}-${index}`} asChild>
                  <Link href={item.href} className="text-sm">
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
              {grades.length > 0 && <DropdownMenuSeparator />}
            </>
          )}

          {grades.length > 0 && (
            <>
              {sections.length > 0 && grades.length > 0 && (
                <DropdownMenuLabel>Grades</DropdownMenuLabel>
              )}
              {grades.map((item, index) => (
                <DropdownMenuItem key={`grade-${item.href}-${index}`} asChild>
                  <Link href={item.href} className="text-sm">
                    {item.label}
                  </Link>
                </DropdownMenuItem>
              ))}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  );
}
