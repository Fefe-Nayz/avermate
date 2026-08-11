"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { useExtracted } from "next-intl"
import { TextField } from "@/components/forms/controls"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"

export function ForgotPasswordForm() {
  const t = useExtracted()
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [pending, setPending] = useState(false)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setPending(true)
    haptic("light")

    await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "forget-password",
    })

    // Keep the outcome identical whether the address exists to prevent
    // account enumeration.
    haptic("success")
    router.push(
      `/auth/reset-password?email=${encodeURIComponent(email.trim())}`
    )
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <TextField
          label={t("Email")}
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner className="size-4" /> : null}
          {t("Send the code")}
        </Button>
      </FieldGroup>
    </form>
  )
}
