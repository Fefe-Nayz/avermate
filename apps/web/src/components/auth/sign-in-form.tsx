"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { TextField } from "@/components/forms/controls"
import { PasswordField } from "@/components/auth/password-field"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"

export function SignInForm({ next }: { next: string }) {
  const t = useExtracted()
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    setError(null)
    haptic("light")

    const { data, error: failure } = await authClient.signIn.email({
      email: email.trim(),
      password,
    })

    if (failure) {
      setPending(false)
      haptic("error")
      setError(
        failure.status === 401
          ? t("That email and password do not match.")
          : (failure.message ?? t("Sign-in failed. Try again."))
      )
      return
    }

    if (data && !data.user.emailVerified) {
      await authClient.emailOtp.sendVerificationOtp({
        email: data.user.email,
        type: "email-verification",
      })
      haptic("warning")
      toast.info(t("Confirm your email to continue."))
      router.replace(
        `/auth/verify?email=${encodeURIComponent(data.user.email)}&next=${encodeURIComponent(next)}`
      )
      return
    }

    // During an OAuth request Better Auth restores the signed transaction and
    // its redirect plugin takes over. Do not race it with an app navigation.
    if (data && "redirect" in data && data.redirect) return

    haptic("success")
    toast.success(t("Welcome back."))
    router.replace(next)
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <TextField
          label={t("Email")}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <PasswordField
          label={t("Password")}
          autoComplete="current-password"
          required
          value={password}
          onChange={setPassword}
          error={error ?? undefined}
        />
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Spinner className="size-4" /> : null}
          {t("Sign in")}
        </Button>
      </FieldGroup>
    </form>
  )
}
