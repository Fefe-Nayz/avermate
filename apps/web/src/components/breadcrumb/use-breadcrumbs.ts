"use client"

import { useMemo, type ReactNode } from "react"
import { usePathname, useSearchParams } from "next/navigation"
import { useExtracted } from "next-intl"
import { useQuery } from "@tanstack/react-query"
import { useMaybeYear } from "@/components/year/year-provider"
import {
  materialFolderTrail,
  type MaterialFolderLike,
} from "@/components/materials/materials-model"
import {
  MATERIALS_FOLDER_PARAM,
  MATERIALS_OPEN_PARAM,
  MATERIALS_TAG_PARAM,
  materialsLocationHref,
  parseMaterialsLocation,
} from "@/components/materials/materials-location"
import { orpc } from "@/lib/orpc"
import { COMMON_QUERY_STALE_TIME } from "@/lib/query-policy"
import {
  lectureRecordingsInput,
  materialTagsInput,
  materialsDocumentsInput,
  materialsFoldersInput,
  studyDocumentsInput,
} from "@/lib/route-query-inputs"

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
  const searchParams = useSearchParams()
  const t = useExtracted()
  const year = useMaybeYear()
  const yearId = year?.yearId ?? ""

  // The materials browser puts the folder you are in in the address, so the
  // trail can say where that is. Only that screen pays for the read, and it has
  // already prefetched the same query, so this resolves from the cache.
  const inMaterials = pathname === "/materials"
  const folderParam = searchParams.get(MATERIALS_FOLDER_PARAM)
  const tagParam = searchParams.get(MATERIALS_TAG_PARAM)
  const openParam = searchParams.get(MATERIALS_OPEN_PARAM)
  const materialFolders = useQuery({
    ...orpc.materials.folders.list.queryOptions({
      input: materialsFoldersInput(yearId),
    }),
    enabled: inMaterials && Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  /*
   * Named, not numbered.
   *
   * A study project's trail said "Projet" and a marked copy said "Copie
   * corrigée" — the same words on every one of them, which is a label for the
   * *kind* of page, not for the page you are on. These resolve the real title,
   * gated on the route so only that screen pays for the read.
   */
  /*
   * The conversation is in `?thread=`, not in the path, so the trail has to
   * read the query to say which one you are in. Without it every conversation
   * announced itself as "Assistant".
   */
  const inAssistant = pathname === "/assistant"
  const threadParam = searchParams.get("thread") ?? ""
  const threadsQuery = useQuery({
    ...orpc.assistant.threads.list.queryOptions({
      input: {
        limit: 30,
        includeArchived: true,
        includeDeleted: false,
        starredOnly: false,
      },
    }),
    enabled: inAssistant && Boolean(threadParam),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const threadTitle =
    (
      threadsQuery.data as
        | { items?: ReadonlyArray<{ thread: { id: string; title: string } }> }
        | undefined
    )?.items?.find((item) => item.thread.id === threadParam)?.thread.title ?? ""

  const inProjects = pathname.startsWith("/projects/")
  const projectId = inProjects ? (pathname.split("/")[2] ?? "") : ""
  const projectQuery = useQuery({
    ...orpc.projects.list.queryOptions({ input: { include: "all" } }),
    enabled: inProjects && Boolean(projectId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const projectTitle =
    (
      projectQuery.data as
        ReadonlyArray<{ id: string; title: string }> | undefined
    )?.find((item) => item.id === projectId)?.title ?? ""

  const inCopies = pathname.startsWith("/learning/copies/")
  const analysisId = inCopies ? (pathname.split("/")[3] ?? "") : ""
  const copiesQuery = useQuery({
    ...orpc.learning.copies.list.queryOptions({ input: { yearId } }),
    enabled: inCopies && Boolean(analysisId) && Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const copyTitle =
    (
      copiesQuery.data as
        | { items?: ReadonlyArray<{ id: string; title?: string | null }> }
        | undefined
    )?.items?.find((item) => item.id === analysisId)?.title ?? ""

  const folders = useMemo(
    () => (materialFolders.data ?? []) as readonly MaterialFolderLike[],
    [materialFolders.data]
  )
  // A tag is a location too, and its crumb has to say the tag's name rather
  // than its id. Same cache the browser fills, so this costs nothing there.
  const materialTags = useQuery({
    ...orpc.materials.tags.list.queryOptions({
      input: materialTagsInput(yearId),
    }),
    enabled: inMaterials && Boolean(tagParam) && Boolean(yearId),
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const tagName = useMemo(() => {
    const names = new Map(
      (materialTags.data ?? []).map((tag) => [tag.id, tag.name])
    )
    return (tagId: string) => names.get(tagId) ?? null
  }, [materialTags.data])

  /**
   * The name of the document being read.
   *
   * A trail that ends at the folder while the pane shows a document is a trail
   * that stops one step short of where you are. The three lists are the same
   * ones the browser has already fetched, so on that screen this is a cache
   * read; anywhere else it never runs.
   */
  const readingSomething = inMaterials && Boolean(openParam) && Boolean(yearId)
  const openDocuments = useQuery({
    ...orpc.materials.documents.list.queryOptions({
      input: materialsDocumentsInput(yearId),
    }),
    enabled: readingSomething,
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const openStudy = useQuery({
    ...orpc.documents.list.queryOptions({
      input: studyDocumentsInput(yearId),
    }),
    enabled: readingSomething,
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const openRecordings = useQuery({
    ...orpc.recordings.list.queryOptions({
      input: lectureRecordingsInput(yearId),
    }),
    enabled: readingSomething,
    staleTime: COMMON_QUERY_STALE_TIME,
  })
  const openTitle = useMemo(() => {
    if (!openParam) return null
    const document = (openDocuments.data ?? []).find(
      (row) => row.document.id === openParam
    )
    if (document) return document.document.title
    const study = (openStudy.data ?? []).find((row) => row.id === openParam)
    if (study) return study.title
    const recording = (openRecordings.data ?? []).find(
      (row) => row.id === openParam
    )
    return recording?.title ?? null
  }, [openParam, openDocuments.data, openStudy.data, openRecordings.data])

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

      case "materials": {
        const crumbs: Crumb[] = [
          { key: "materials", label: t("Materials"), href: "/materials" },
        ]
        const section = segments[1]

        // A sheet or a recording is a document you opened, not a place in the
        // folder tree, so its trail stops at the browser it came from.
        if (section === "fiches" || section === "recordings") {
          const isNew = segments[2] === "new"
          crumbs.push({
            key: section,
            label:
              section === "fiches"
                ? isNew
                  ? t("New study document")
                  : t("Study document")
                : isNew
                  ? t("New recording")
                  : t("Recording"),
          })
          return crumbs
        }
        // Tags are managed on their own screens, and they hang off Supports
        // rather than off a folder — a tag is not in the tree.
        if (section === "tags") {
          crumbs.push({
            key: "tags",
            label: t("Tags"),
            href: segments[2] ? "/materials/tags" : undefined,
          })
          if (segments[2] === "new") {
            crumbs.push({ key: "new", label: t("New tag") })
          } else if (segments[2]) {
            crumbs.push({ key: segments[2], label: t("Edit tag") })
          }
          return crumbs
        }
        if (section) return crumbs

        const location = parseMaterialsLocation(folderParam, tagParam)
        if (location.kind === "root") return crumbs
        // The row-shaped places are one step, not a trail: none of them sits
        // inside a folder, so there is nothing above them to walk back to.
        if (location.kind !== "folder") {
          crumbs.push({
            key: location.kind,
            label:
              location.kind === "all"
                ? t("Everything")
                : location.kind === "starred"
                  ? t("Favourites")
                  : location.kind === "trash"
                    ? t("Bin")
                    : (tagName(location.tagId) ?? t("Tag")),
            href: openParam ? materialsLocationHref(location) : undefined,
          })
          if (openParam) {
            crumbs.push({ key: openParam, label: openTitle ?? t("Document") })
          }
          return crumbs
        }

        // Every folder above the one you are in is a step you can take back to,
        // which is the whole reason the trail is worth having.
        const trail = materialFolderTrail(folders, location.folderId)
        for (const [index, folder] of trail.entries()) {
          // The folder you are in is the end of the trail only when nothing is
          // open in it: a document adds one more step, and then the folder
          // becomes a link back rather than the last word.
          const last = index === trail.length - 1 && !openParam
          crumbs.push({
            key: folder.id,
            label: folder.name,
            href: last
              ? undefined
              : materialsLocationHref({ kind: "folder", folderId: folder.id }),
            siblings: folders
              .filter((sibling) => sibling.parentId === folder.parentId)
              .map((sibling) => ({
                key: sibling.id,
                label: sibling.name,
                href: materialsLocationHref({
                  kind: "folder",
                  folderId: sibling.id,
                }),
              })),
          })
        }
        if (openParam) {
          crumbs.push({ key: openParam, label: openTitle ?? t("Document") })
        }
        return crumbs
      }

      case "planning": {
        // It had no case at all, so the trail read a literal "planning" — the
        // one area of the app whose breadcrumb named a URL segment rather than
        // a screen.
        const crumbs: Crumb[] = [
          { key: "planning", label: t("Planning"), href: "/planning" },
        ]
        const section = segments[1]
        const labels: Record<string, string> = {
          agenda: t("Class agenda"),
          tasks: t("Tasks"),
          calendar: t("Calendar"),
        }
        if (section && labels[section]) {
          crumbs.push({
            key: section,
            label: labels[section] as string,
            // The section stops being the last crumb once you are inside a
            // form, so it becomes a way back rather than a dead end.
            href: segments[2] ? `/planning/${section}` : undefined,
            siblings: Object.entries(labels).map(([key, label]) => ({
              key,
              label,
              href: `/planning/${key}`,
            })),
          })
        }

        // The creation and edit screens, which are pages now rather than
        // panels that unfolded inside the list.
        const leaf = segments[2]
        if (leaf === "new") {
          crumbs.push({
            key: "new",
            label:
              section === "tasks"
                ? t("New task")
                : section === "agenda"
                  ? t("New homework")
                  : t("New calendar item"),
          })
        } else if (leaf && segments[3] === "edit") {
          crumbs.push({
            key: "edit",
            label: section === "tasks" ? t("Edit task") : t("Edit homework"),
          })
        }
        return crumbs
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
          node: t("Avermate Node"),
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

      case "assistant": {
        const crumbs: Crumb[] = [
          { key: "assistant", label: t("Assistant"), href: "/assistant" },
        ]
        if (segments[1] === "actions") {
          crumbs.push({ key: "actions", label: t("Action activity") })
          return crumbs
        }
        if (threadTitle) crumbs.push({ key: "thread", label: threadTitle })
        return crumbs
      }

      case "learning": {
        const crumbs: Crumb[] = [
          { key: "learning", label: t("Learning"), href: "/learning" },
        ]
        if (segments[1] === "copies")
          crumbs.push({
            key: "copy",
            label: copyTitle || t("Marked work"),
          })
        if (segments[1] === "objectives")
          crumbs.push({ key: "objective", label: t("Objective") })
        return crumbs
      }

      case "projects": {
        const crumbs: Crumb[] = [
          { key: "projects", label: t("Study projects"), href: "/projects" },
        ]
        if (segments[1])
          crumbs.push({ key: "project", label: projectTitle || t("Project") })
        return crumbs
      }

      case "agenda": {
        const crumbs: Crumb[] = [
          { key: "agenda", label: t("Agenda"), href: "/agenda" },
        ]
        if (segments[1] === "new")
          crumbs.push({ key: "new", label: t("New entry") })
        else if (segments[2] === "edit")
          crumbs.push({ key: "edit", label: t("Edit entry") })
        return crumbs
      }

      case "averages":
        return [
          { key: "averages", label: t("Averages"), href: "/dashboard" },
          ...(segments[1] ? [{ key: "average", label: t("Average") }] : []),
        ]

      case "announcements":
        return [{ key: "announcements", label: t("Announcements") }]

      case "review":
        return [{ key: "review", label: t("Year review") }]

      case "more":
        return [{ key: "more", label: t("More") }]

      default:
        /*
         * A route with no case here used to print its own path segment —
         * "learning", "projects", lowercase and untranslated — straight into
         * the trail. Title-casing it is still a guess, but it is a guess that
         * reads like a page name rather than like a URL.
         */
        return [
          { key: root, label: root.charAt(0).toUpperCase() + root.slice(1) },
        ]
    }
  }, [
    copyTitle,
    threadTitle,
    folderParam,
    projectTitle,
    folders,
    openParam,
    openTitle,
    pathname,
    t,
    tagName,
    tagParam,
    year,
  ])
}
