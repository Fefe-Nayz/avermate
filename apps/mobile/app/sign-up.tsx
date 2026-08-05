import { useState } from "react";
import { useRouter } from "expo-router";
import { Spacer } from "@expo/ui";
import { Button, Grouped, Section, Text, Title } from "@/components/native";
import { TextField } from "@/components/controls";
import { signUp } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { queryClient } from "@/lib/orpc";
import { space } from "@/lib/theme";

export default function SignUp() {
  const router = useRouter();

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);

    const result = await signUp.email({
      name: name.trim(),
      email: email.trim(),
      password,
    });

    if (result.error) {
      haptic("error");
      setError(result.error.message ?? t("That account could not be created."));
      setBusy(false);
      return;
    }

    haptic("success");
    queryClient.clear();
    // Straight to onboarding: a brand-new account has no year, and the first
    // thing worth doing is creating one.
    router.replace("/onboarding");
  };

  const ready =
    name.trim().length > 0 && email.includes("@") && password.length >= 8;

  return (
    <Grouped
      footer={
        <Button
          label={t("Create account")}
          onPress={() => void submit()}
          disabled={!ready || busy}
        />
      }
    >
      <Section>
        <Title subtitle={t("Free, and your grades stay yours.")}>
          {t("Create your account")}
        </Title>
      </Section>

      <Section>
        <TextField
          label={t("Name")}
          value={name}
          onChangeText={setName}
          autoComplete="name"
          autoCapitalize="words"
        />
        <TextField
          label={t("Email")}
          value={email}
          onChangeText={setEmail}
          keyboardType="email-address"
          autoCapitalize="none"
          autoComplete="email"
        />
        <TextField
          label={t("Password")}
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
      </Section>

      {error ? (
        <Section>
          <Text size="footnote" tone="negative">
            {error}
          </Text>
        </Section>
      ) : null}

      <Spacer size={space.xl} />
    </Grouped>
  );
}
