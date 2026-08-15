"use client"

import { useMemo, type ReactNode } from "react"
import { usePathname } from "next/navigation"
import { useExtracted } from "next-intl"
import { useMaybeYear } from "@/components/year/year-provider"

/**
 * One step of the trail. `siblings` is what makes the separator before a
 * crumb worth clicking: it opens the other subjects at that level.
 */
export interface Crumb {
  key: string
  label: string
  href?: string
  icon?: ReactNode
  siblings?: Array<{ key: string; label: string; href: string }>
}

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
      case "dashboard": {
        if (segments[1] === "cards") {
          return [
            { key: "dashboard", label: t("Dashboard"), href: "/dashboard" },
            {
              key: "card",
              label: segments[2] === "new" ? t("New card") : t("Edit card"),
            },
          ]
        }
        return [{ key: "dashboard", label: t("Dashboard") }]
      }

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

      case "averages": {
        const averageId = segments[1]
        const average = year?.customAverages.find(
          (candidate) => candidate.id === averageId
        )
        return [
          {
            key: "averages",
            label: t("Averages"),
            href: "/settings/averages",
          },
          {
            key: averageId ?? "general",
            label:
              averageId === "general"
                ? t("General average")
                : (average?.name ?? t("Average")),
            siblings: [
              {
                key: "general",
                label: t("General average"),
                href: "/averages/general",
              },
              ...(year?.customAverages.map((item) => ({
                key: item.id,
                label: item.name,
                href: `/averages/${item.id}`,
              })) ?? []),
            ],
          },
        ]
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

      case "insights": {
        if (segments[1] === "cards") {
          return [
            { key: "insights", label: t("Insights"), href: "/insights" },
            {
              key: "card",
              label: segments[2] === "new" ? t("New card") : t("Edit card"),
            },
          ]
        }
        return [{ key: "insights", label: t("Insights") }]
      }

      case "review":
        return [{ key: "review", label: t("Year in review") }]

      case "announcements":
        return [{ key: "announcements", label: t("Announcements") }]

      case "more":
        return [{ key: "more", label: t("More") }]

      case "social": {
        const crumbs: Crumb[] = [
          { key: "social", label: t("Social"), href: "/social" },
        ]
        const section = segments[1]
        const labels: Record<string, string> = {
          friends: t("Friends"),
          groups: t("Classes"),
          profile: t("Sharing"),
          notifications: t("Updates"),
          invitations: t("Invitation"),
          invitation: t("Invitation"),
          guardian: t("Guardian consent"),
        }
        if (section && labels[section]) {
          crumbs.push({ key: section, label: labels[section] as string })
        }
        return crumbs
      }

      case "settings": {
        const crumbs: Crumb[] = [
          { key: "settings", label: t("Settings"), href: "/settings" },
        ]
        const section = segments[1]
        const labels: Record<string, string> = {
          appearance: t("Appearance"),
          navigation: t("Navigation"),
          year: t("Year & periods"),
          preset: t("Year preset"),
          averages: t("Custom averages"),
          account: t("Account"),
          integrations: t("Integrations"),
          social: t("Social & sharing"),
          cards: t("Cards"),
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
          presets: t("Curriculum presets"),
          "card-templates": t("Card gallery"),
          social: t("Social moderation"),
        }
        if (section && labels[section]) {
          crumbs.push({
            key: section,
            label: labels[section] as string,
            href:
              section === "social"
                ? "/admin/social"
                : section === "card-templates" && segments[2]
                  ? "/admin/card-templates"
                  : undefined,
          })
        }
        if (section === "card-templates" && segments[2] === "new") {
          crumbs.push({ key: "card-templates-new", label: t("New template") })
        }
        if (section === "social") {
          const socialSection = segments[2]
          const socialLabels: Record<string, string> = {
            groups: t("Classes"),
            reports: t("Reports"),
            audit: t("Audit trail"),
          }
          if (socialSection && socialLabels[socialSection]) {
            crumbs.push({
              key: `social-${socialSection}`,
              label: socialLabels[socialSection] as string,
            })
          }
        }
        return crumbs
      }

      default:
        return [{ key: root, label: root }]
    }
  }, [pathname, t, year])
}
