"use client"

import Link from "next/link"
import { CopyIcon, MessageSquarePlusIcon } from "lucide-react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import { useFeedback } from "@/components/feedback/feedback-provider"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { haptic } from "@/lib/haptics"

export default function AboutPage() {
  const t = useExtracted()
  const user = useAuthenticatedUser()
  const feedback = useFeedback()

  return (
    <>
      <PageMeta title={t("About")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("About")}
        </h1>

        <SettingsSection title={t("Avermate")}>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t(
              "Avermate works out your averages the way your school does, explains what moves them, and tells you what it would take to hit the result you are after."
            )}
          </p>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => feedback.open()}
          >
            <MessageSquarePlusIcon className="size-4" />
            {t("Send feedback")}
          </Button>
        </SettingsSection>

        <SettingsSection
          title={t("Support")}
          description={t("Quote this id if you ever write in about a problem.")}
        >
          <button
            type="button"
            onClick={() => {
              haptic("light")
              void navigator.clipboard.writeText(user.id)
              toast.success(t("Copied."))
            }}
            className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2 text-left font-mono text-xs"
          >
            <span className="min-w-0 flex-1 truncate">{user.id}</span>
            <CopyIcon className="size-3.5 shrink-0 text-muted-foreground" />
          </button>
        </SettingsSection>

        <SettingsSection title={t("Legal")}>
          <div className="flex flex-col gap-2">
            <Link
              href="/legal/privacy"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("Privacy policy")}
            </Link>
            <Link
              href="/legal/terms"
              className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
            >
              {t("Terms of service")}
            </Link>
          </div>
        </SettingsSection>
      </div>
    </>
  )
}
