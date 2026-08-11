"use client"

import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DownloadIcon,
  LaptopIcon,
  LogOutIcon,
  SmartphoneIcon,
  TrashIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { toast } from "sonner"
import { UAParser } from "ua-parser-js"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import { authClient, useSession } from "@/lib/auth-client"
import { orpc } from "@/lib/orpc"
import { haptic } from "@/lib/haptics"

/**
 * The account.
 *
 * Everything destructive on this screen asks for the word that confirms it —
 * not because a dialog is unclear, but because these are the only actions in
 * the app that cannot be undone.
 */
export default function AccountSettingsPage() {
  const t = useExtracted()
  const format = useFormatter()
  const queryClient = useQueryClient()
  const { data: session } = useSession()

  const [resetPhrase, setResetPhrase] = useState("")
  const [deletePhrase, setDeletePhrase] = useState("")

  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async () => {
      const { data } = await authClient.listSessions()
      return data ?? []
    },
  })

  const accounts = useQuery({
    queryKey: ["auth", "accounts"],
    queryFn: async () => {
      const { data } = await authClient.listAccounts()
      return data ?? []
    },
  })

  const resetData = useMutation({
    ...orpc.preferences.resetData.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Everything has been cleared."))
      await queryClient.invalidateQueries()
      window.location.href = "/onboarding"
    },
  })

  const exportData = useMutation({
    ...orpc.preferences.exportData.mutationOptions(),
    onSuccess: (data) => {
      const blob = new Blob([JSON.stringify(data, null, 2)], {
        type: "application/json",
      })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = `avermate-${new Date().toISOString().slice(0, 10)}.json`
      anchor.click()
      URL.revokeObjectURL(url)
      haptic("success")
    },
  })

  const deviceOf = (userAgent: string | null | undefined) => {
    if (!userAgent) return { label: t("Unknown device"), mobile: false }
    const parsed = UAParser(userAgent)
    const mobile =
      parsed.device.type === "mobile" || parsed.device.type === "tablet"
    const parts = [parsed.browser.name, parsed.os.name].filter(Boolean)
    return {
      label: parts.length > 0 ? parts.join(" · ") : t("Unknown device"),
      mobile,
    }
  }

  return (
    <>
      <PageMeta title={t("Account")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Account")}
        </h1>

        <SettingsSection
          title={t("Where you are signed in")}
          description={t("Sign out anywhere you do not recognise.")}
        >
          {sessions.isLoading ? (
            <Spinner className="size-5 text-muted-foreground" />
          ) : null}
          {sessions.data?.map((item) => {
            const device = deviceOf(item.userAgent)
            const current = item.token === session?.session.token
            return (
              <div key={item.id} className="flex items-center gap-3">
                {device.mobile ? (
                  <SmartphoneIcon className="size-4 text-muted-foreground" />
                ) : (
                  <LaptopIcon className="size-4 text-muted-foreground" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">
                    {device.label}
                    {current ? (
                      <span className="ms-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                        {t("this device")}
                      </span>
                    ) : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {format.dateTime(new Date(item.updatedAt), {
                      day: "numeric",
                      month: "short",
                      hour: "numeric",
                      minute: "numeric",
                    })}
                  </p>
                </div>
                {!current ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("Sign out")}
                    onClick={async () => {
                      haptic("light")
                      await authClient.revokeSession({ token: item.token })
                      void sessions.refetch()
                    }}
                  >
                    <LogOutIcon className="size-4" />
                  </Button>
                ) : null}
              </div>
            )
          })}
        </SettingsSection>

        <SettingsSection title={t("Linked sign-ins")}>
          {accounts.data?.length ? (
            accounts.data.map((account) => (
              <div key={account.id} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-sm capitalize">
                  {account.providerId}
                </span>
                <span className="text-xs text-muted-foreground">
                  {format.dateTime(new Date(account.createdAt), {
                    day: "numeric",
                    month: "short",
                    year: "numeric",
                  })}
                </span>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">
              {t("Only email and password.")}
            </p>
          )}
        </SettingsSection>

        <SettingsSection
          title={t("Your data")}
          description={t("Everything you have entered, as one JSON file.")}
        >
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={exportData.isPending}
            onClick={() => exportData.mutate({})}
          >
            {exportData.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <DownloadIcon className="size-4" />
            )}
            {t("Download my data")}
          </Button>
        </SettingsSection>

        <SettingsSection
          title={t("Start over")}
          description={t(
            "Deletes every year, subject, grade and goal. Your account and preferences stay."
          )}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={resetPhrase}
              onChange={(event) => setResetPhrase(event.target.value)}
              placeholder="RESET"
              className="h-10 sm:max-w-40"
            />
            <Button
              variant="outline"
              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
              disabled={resetPhrase !== "RESET" || resetData.isPending}
              onClick={() => resetData.mutate({ confirmation: "RESET" })}
            >
              {resetData.isPending ? <Spinner className="size-4" /> : null}
              {t("Clear everything")}
            </Button>
          </div>
        </SettingsSection>

        <SettingsSection
          title={t("Delete this account")}
          description={t(
            "Permanent. We email you a link to confirm before anything is removed."
          )}
          className="border-destructive/40"
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              value={deletePhrase}
              onChange={(event) => setDeletePhrase(event.target.value)}
              placeholder="DELETE"
              className="h-10 sm:max-w-40"
            />
            <Button
              variant="destructive"
              disabled={deletePhrase !== "DELETE"}
              onClick={async () => {
                haptic("warning")
                const { error } = await authClient.deleteUser({})
                if (error) {
                  toast.error(t("That could not be started."))
                  return
                }
                toast.success(t("Check your email to confirm."))
              }}
            >
              <TrashIcon className="size-4" />
              {t("Delete my account")}
            </Button>
          </div>
        </SettingsSection>
      </div>
    </>
  )
}
