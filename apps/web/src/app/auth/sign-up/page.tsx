import type { Metadata } from "next"
import Link from "next/link"
import { useExtracted } from "next-intl"
import { SignUpForm } from "@/components/auth/sign-up-form"
import { SocialButtons } from "@/components/auth/social-buttons"
import { FieldSeparator } from "@/components/ui/field"

export const metadata: Metadata = { title: "Create account" }

export default function SignUpPage() {
  const t = useExtracted()

  return (
    <div className="flex flex-col gap-6">
      <div className="text-center sm:text-left">
        <p className="text-xs font-semibold tracking-[0.18em] text-primary uppercase">
          {t("Start with the year you have")}
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">
          {t("Create your account")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {t("Free to use. Set up the first school year in a few minutes.")}
        </p>
      </div>

      <SocialButtons />

      <FieldSeparator>{t("or")}</FieldSeparator>

      <SignUpForm />

      <p className="text-center text-sm text-muted-foreground">
        {t("Already have an account?")}{" "}
        <Link
          href="/auth/sign-in"
          className="font-medium text-foreground underline-offset-4 hover:underline"
        >
          {t("Sign in")}
        </Link>
      </p>

      <p className="text-center text-xs text-muted-foreground">
        {t("By continuing you accept the")}{" "}
        <Link href="/legal/terms" className="underline underline-offset-2">
          {t("terms of service")}
        </Link>{" "}
        {t("and the")}{" "}
        <Link href="/legal/privacy" className="underline underline-offset-2">
          {t("privacy policy")}
        </Link>
        .
      </p>
    </div>
  )
}
