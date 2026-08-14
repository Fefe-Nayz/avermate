"use client"

import Link from "next/link"
import { useState } from "react"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import {
  CheckIcon,
  PencilRulerIcon,
  PlusIcon,
  RotateCcwIcon,
} from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { CardGrid } from "@/components/cards/card-grid"
import { Button } from "@/components/ui/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { PageActions, PageMeta } from "@/components/shell/page-chrome"
import { PeriodRail, PeriodSwitcher } from "@/components/shell/period-switcher"
import { useYear } from "@/components/year/year-provider"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * Insights is the user's analytical workspace. The same declarative widgets
 * used by the dashboard live here, with more room for charts and formulas.
 * An empty surface is intentional; recommendations only return on request.
 */
export default function InsightsPage() {
  const t = useExtracted()
  const queryClient = useQueryClient()
  const { cards, yearId } = useYear()
  const [editing, setEditing] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const hasInsights = cards.some((card) => card.surface === "insights")

  const reset = useMutation({
    ...orpc.cards.reset.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Recommended insights restored"))
      setConfirmReset(false)
      void queryClient.invalidateQueries({
        queryKey: orpc.snapshot.get.queryKey({
          input: { yearId: yearId ?? "" },
        }),
      })
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("Insights could not be restored."))
    },
  })

  const toggleEditing = () => {
    haptic("selection")
    setEditing((current) => !current)
  }

  return (
    <>
      <PageMeta title={t("Insights")} />
      <PageActions>
        {hasInsights ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t("Restore recommended insights")}
            onClick={() => setConfirmReset(true)}
          >
            <RotateCcwIcon className="size-4" />
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          aria-label={editing ? t("Done") : t("Customise Insights")}
          onClick={toggleEditing}
        >
          {editing ? (
            <CheckIcon className="size-4" />
          ) : (
            <PencilRulerIcon className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Add an insight")}
          render={<Link href="/insights/cards/new" />}
        >
          <PlusIcon className="size-4" />
        </Button>
      </PageActions>

      <div className="flex flex-col gap-5">
        <div className="hidden items-center justify-between gap-3 md:flex">
          <h1 className="text-2xl font-semibold tracking-tight">
            {t("Insights")}
          </h1>
          <div className="flex items-center gap-2">
            {hasInsights ? (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmReset(true)}
              >
                <RotateCcwIcon className="size-4" />
                {t("Restore recommended")}
              </Button>
            ) : null}
            <Button
              variant={editing ? "default" : "outline"}
              size="sm"
              onClick={toggleEditing}
            >
              {editing ? (
                <>
                  <CheckIcon className="size-4" />
                  {t("Done")}
                </>
              ) : (
                <>
                  <PencilRulerIcon className="size-4" />
                  {t("Customise")}
                </>
              )}
            </Button>
            <Button size="sm" render={<Link href="/insights/cards/new" />}>
              <PlusIcon className="size-4" />
              {t("Add insight")}
            </Button>
          </div>
        </div>

        <div className="-mx-4 md:hidden">
          <PeriodRail />
        </div>
        <div className="hidden md:block">
          <PeriodSwitcher variant="ghost" className="-ml-2" />
        </div>

        <CardGrid editing={editing} surface="insights" />
      </div>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("Restore recommended insights?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t(
                "This replaces the current Insights layout with the recommended analyses."
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("Cancel")}</AlertDialogCancel>
            <AlertDialogAction
              disabled={!yearId || reset.isPending}
              onClick={() =>
                reset.mutate({ yearId: yearId as string, surface: "insights" })
              }
            >
              {t("Restore")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
