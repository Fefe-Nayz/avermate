"use client"

import { useRouter } from "next/navigation"
import { useEffect, useState } from "react"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { PasswordField } from "@/components/auth/password-field"
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
  const [cooldown, setCooldown] = useState(0)
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

  useEffect(() => {
    if (cooldown <= 0) return
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1_000)
    return () => clearTimeout(timer)
  }, [cooldown])

  const resend = async () => {
    setCooldown(45)
    haptic("light")
    await authClient.emailOtp.sendVerificationOtp({
      email,
      type: "forget-password",
    })
    toast.success(t("A new code is on its way."))
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

        <PasswordField
          label={t("New password")}
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={setPassword}
          error={error ?? undefined}
        />

        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Spinner className="size-4" /> : null}
          {t("Change password")}
        </Button>

        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={pending || cooldown > 0}
          onClick={resend}
          className="text-muted-foreground"
        >
          {cooldown > 0
            ? t("Send again in {seconds}s", { seconds: String(cooldown) })
            : t("Send the code again")}
        </Button>
      </FieldGroup>
    </form>
  )
}
