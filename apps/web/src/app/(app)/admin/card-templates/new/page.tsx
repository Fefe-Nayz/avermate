"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { WIDGET_DEFINITION_VERSION, type WidgetSurface } from "@avermate/core"
import { WidgetForm } from "@/components/cards/widget-form"
import { ChoiceField } from "@/components/forms/controls"
import { haptic } from "@/lib/haptics"
import { orpc } from "@/lib/orpc"

/**
 * A template drafted from nothing: the same editor that builds personal
 * cards, saving into the catalog instead of onto a dashboard. The surface
 * question opens the flow because changing the answer restarts the
 * definition — it decides which marks and layouts even exist.
 */
export default function AdminNewCardTemplatePage() {
  const t = useExtracted()
  const router = useRouter()
  const queryClient = useQueryClient()
  const [surface, setSurface] = useState<WidgetSurface>("overview")

  const create = useMutation({
    ...orpc.cardTemplates.create.mutationOptions(),
    onSuccess: () => {
      haptic("success")
      toast.success(t("Draft created"))
      void queryClient.invalidateQueries({
        queryKey: orpc.cardTemplates.adminList.queryKey(),
      })
      router.push("/admin/card-templates")
    },
    onError: (error: Error) => {
      haptic("error")
      toast.error(error.message || t("That did not work."))
    },
  })

  return (
    <WidgetForm
      key={surface}
      mode="create"
      surface={surface}
      submission={{
        title: t("New template"),
        description: t(
          "The full card editor, saving a draft into the gallery. References to your own entities become the installer's choices."
        ),
        backHref: "/admin/card-templates",
        submitLabel: t("Create the draft"),
        pending: create.isPending,
        submit: (definition, title) =>
          create.mutate({
            title,
            description: "",
            surfaces: [surface],
            category: "general",
            definitionVersion: WIDGET_DEFINITION_VERSION,
            definitionJson: definition as unknown as Record<string, unknown>,
            sortOrder: 0,
          }),
        leadStep: {
          id: "surface",
          title: t("Surface"),
          summary: surface === "insights" ? t("Insights") : t("Dashboard"),
          content: (
            <ChoiceField
              label={t("Where it installs")}
              choices={[
                { value: "overview", label: t("Dashboard") },
                { value: "insights", label: t("Insights") },
              ]}
              value={surface}
              onValueChange={(value) => setSurface(value as WidgetSurface)}
              columns={2}
            />
          ),
        },
      }}
    />
  )
}
