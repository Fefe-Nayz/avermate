import { useState } from "react";
import { Stack, useRouter } from "expo-router";
import { Button, Problem, Screen, Section, Title } from "@/components/ui";
import { TextField } from "@/components/field";
import { authClient } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { queryClient } from "@/lib/orpc";
import { t } from "@/lib/i18n";

/**
 * Getting back in.
 *
 * A six-digit code rather than a link: a link opens a browser, the browser has
 * no session, and the user ends up signed in somewhere they were not trying to
 * be. A code stays in the app they already have open.
 */
export default function ForgotPassword() {
  const router = useRouter();

  const [stage, setStage] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({
      email: email.trim(),
      type: "forget-password",
    });
    setBusy(false);

    if (result.error) {
      haptic("error");
      setError(t("That code could not be sent. Check the address."));
      return;
    }
    haptic("success");
    setStage("code");
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
      setError(t("That code did not work. It may have expired."));
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
              label={t("Send me a code")}
              onPress={() => void sendCode()}
              disabled={!email.includes("@") || busy}
            />
          ) : (
            <Button
              label={t("Set the new password")}
              onPress={() => void resetPassword()}
              disabled={code.trim().length < 4 || password.length < 8 || busy}
            />
          )
        }
      >
        <Section>
          <Title
            subtitle={
              stage === "email"
                ? t("We will send a six-digit code to your address.")
                : t("Enter the code, then pick something new.")
            }
          >
            {t("Reset your password")}
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
                onChangeText={setCode}
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
