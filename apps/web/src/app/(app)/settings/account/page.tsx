"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  DownloadIcon,
  KeyRoundIcon,
  LaptopIcon,
  LinkIcon,
  LogOutIcon,
  MailIcon,
  ShieldCheckIcon,
  SmartphoneIcon,
  TrashIcon,
  UnlinkIcon,
} from "lucide-react"
import { useFormatter, useExtracted } from "next-intl"
import { toast } from "sonner"
import { UAParser } from "ua-parser-js"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Spinner } from "@/components/ui/spinner"
import { TextField } from "@/components/forms/controls"
import { PageMeta } from "@/components/shell/page-chrome"
import { SettingsSection } from "@/components/settings/settings-section"
import { useAuthenticatedUser } from "@/components/authenticated-user"
import { authClient, useSession } from "@/lib/auth-client"
import { env } from "@/lib/env"
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
  const router = useRouter()
  const { data: session } = useSession()
  const user = useAuthenticatedUser()

  const [email, setEmail] = useState(user.email)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [accountAction, setAccountAction] = useState<string | null>(null)
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

  const setPassword = useMutation({
    ...orpc.profile.setPassword.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Password added."))
      setNewPassword("")
      await accounts.refetch()
    },
    onError: () => {
      haptic("error")
      toast.error(t("That password could not be saved."))
    },
  })

  const resetData = useMutation({
    ...orpc.preferences.resetData.mutationOptions(),
    onSuccess: async () => {
      haptic("success")
      toast.success(t("Everything has been cleared."))
      await queryClient.invalidateQueries()
      router.replace("/onboarding")
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

  const hasPassword =
    accounts.data?.some((account) => account.providerId === "credential") ??
    false
  const canUnlink = (accounts.data?.length ?? 0) > 1

  const changeEmail = async () => {
    const nextEmail = email.trim().toLowerCase()
    if (!nextEmail || nextEmail === user.email) return
    setAccountAction("email")
    const { error } = await authClient.changeEmail({
      newEmail: nextEmail,
      callbackURL: `${env.appUrl}/settings/account`,
    })
    setAccountAction(null)
    if (error) {
      haptic("error")
      toast.error(t("That address could not be used."))
      return
    }
    haptic("success")
    toast.success(t("Check your inbox to confirm the new address."))
  }

  const savePassword = async () => {
    if (newPassword.length < 8) return
    if (!hasPassword) {
      setPassword.mutate({ newPassword })
      return
    }

    setAccountAction("password")
    const { error } = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    })
    setAccountAction(null)
    if (error) {
      haptic("error")
      toast.error(t("That password could not be changed."))
      return
    }
    setCurrentPassword("")
    setNewPassword("")
    haptic("success")
    toast.success(t("Password changed. Other devices have been signed out."))
    await sessions.refetch()
  }

  const linkProvider = async (provider: "google" | "microsoft") => {
    setAccountAction(`link:${provider}`)
    const { error } = await authClient.linkSocial({
      provider,
      callbackURL: `${env.appUrl}/settings/account`,
    })
    if (error) {
      setAccountAction(null)
      haptic("error")
      toast.error(t("That sign-in could not be linked."))
    }
  }

  const unlinkProvider = async (accountId: string) => {
    if (!canUnlink) return
    setAccountAction(`unlink:${accountId}`)
    const { error } = await authClient.unlinkAccount({ accountId })
    setAccountAction(null)
    if (error) {
      haptic("error")
      toast.error(t("That sign-in could not be removed."))
      return
    }
    haptic("success")
    toast.success(t("Sign-in removed."))
    await accounts.refetch()
  }

  return (
    <>
      <PageMeta title={t("Account")} backHref="/more" />

      <div className="flex flex-col gap-4">
        <h1 className="hidden text-2xl font-semibold tracking-tight md:block">
          {t("Account")}
        </h1>

        <SettingsSection
          id="email"
          title={t("Email address")}
          description={t(
            "We confirm the new address before replacing the one on your account."
          )}
        >
          <TextField
            label={t("Email")}
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={
              accountAction === "email" ||
              !email.trim() ||
              email.trim().toLowerCase() === user.email.toLowerCase()
            }
            onClick={changeEmail}
          >
            {accountAction === "email" ? (
              <Spinner className="size-4" />
            ) : (
              <MailIcon className="size-4" />
            )}
            {t("Change email")}
          </Button>
        </SettingsSection>

        <SettingsSection
          id="password"
          title={hasPassword ? t("Password") : t("Add a password")}
          description={
            hasPassword
              ? t("Changing it signs out your other devices.")
              : t(
                  "Add an email-and-password sign-in without removing your linked provider."
                )
          }
        >
          {hasPassword ? (
            <TextField
              label={t("Current password")}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
            />
          ) : null}
          <TextField
            label={t("New password")}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            minLength={8}
            description={t("Use at least 8 characters.")}
            onChange={(event) => setNewPassword(event.target.value)}
          />
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={
              newPassword.length < 8 ||
              (hasPassword && !currentPassword) ||
              accountAction === "password" ||
              setPassword.isPending
            }
            onClick={savePassword}
          >
            {accountAction === "password" || setPassword.isPending ? (
              <Spinner className="size-4" />
            ) : (
              <KeyRoundIcon className="size-4" />
            )}
            {hasPassword ? t("Change password") : t("Add password")}
          </Button>
        </SettingsSection>

        <SettingsSection
          id="sessions"
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
          {(sessions.data?.length ?? 0) > 1 ? (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={accountAction === "sessions"}
              onClick={async () => {
                setAccountAction("sessions")
                const { error } = await authClient.revokeOtherSessions()
                setAccountAction(null)
                if (error) {
                  toast.error(t("Other sessions could not be signed out."))
                  return
                }
                haptic("success")
                toast.success(t("Other devices have been signed out."))
                await sessions.refetch()
              }}
            >
              {accountAction === "sessions" ? (
                <Spinner className="size-4" />
              ) : (
                <LogOutIcon className="size-4" />
              )}
              {t("Sign out other devices")}
            </Button>
          ) : null}
        </SettingsSection>

        <SettingsSection
          id="linked-sign-ins"
          title={t("Linked sign-ins")}
          description={t(
            "Keep at least one way to sign in. Linking never changes your grades or preferences."
          )}
        >
          {(["google", "microsoft"] as const).map((provider) => {
            const account = accounts.data?.find(
              (item) => item.providerId === provider
            )
            const pending =
              accountAction === `link:${provider}` ||
              accountAction === `unlink:${provider}`
            return (
              <div key={provider} className="flex items-center gap-3">
                <span className="grid size-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                  {account ? (
                    <ShieldCheckIcon className="size-4" />
                  ) : (
                    <LinkIcon className="size-4" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium capitalize">{provider}</p>
                  <p className="text-xs text-muted-foreground">
                    {account ? t("Linked to this account") : t("Not linked")}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={pending || (Boolean(account) && !canUnlink)}
                  title={
                    account && !canUnlink
                      ? t("Add another sign-in before removing this one.")
                      : undefined
                  }
                  onClick={() =>
                    account
                      ? unlinkProvider(account.id)
                      : linkProvider(provider)
                  }
                >
                  {pending ? (
                    <Spinner className="size-4" />
                  ) : account ? (
                    <UnlinkIcon className="size-4" />
                  ) : (
                    <LinkIcon className="size-4" />
                  )}
                  {account ? t("Unlink") : t("Link")}
                </Button>
              </div>
            )
          })}
        </SettingsSection>

        <SettingsSection
          id="export"
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
          id="start-over"
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
          id="delete"
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
