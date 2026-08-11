"use client"

import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import PasswordEntropy from "@rabbit-company/password-entropy"
import { useExtracted } from "next-intl"
import { toast } from "sonner"
import { TextField } from "@/components/forms/controls"
import { PasswordField } from "@/components/auth/password-field"
import { Button } from "@/components/ui/button"
import { FieldGroup } from "@/components/ui/field"
import { Spinner } from "@/components/ui/spinner"
import { authClient } from "@/lib/auth-client"
import { haptic } from "@/lib/haptics"
import { cn } from "@/lib/utils"

/** Entropy bands, so the meter says something about difficulty to guess. */
function strengthOf(entropy: number): 0 | 1 | 2 | 3 {
  if (entropy < 40) return 0
  if (entropy < 60) return 1
  if (entropy < 80) return 2
  return 3
}

export function SignUpForm() {
  const t = useExtracted()
  const router = useRouter()
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const strength = useMemo(
    () => (password ? strengthOf(PasswordEntropy.calculate(password)) : null),
    [password]
  )
  const labels: Record<0 | 1 | 2 | 3, string> = {
    0: t("Too easy to guess"),
    1: t("Weak"),
    2: t("Good"),
    3: t("Strong"),
  }

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (password.length < 8) {
      setError(t("Use at least 8 characters."))
      haptic("warning")
      return
    }

    setPending(true)
    setError(null)
    haptic("light")

    const { error: failure } = await authClient.signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
    })

    if (failure) {
      setPending(false)
      haptic("error")
      setError(failure.message ?? t("That account could not be created."))
      return
    }

    haptic("success")
    toast.success(t("Account created. Check your inbox for the code."))
    router.replace(`/auth/verify?email=${encodeURIComponent(email.trim())}`)
  }

  return (
    <form onSubmit={submit}>
      <FieldGroup>
        <TextField
          label={t("Name")}
          autoComplete="name"
          required
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
        <TextField
          label={t("Email")}
          type="email"
          autoComplete="email"
          inputMode="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
        />
        <div className="flex flex-col gap-2">
          <PasswordField
            label={t("Password")}
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={setPassword}
            error={error ?? undefined}
            description={t(
              "Use a long, unique password. The meter estimates how hard it is to guess."
            )}
          />
          {strength !== null ? (
            <div
              className="flex items-center gap-2"
              role="progressbar"
              aria-label={t("Password strength")}
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={strength + 1}
            >
              <div className="flex flex-1 gap-1" aria-hidden="true">
                {[0, 1, 2, 3].map((step) => (
                  <span
                    key={step}
                    className={cn(
                      "h-1 flex-1 rounded-full transition-colors",
                      step <= strength
                        ? strength === 0
                          ? "bg-band-poor"
                          : strength === 1
                            ? "bg-band-weak"
                            : strength === 2
                              ? "bg-band-good"
                              : "bg-band-excellent"
                        : "bg-muted"
                    )}
                  />
                ))}
              </div>
              <span className="text-xs text-muted-foreground">
                {labels[strength]}
              </span>
            </div>
          ) : null}
        </div>
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? <Spinner className="size-4" /> : null}
          {t("Create account")}
        </Button>
      </FieldGroup>
    </form>
  )
}
