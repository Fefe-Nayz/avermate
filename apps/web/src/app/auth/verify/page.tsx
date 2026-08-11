import type { Metadata } from "next"
import Link from "next/link"
import { use } from "react"
import { useExtracted } from "next-intl"
import { VerifyEmailForm } from "@/components/auth/verify-email-form"
import { Button } from "@/components/ui/button"

export const metadata: Metadata = { title: "Verify email" }

export default function VerifyPage({
  searchParams,
}: {
  searchParams: Promise<{
    email?: string | string[]
    next?: string | string[]
  }>
}) {
  const t = useExtracted()
  const values = use(searchParams)
  const requestedEmail = values.email
  const email = Array.isArray(requestedEmail)
    ? (requestedEmail[0] ?? "")
    : (requestedEmail ?? "")
  const requestedNext = values.next
  const candidate = Array.isArray(requestedNext)
    ? (requestedNext[0] ?? "/onboarding")
    : (requestedNext ?? "/onboarding")
  const next =
    candidate.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/onboarding"

  return (
    <div className="flex flex-col items-center gap-6 text-center">
      <div>
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
          {t("One quick check")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("Check your email")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {email
            ? t("We sent a six-digit code to {email}.", { email })
            : t("Create an account first so we know where to send the code.")}
        </p>
      </div>

      {email ? (
        <VerifyEmailForm email={email} next={next} />
      ) : (
        <Button size="lg" render={<Link href="/auth/sign-up" />}>
          {t("Create an account")}
        </Button>
      )}
    </div>
  )
}
