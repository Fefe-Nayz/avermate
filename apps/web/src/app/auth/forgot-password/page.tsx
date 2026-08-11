import type { Metadata } from "next"
import Link from "next/link"
import { useExtracted } from "next-intl"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata: Metadata = { title: "Reset password" }

export default function ForgotPasswordPage() {
  const t = useExtracted()

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center sm:text-left">
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
          {t("Account recovery")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("Reset your password")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t(
            "Enter the email on your account. We will send a short-lived six-digit code."
          )}
        </p>
      </div>

      <ForgotPasswordForm />

      <p className="text-center text-sm text-muted-foreground">
        <Link
          href="/auth/sign-in"
          className="underline-offset-4 hover:underline"
        >
          {t("Back to sign in")}
        </Link>
      </p>
    </div>
  )
}
