import type { Metadata } from "next"
import { use } from "react"
import { useExtracted } from "next-intl"
import { VerifyEmailForm } from "@/components/auth/verify-email-form"

export const metadata: Metadata = { title: "Verify email" }

export default function VerifyPage({
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
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Check your email")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("We sent a six-digit code to {email}.", { email })}
        </p>
      </div>

      <VerifyEmailForm email={email} />
    </div>
  )
}
