"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { TextField } from "@/components/forms/controls"
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

    const { error: failure } = await authClient.signIn.email({
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
        <TextField
          label={t("Password")}
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error ?? undefined}
        />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner className="size-4" /> : null}
          {t("Sign in")}
        </Button>
      </FieldGroup>
    </form>
  )
}
