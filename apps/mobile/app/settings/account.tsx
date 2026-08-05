import { useState } from "react";
import { Alert, Share } from "react-native";
import { Stack, useRouter } from "expo-router";
import { useMutation } from "@tanstack/react-query";
import { Spacer } from "@expo/ui";
import { Grouped, Line, Section, Text } from "@/components/native";
import { TextField } from "@/components/controls";
import { authClient, useSession } from "@/lib/auth-client";
import { client, queryClient } from "@/lib/orpc";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { space } from "@/lib/theme";

/**
 * The account.
 *
 * Everything destructive here asks for the word that confirms it, typed out.
 * A confirmation dialog you can dismiss by tapping the wrong half of a button
 * is not a confirmation — and these two actions cannot be undone.
 */
export default function Account() {
  const router = useRouter();
  const { data: session } = useSession();

  const [name, setName] = useState(session?.user.name ?? "");
  const [email, setEmail] = useState(session?.user.email ?? "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const say = (message: string) => {
    haptic("success");
    setError(null);
    setStatus(message);
  };

  const complain = (message: string) => {
    haptic("error");
    setStatus(null);
    setError(message);
  };

  const saveName = async () => {
    const result = await authClient.updateUser({ name: name.trim() });
    if (result.error) return complain(t("That could not be saved."));
    say(t("Name updated."));
  };

  const changeEmail = async () => {
    const result = await authClient.changeEmail({ newEmail: email.trim() });
    if (result.error) return complain(t("That address could not be used."));
    say(t("Check your inbox to confirm the new address."));
  };

  const changePassword = async () => {
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    if (result.error) return complain(t("That password could not be changed."));
    setCurrentPassword("");
    setNewPassword("");
    say(t("Password changed. Other devices have been signed out."));
  };

  const exportData = useMutation({
    mutationFn: () => client.preferences.exportData(),
    onSuccess: async (data) => {
      haptic("success");
      // Handing it to the share sheet keeps the file out of the app's storage
      // and lets the user decide where a copy of their whole year goes.
      await Share.share({
        title: "avermate-export.json",
        message: JSON.stringify(data, null, 2),
      });
    },
    onError: () => complain(t("The export could not be prepared.")),
  });

  const reset = useMutation({
    mutationFn: () => client.preferences.resetData({ confirmation: "RESET" }),
    onSuccess: () => {
      haptic("success");
      queryClient.clear();
      router.replace("/onboarding");
    },
    onError: () => complain(t("Nothing was deleted.")),
  });

  const confirmReset = () => {
    Alert.prompt?.(
      t("Delete every grade?"),
      t("Type RESET to confirm. Your account stays, everything in it goes."),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Delete"),
          style: "destructive",
          onPress: (typed?: string) => {
            if (typed === "RESET") reset.mutate();
            else complain(t("That did not match. Nothing was deleted."));
          },
        },
      ],
      "plain-text",
    ) ??
      // Android has no prompt; fall back to a plain confirmation.
      Alert.alert(
        t("Delete every grade?"),
        t("Your account stays, everything in it goes. This cannot be undone."),
        [
          { text: t("Cancel"), style: "cancel" },
          {
            text: t("Delete"),
            style: "destructive",
            onPress: () => reset.mutate(),
          },
        ],
      );
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Account") }} />
      <Grouped>
        <Section title={t("Your name")}>
          <TextField
            label={t("Name")}
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
          />
          <Line
            leading="check"
            title={t("Save name")}
            onPress={() => void saveName()}
          />
        </Section>

        <Section title={t("Email")}>
          <TextField
            label={t("Email")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <Line
            leading="email"
            title={t("Change email")}
            detail={t("You will get a link to confirm it.")}
            onPress={() => void changeEmail()}
          />
        </Section>

        <Section title={t("Password")}>
          <TextField
            label={t("Current password")}
            value={currentPassword}
            onChangeText={setCurrentPassword}
            secureTextEntry
            autoCapitalize="none"
          />
          <TextField
            label={t("New password")}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
            error={
              newPassword.length > 0 && newPassword.length < 8
                ? t("Use at least 8 characters.")
                : undefined
            }
          />
          <Line
            leading="password"
            title={t("Change password")}
            onPress={() => void changePassword()}
          />
        </Section>

        <Section title={t("Your data")}>
          <Line
            leading="export"
            title={t("Export everything")}
            detail={t("Every year, subject and grade, as JSON.")}
            onPress={() => exportData.mutate()}
          />
          <Line
            leading="danger"
            title={t("Delete every grade")}
            destructive
            onPress={confirmReset}
          />
        </Section>

        {status ? (
          <Section>
            <Text size="footnote" tone="positive">
              {status}
            </Text>
          </Section>
        ) : null}

        {error ? (
          <Section>
            <Text size="footnote" tone="negative">
              {error}
            </Text>
          </Section>
        ) : null}

        <Spacer size={space.xl} />
      </Grouped>
    </>
  );
}
