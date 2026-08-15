"use client"

import { useExtracted } from "next-intl"
import type { WidgetSurface } from "@avermate/core"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { CardGallery } from "./card-gallery"
import { WidgetForm } from "./widget-form"

/**
 * Two ways into a new card: pick a curated one from the gallery, or build it
 * from scratch. The gallery comes first for the reader who just wants "the
 * good cards"; the editor keeps every capability it always had.
 */
export function NewCardScreen({ surface }: { surface: WidgetSurface }) {
  const t = useExtracted()

  return (
    <Tabs defaultValue="gallery" className="gap-6">
      <TabsList>
        <TabsTrigger value="gallery">{t("Gallery")}</TabsTrigger>
        <TabsTrigger value="custom">{t("Build your own")}</TabsTrigger>
      </TabsList>
      <TabsContent value="gallery">
        <CardGallery surface={surface} />
      </TabsContent>
      <TabsContent value="custom">
        <WidgetForm mode="create" surface={surface} />
      </TabsContent>
    </Tabs>
  )
}
