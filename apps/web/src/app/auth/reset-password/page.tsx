import type { Metadata } from "next"
import Link from "next/link"
import { use } from "react"
import { useExtracted } from "next-intl"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Reset password" }

export default function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string | string[] }>
}) {
  const t = useExtracted()
  const requestedEmail = use(searchParams).email
  const email = Array.isArray(requestedEmail)
    ? (requestedEmail[0] ?? "")
    : (requestedEmail ?? "")

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center sm:text-left">
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
          {t("Almost there")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("Choose a new password")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {email
            ? t("Enter the code we sent to {email}.", { email })
            : t("Start account recovery so we know where to send your code.")}
        </p>
      </div>

      {email ? (
        <ResetPasswordForm email={email} />
      ) : (
        <Button size="lg" render={<Link href="/auth/forgot-password" />}>
          {t("Start account recovery")}
        </Button>
      )}
    </div>
  )
}
