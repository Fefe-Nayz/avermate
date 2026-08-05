import { useState } from "react";
import { useRouter } from "expo-router";
import { Column, Spacer } from "@expo/ui";
import {
  Button,
  FromReactNative,
  Grouped,
  Line,
  Section,
  Text,
  Title,
} from "@/components/native";
import { TextField } from "@/components/controls";
import { Wordmark } from "@/components/wordmark";
import { signIn } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";

export default function SignIn() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await signIn.email({ email: email.trim(), password });

    if (result.error) {
      haptic("error");
      setError(
        result.error.status === 401
          ? t("That email and password do not match.")
          : t("Sign-in failed. Try again."),
      );
      setBusy(false);
      return;
    }

    haptic("success");
    // The session changed, so every cached answer was for someone else.
    queryClient.clear();
    router.replace("/(tabs)");
  };

  const ready = email.includes("@") && password.length > 0;

  return (
    <Grouped
      footer={
        <Button
          label={busy ? t("Signing in…") : t("Sign in")}
          onPress={() => void submit()}
          disabled={!ready || busy}
        />
      }
    >
      <Section>
        <Column spacing={space.lg}>
          <FromReactNative height={30}>
            <Wordmark />
          </FromReactNative>
          <Title subtitle={t("Pick up where you left off.")}>
            {t("Sign in")}
          </Title>
        </Column>
      </Section>

      <Section>
        <TextField
          label={t("Email")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
          placeholder="vous@exemple.fr"
        />
        <TextField
          label={t("Password")}
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          autoCapitalize="none"
        />
      </Section>

      {error ? (
        <Section>
          <Text size="footnote" tone="negative">
            {error}
          </Text>
        </Section>
      ) : null}

      <Section>
        <Line
          leading="password"
          title={t("I forgot my password")}
          onPress={() => router.push("/forgot-password")}
        />
        <Line
          leading="account"
          title={t("Create an account")}
          onPress={() => router.push("/sign-up")}
        />
      </Section>

      <Spacer size={space.xl} />
    </Grouped>
  );
}
