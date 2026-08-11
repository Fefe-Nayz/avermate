"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { TextField } from "@/components/forms/controls"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"

export function ResetPasswordForm({ email }: { email: string }) {
  const t = useExtracted()
  const router = useRouter()
  const [code, setCode] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (code.length !== 6) {
      setError(t("Enter the six-digit code."))
      return
    }
    if (password.length < 8) {
      setError(t("Use at least 8 characters."))
      return
    }

    setPending(true)
    setError(null)
    haptic("light")

    const { error: failure } = await authClient.emailOtp.resetPassword({
      email,
      otp: code,
      password,
    })

    if (failure) {
      setPending(false)
      haptic("error")
      setError(t("That code is not right, or it has expired."))
      return
    }

    haptic("success")
    toast.success(t("Password changed. You can sign in now."))
    router.replace("/auth/sign-in")
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <div className="flex justify-center">
          <InputOTP maxLength={6} value={code} onChange={setCode}>
            <InputOTPGroup>
              {[0, 1, 2, 3, 4, 5].map((index) => (
                <InputOTPSlot key={index} index={index} className="size-11" />
              ))}
            </InputOTPGroup>
          </InputOTP>
        </div>

        <TextField
          label={t("New password")}
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={error ?? undefined}
        />

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? <Spinner className="size-4" /> : null}
          {t("Change password")}
        </Button>
      </FieldGroup>
    </form>
  )
}
