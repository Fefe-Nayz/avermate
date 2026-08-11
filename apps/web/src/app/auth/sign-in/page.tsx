import type { Metadata } from "next"
import Link from "next/link"
import { use } from "react"
import { useExtracted } from "next-intl"
import { SignInForm } from "@/components/auth/sign-in-form"
import { SocialButtons } from "@/components/auth/social-buttons"
import { FieldSeparator } from "@/components/ui/field"

export const metadata: Metadata = { title: "Sign in" }

export default function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>
}) {
  const t = useExtracted()
  const requestedNext = use(searchParams).next
  const candidate = Array.isArray(requestedNext)
    ? (requestedNext[0] ?? "/dashboard")
    : (requestedNext ?? "/dashboard")
  const next =
    candidate.startsWith("/") && !candidate.startsWith("//")
      ? candidate
      : "/dashboard"

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center sm:text-left">
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
          {t("Welcome back")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("Sign in")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("Pick up your year exactly where you left it.")}
        </p>
      </div>

      <SocialButtons next={next} />

      <FieldSeparator>{t("or")}</FieldSeparator>

      <SignInForm next={next} />

      <div className="flex flex-col gap-2 text-center text-sm">
        <Link
          href="/auth/forgot-password"
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("Forgot your password?")}
        </Link>
        <p className="text-muted-foreground">
          {t("No account yet?")}{" "}
          <Link
            href="/auth/sign-up"
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            {t("Create an account")}
          </Link>
        </p>
      </div>
    </div>
  )
}
