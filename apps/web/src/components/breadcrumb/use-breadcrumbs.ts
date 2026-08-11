"use client"

import { useMemo } from "react"
import { usePathname } from "next/navigation"
import { useExtracted } from "next-intl"
import { useMaybeYear } from "@/components/year/year-provider"
import type { Crumb } from "./responsive-breadcrumb"

/**
 * The trail for the current route.
 *
 * Subjects nest, so their crumbs follow the real tree rather than the URL —
 * "Subjects / Science / Physics / Written" for a page whose path is just
 * `/subjects/<id>`. Each crumb also carries its siblings, which is what makes
 * the separators worth clicking.
 */
export function useBreadcrumbs(): Crumb[] {
  const pathname = usePathname()
  const t = useExtracted()
  const year = useMaybeYear()

  return useMemo(() => {
    const segments = pathname.split("/").filter(Boolean)
    if (segments.length === 0) return []

    const root = segments[0] as string
    const graph = year?.yearGraph

    const siblingsOf = (parentId: string | null) =>
      graph?.childrenOf(parentId).map((subject) => ({
        key: subject.id,
        label: subject.name,
        href: `/subjects/${subject.id}`,
      })) ?? []

    switch (root) {
      case "dashboard":
        return [{ key: "dashboard", label: t("Dashboard") }]

      case "subjects": {
        const crumbs: Crumb[] = [
          { key: "subjects", label: t("Subjects"), href: "/subjects" },
        ]
        const subjectId = segments[1]
        if (!subjectId || !graph) return crumbs

        const subject = graph.byId(subjectId)
        if (!subject) return crumbs

        const lineage = [...graph.ancestorsOf(subject.id).reverse(), subject]
        for (const node of lineage) {
          crumbs.push({
            key: node.id,
            label: node.name,
            href: node.id === subject.id ? undefined : `/subjects/${node.id}`,
            siblings: siblingsOf(node.parentId),
          })
        }
        return crumbs
      }

      case "grades": {
        const crumbs: Crumb[] = [
          { key: "grades", label: t("Grades"), href: "/grades" },
        ]
        const gradeId = segments[1]
        if (!gradeId || !graph) return crumbs
        if (gradeId === "new") {
          crumbs.push({ key: "new", label: t("New grade") })
          return crumbs
        }

        const grade = graph
          .allGrades()
          .find((candidate) => candidate.id === gradeId)
        if (!grade) return crumbs

        const subject = graph.byId(grade.subjectId)
        if (subject) {
          crumbs.push({
            key: subject.id,
            label: subject.name,
            href: `/subjects/${subject.id}`,
            siblings: siblingsOf(subject.parentId),
          })
        }
        crumbs.push({
          key: grade.id,
          label: grade.name,
          siblings:
            subject?.grades.map((sibling) => ({
              key: sibling.id,
              label: sibling.name,
              href: `/grades/${sibling.id}`,
            })) ?? [],
        })
        return crumbs
      }

      case "goals": {
        const crumbs: Crumb[] = [
          { key: "goals", label: t("Goals"), href: "/goals" },
        ]
        const goalId = segments[1]
        if (!goalId) return crumbs
        if (goalId === "new") {
          crumbs.push({ key: "new", label: t("New goal") })
          return crumbs
        }
        const goal = year?.goals.find((candidate) => candidate.id === goalId)
        crumbs.push({
          key: goalId,
          label: goal?.name ?? t("Goal"),
          siblings:
            year?.goals.map((sibling) => ({
              key: sibling.id,
              label: sibling.name,
              href: `/goals/${sibling.id}`,
            })) ?? [],
        })
        return crumbs
      }

      case "insights":
        return [{ key: "insights", label: t("Insights") }]

      case "review":
        return [{ key: "review", label: t("Year in review") }]

      case "settings": {
        const crumbs: Crumb[] = [
          { key: "settings", label: t("Settings"), href: "/settings" },
        ]
        const section = segments[1]
        const labels: Record<string, string> = {
          appearance: t("Appearance"),
          year: t("Year & periods"),
          averages: t("Custom averages"),
          account: t("Account"),
          about: t("About"),
        }
        if (section && labels[section]) {
          crumbs.push({ key: section, label: labels[section] as string })
        }
        return crumbs
      }

      case "admin": {
        const crumbs: Crumb[] = [
          { key: "admin", label: t("Admin"), href: "/admin" },
        ]
        const section = segments[1]
        const labels: Record<string, string> = {
          users: t("Users"),
          announcements: t("Announcements"),
          feedback: t("Feedback"),
        }
        if (section && labels[section]) {
          crumbs.push({ key: section, label: labels[section] as string })
        }
        return crumbs
      }

      default:
        return [{ key: root, label: root }]
    }
  }, [pathname, t, year])
}
