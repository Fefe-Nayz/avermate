import type { Metadata } from "next"
import Link from "next/link"
import { useExtracted } from "next-intl"
import { ForgotPasswordForm } from "@/components/auth/forgot-password-form"

export const metadata: Metadata = { title: "Reset password" }

export default function ForgotPasswordPage() {
  const t = useExtracted()

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("Reset your password")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("We will send a code to your address.")}
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
