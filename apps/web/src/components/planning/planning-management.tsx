"use client"

import {
  CloudIcon,
  CopyPlusIcon,
  EllipsisIcon,
  EyeOffIcon,
  LockKeyholeIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  planningItemIsManaged,
  providerLabel,
  type PlanningItem,
} from "./planning-model"

export function PlanningManagementBadges({ item }: { item: PlanningItem }) {
  const t = useExtracted()
  if (!planningItemIsManaged(item)) return null

  const label = providerLabel(item) ?? t("School service")
  return (
    <span className="inline-flex flex-wrap gap-1.5">
      <Badge
        variant="secondary"
        title={t("Managed by {provider}", { provider: label })}
      >
        <CloudIcon /> {label}
      </Badge>
      {item.management.lockedFields.length > 0 ? (
        <Badge
          variant="outline"
          title={t("{count} fields are managed by the school service", {
            count: String(item.management.lockedFields.length),
          })}
        >
          <LockKeyholeIcon /> {t("Locked")}
        </Badge>
      ) : null}
    </span>
  )
}

export function ManagedItemActions({
  item,
  pending,
  onDismiss,
  onDetach,
}: {
  item: PlanningItem
  pending?: boolean
  onDismiss: () => void
  onDetach: () => void
}) {
  const t = useExtracted()
  if (!planningItemIsManaged(item)) return null
  const label = providerLabel(item) ?? t("School service")

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={pending}
            aria-label={t("Actions for {title}", { title: item.title })}
          />
        }
      >
        <EllipsisIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuLabel>
          {t("Managed by {provider}", { provider: label })}
        </DropdownMenuLabel>
        <DropdownMenuItem onClick={onDetach}>
          <CopyPlusIcon />
          <span>
            {t("Detach as an editable copy")}
            <span className="block text-xs text-muted-foreground">
              {t("The synced original will be hidden.")}
            </span>
          </span>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onDismiss}>
          <EyeOffIcon />
          <span>
            {t("Hide this synced item")}
            <span className="block text-xs text-muted-foreground">
              {t("It will stay hidden after the next sync.")}
            </span>
          </span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
