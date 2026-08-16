import { useEffect, useState } from "react";
import { Stack, useRouter } from "expo-router";
import {
  Button,
  Confirmation,
  Problem,
  Screen,
  Section,
  Title,
} from "@/components/ui";
import { TextField } from "@/components/field";
import { authClient } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { queryClient } from "@/lib/orpc";
import { t } from "@/lib/i18n";

/**
 * Getting back in.
 *
 * A six-digit code rather than a link, on both platforms: a link opens a
 * browser, the browser has no session, and the user ends up signed in
 * somewhere they were not trying to be. A code stays in the app.
 *
 * Sending always advances to the code stage, whether or not the address
 * exists — the web does the same to prevent account enumeration.
 */
export default function ForgotPassword() {
  const router = useRouter();

  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [resent, setResent] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "forget-password",
    });
    setBusy(false);

    // Keep the outcome identical whether the address exists to prevent
    // account enumeration.
    haptic("success");
    setStage("code");
  };

  const resendCode = async () => {
    if (cooldown > 0) return;
    setCooldown(45);
    haptic("light");
    await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "forget-password",
    });
    setResent(true);
  };

  const resetPassword = async () => {
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.resetPassword({
      email: email.trim(),
      otp: code.trim(),
      password,
    });
    setBusy(false);

    if (result.error) {
      haptic("error");
      setResent(false);
      setError(t("That code is not right, or it has expired."));
      return;
    }

    haptic("success");
    queryClient.clear();
    router.replace("/sign-in");
  };

  return (
    <>
      <Stack.Screen options={{ title: "" }} />
      <Screen
        footer={
          stage === "email" ? (
            <Button
              label={t("Send the code")}
              onPress={() => void sendCode()}
              disabled={!email.includes("@") || busy}
              loading={busy}
            />
          ) : (
            <Button
              label={t("Change password")}
              onPress={() => void resetPassword()}
              disabled={code.trim().length !== 6 || password.length < 8 || busy}
              loading={busy}
            />
          )
        }
      >
        <Section>
          <Title
            subtitle={
              stage === "email"
                ? t(
                    "Enter the email on your account. We will send a short-lived six-digit code.",
                  )
                : t("Enter the code we sent to {email}.", {
                    email: email.trim(),
                  })
            }
          >
            {stage === "email"
              ? t("Reset your password")
              : t("Choose a new password")}
          </Title>
        </Section>

        <Section>
          <TextField
            label={t("Email")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="email"
            autoFocus={stage === "email"}
          />
          {stage === "code" ? (
            <>
              <TextField
                label={t("Code")}
                value={code}
                onChangeText={(value) =>
                  setCode(value.replace(/\D/g, "").slice(0, 6))
                }
                keyboardType="number-pad"
                autoFocus
              />
              <TextField
                label={t("New password")}
                value={password}
                onChangeText={setPassword}
                secureTextEntry
                autoCapitalize="none"
                autoComplete="new-password"
                error={
                  password.length > 0 && password.length < 8
                    ? t("Use at least 8 characters.")
                    : undefined
                }
              />
              <Button
                label={
                  cooldown > 0
                    ? t("Send again in {seconds}s", { seconds: cooldown })
                    : t("Send the code again")
                }
                variant="ghost"
                disabled={cooldown > 0}
                onPress={() => void resendCode()}
              />
              {resent && !error ? (
                <Confirmation>{t("A new code is on its way.")}</Confirmation>
              ) : null}
            </>
          ) : null}
        </Section>

        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
