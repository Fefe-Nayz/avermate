"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useState } from "react"
import { ChevronRightIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible"
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@/components/ui/sidebar"
import { useYear } from "@/components/year/year-provider"
import { AverageValue } from "@/components/data/value"
import type { Subject } from "@avermate/core"

/**
 * The year's headline subjects, in the sidebar, with their current average.
 *
 * Only the subjects marked as main appear: the point is a glance at what
 * matters, not a second copy of the subjects screen.
 */
export function SidebarSubjectTree() {
  const t = useExtracted()
  const pathname = usePathname()
  const { graph, subjects } = useYear()
  const { state } = useSidebar()
  const [open, setOpen] = useState<Record<string, boolean>>({})

  if (state === "collapsed") return null

  const featured = subjects.filter((subject) => subject.isMain)
  const shown: Subject[] =
    featured.length > 0
      ? featured
      : (graph.roots
          .filter((subject) => subject.kind !== "category")
          .slice(0, 6) as Subject[])

  if (shown.length === 0) return null

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t("Your subjects")}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {shown.map((subject) => {
            const children = graph.childrenOf(subject.id)
            const active = pathname === `/subjects/${subject.id}`
            const ratio = graph.ratio(subject.id)

            if (children.length === 0) {
              return (
                <SidebarMenuItem key={subject.id}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={active}
                    render={<Link href={`/subjects/${subject.id}`} />}
                  >
                    <span className="truncate">{subject.name}</span>
                    <AverageValue
                      ratio={ratio}
                      animate={false}
                      decimals={1}
                      colored
                      className="ml-auto text-xs"
                    />
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            }

            return (
              <Collapsible
                key={subject.id}
                open={open[subject.id] ?? active}
                onOpenChange={(value) =>
                  setOpen((current) => ({ ...current, [subject.id]: value }))
                }
                render={<SidebarMenuItem />}
              >
                <CollapsibleTrigger
                  render={<SidebarMenuButton size="sm" isActive={active} />}
                >
                  <ChevronRightIcon className="size-3.5 shrink-0 transition-transform duration-200 group-data-[panel-open]/collapsible:rotate-90" />
                  <span className="truncate">{subject.name}</span>
                  <AverageValue
                    ratio={ratio}
                    animate={false}
                    decimals={1}
                    colored
                    className="ml-auto text-xs"
                  />
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <SidebarMenuSub>
                    <SidebarMenuSubItem>
                      <SidebarMenuSubButton
                        isActive={active}
                        render={<Link href={`/subjects/${subject.id}`} />}
                      >
                        {t("Overview")}
                      </SidebarMenuSubButton>
                    </SidebarMenuSubItem>
                    {children.map((child) => (
                      <SidebarMenuSubItem key={child.id}>
                        <SidebarMenuSubButton
                          isActive={pathname === `/subjects/${child.id}`}
                          render={<Link href={`/subjects/${child.id}`} />}
                        >
                          <span className="truncate">{child.name}</span>
                        </SidebarMenuSubButton>
                      </SidebarMenuSubItem>
                    ))}
                  </SidebarMenuSub>
                </CollapsibleContent>
              </Collapsible>
            )
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  )
}
