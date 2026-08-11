import type { Metadata } from "next"
import { use } from "react"
import { useExtracted } from "next-intl"
import { ResetPasswordForm } from "@/components/auth/reset-password-form"

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
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Choose a new password")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("Enter the code we sent to {email}.", { email })}
        </p>
      </div>

      <ResetPasswordForm email={email} />
    </div>
  )
}
