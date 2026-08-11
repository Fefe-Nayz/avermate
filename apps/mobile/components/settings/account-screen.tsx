import { useEffect, useState } from "react";
import { Alert, Share, Text, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Confirmation,
  Loading,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { TextField } from "@/components/field";
import { authClient, useSession } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { client, orpc, queryClient } from "@/lib/orpc";
import { ImageSelectionError, selectImage } from "@/lib/image-file";
import { radius, space, type, usePalette } from "@/lib/theme";

/** Account identity, credentials, linked providers and request-safe sessions. */
export function AccountScreen() {
  const palette = usePalette();
  const router = useRouter();
  const session = useSession();
  const viewer = useQuery(orpc.profile.viewer.queryOptions());
  const uploads = useQuery(orpc.profile.uploadsEnabled.queryOptions());
  const sessions = useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: async () => (await authClient.listSessions()).data ?? [],
  });
  const accounts = useQuery({
    queryKey: ["auth", "accounts"],
    queryFn: async () => (await authClient.listAccounts()).data ?? [],
  });

  const user = viewer.data ?? session.data?.user;
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [resetPhrase, setResetPhrase] = useState("");
  const [deletePhrase, setDeletePhrase] = useState("");
  const [action, setAction] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    setName((current) => current || user.name);
    setEmail((current) => current || user.email);
  }, [user]);

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

  const avatar = useMutation({
    ...orpc.profile.uploadAvatar.mutationOptions(),
    onSuccess: async () => {
      say(t("Profile photo updated."));
      await viewer.refetch();
      await session.refetch();
    },
    onError: () => complain(t("That image could not be uploaded.")),
  });
  const removeAvatar = useMutation({
    ...orpc.profile.removeAvatar.mutationOptions(),
    onSuccess: async () => {
      say(t("Profile photo removed."));
      await viewer.refetch();
      await session.refetch();
    },
    onError: () => complain(t("That image could not be removed.")),
  });
  const setPassword = useMutation({
    ...orpc.profile.setPassword.mutationOptions(),
    onSuccess: async () => {
      setNewPassword("");
      say(t("Password added."));
      await accounts.refetch();
    },
    onError: () => complain(t("That password could not be saved.")),
  });
  const exportData = useMutation({
    mutationFn: () => client.preferences.exportData(),
    onSuccess: async (data) => {
      say(t("Export prepared."));
      await Share.share({
        title: `avermate-${new Date().toISOString().slice(0, 10)}.json`,
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

  if (!user) return <Loading />;

  const hasPassword =
    accounts.data?.some((account) => account.providerId === "credential") ??
    false;
  const canUnlink = (accounts.data?.length ?? 0) > 1;
  const initials = user.name
    .split(" ")
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  const saveName = async () => {
    if (!name.trim() || name.trim() === user.name) return;
    setAction("name");
    const result = await authClient.updateUser({ name: name.trim() });
    setAction(null);
    if (result.error) return complain(t("That could not be saved."));
    await viewer.refetch();
    await session.refetch();
    say(t("Name updated."));
  };

  const changeEmail = async () => {
    const next = email.trim().toLowerCase();
    if (!next || next === user.email.toLowerCase()) return;
    setAction("email");
    const result = await authClient.changeEmail({
      newEmail: next,
      callbackURL: "/settings/account",
    });
    setAction(null);
    if (result.error) return complain(t("That address could not be used."));
    say(t("Check your inbox to confirm the new address."));
  };

  const savePassword = async () => {
    if (newPassword.length < 8) return;
    if (!hasPassword) {
      setPassword.mutate({ newPassword });
      return;
    }
    if (!currentPassword) return;
    setAction("password");
    const result = await authClient.changePassword({
      currentPassword,
      newPassword,
      revokeOtherSessions: true,
    });
    setAction(null);
    if (result.error) return complain(t("That password could not be changed."));
    setCurrentPassword("");
    setNewPassword("");
    await sessions.refetch();
    say(t("Password changed. Other devices have been signed out."));
  };

  const link = async (provider: "google" | "microsoft") => {
    setAction(`link:${provider}`);
    const result = await authClient.linkSocial({
      provider,
      callbackURL: "/settings/account",
    });
    if (result.error) {
      setAction(null);
      complain(t("That sign-in could not be linked."));
      return;
    }
    setAction(null);
    await accounts.refetch();
    say(t("Sign-in linked."));
  };

  const unlink = async (providerId: string) => {
    if (!canUnlink) return;
    setAction(`unlink:${providerId}`);
    const result = await authClient.unlinkAccount({ providerId });
    setAction(null);
    if (result.error) return complain(t("That sign-in could not be removed."));
    await accounts.refetch();
    say(t("Sign-in removed."));
  };

  const chooseAvatar = async () => {
    try {
      const selected = await selectImage({ square: true });
      if (!selected) return;
      avatar.mutate({ image: selected.file });
    } catch (cause) {
      complain(
        cause instanceof ImageSelectionError && cause.code === "size"
          ? t("Choose an image smaller than 2 MB.")
          : cause instanceof ImageSelectionError && cause.code === "permission"
            ? t("Allow photo access to choose an image.")
          : t("Choose a PNG, JPEG or WebP image."),
      );
    }
  };

  const deleteAccount = async () => {
    const result = await authClient.deleteUser({ callbackURL: "/sign-in" });
    if (result.error) return complain(t("That could not be started."));
    say(t("Check your email to confirm."));
  };

  return (
    <>
      <Stack.Screen options={{ title: t("Account") }} />
      <Screen>
        <Section title={t("Profile") }>
          <Card>
            <View style={{ alignItems: "center", gap: space.md }}>
              {user.image ? (
                <Image
                  source={user.image}
                  contentFit="cover"
                  style={{ width: 88, height: 88, borderRadius: radius.pill }}
                />
              ) : (
                <View
                  style={{
                    width: 88,
                    height: 88,
                    borderRadius: radius.pill,
                    backgroundColor: palette.accentSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Text style={[type.title, { color: palette.text }]}>
                    {initials}
                  </Text>
                </View>
              )}
              {uploads.data?.enabled ? (
                <View style={{ width: "100%", gap: space.sm }}>
                  <Button
                    label={t("Choose a photo")}
                    variant="secondary"
                    loading={avatar.isPending}
                    onPress={() => void chooseAvatar()}
                  />
                  {user.image ? (
                    <Button
                      label={t("Remove photo")}
                      variant="ghost"
                      loading={removeAvatar.isPending}
                      onPress={() => removeAvatar.mutate({})}
                    />
                  ) : null}
                </View>
              ) : null}
            </View>
          </Card>
          <TextField
            label={t("Name")}
            value={name}
            onChangeText={setName}
            autoComplete="name"
            autoCapitalize="words"
          />
          <Button
            label={t("Save name")}
            variant="secondary"
            disabled={!name.trim() || name.trim() === user.name}
            loading={action === "name"}
            onPress={() => void saveName()}
          />
        </Section>

        <Section title={t("Email address") }>
          <TextField
            label={t("Email")}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoComplete="email"
            autoCapitalize="none"
          />
          <Button
            label={t("Change email")}
            variant="secondary"
            disabled={!email.includes("@") || email.toLowerCase() === user.email.toLowerCase()}
            loading={action === "email"}
            onPress={() => void changeEmail()}
          />
        </Section>

        <Section title={hasPassword ? t("Password") : t("Add a password")}>
          {hasPassword ? (
            <TextField
              label={t("Current password")}
              value={currentPassword}
              onChangeText={setCurrentPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete="password"
            />
          ) : null}
          <TextField
            label={t("New password")}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
            error={
              newPassword.length > 0 && newPassword.length < 8
                ? t("Use at least 8 characters.")
                : undefined
            }
          />
          <Button
            label={hasPassword ? t("Change password") : t("Add password")}
            variant="secondary"
            disabled={newPassword.length < 8 || (hasPassword && !currentPassword)}
            loading={action === "password" || setPassword.isPending}
            onPress={() => void savePassword()}
          />
        </Section>

        <Section title={t("Linked sign-ins") }>
          <Card padded={false}>
            {(["google", "microsoft"] as const).map((provider, index) => {
              const linked = accounts.data?.find(
                (account) => account.providerId === provider,
              );
              const pending =
                action === `link:${provider}` || action === `unlink:${provider}`;
              return (
                <Row
                  key={provider}
                  first={index === 0}
                  title={provider === "google" ? "Google" : "Microsoft"}
                  subtitle={linked ? t("Linked to this account") : t("Not linked")}
                  leading={
                    <Ionicons
                      name={linked ? "shield-checkmark-outline" : "link-outline"}
                      size={19}
                      color={palette.textMuted}
                    />
                  }
                  trailing={
                    <Text style={[type.footnote, { color: pending ? palette.textFaint : palette.textMuted }]}>
                      {pending
                        ? t("Working…")
                        : linked
                          ? canUnlink
                            ? t("Unlink")
                            : t("Only sign-in")
                          : t("Link")}
                    </Text>
                  }
                  onPress={() =>
                    linked ? void unlink(linked.providerId) : void link(provider)
                  }
                />
              );
            })}
          </Card>
        </Section>

        <Section title={t("Where you are signed in") }>
          <Card padded={false}>
            {(sessions.data ?? []).map((item, index) => {
              const current = item.token === session.data?.session.token;
              return (
                <Row
                  key={item.id}
                  first={index === 0}
                  title={item.userAgent?.slice(0, 72) || t("Unknown device")}
                  subtitle={`${new Date(item.updatedAt).toLocaleString()}${current ? ` · ${t("this device")}` : ""}`}
                  leading={
                    <Ionicons
                      name="phone-portrait-outline"
                      size={19}
                      color={palette.textMuted}
                    />
                  }
                  trailing={
                    !current ? (
                      <Text style={[type.footnote, { color: palette.negative }]}>
                        {t("Sign out")}
                      </Text>
                    ) : undefined
                  }
                  onPress={
                    current
                      ? undefined
                      : () =>
                          void authClient
                            .revokeSession({ token: item.token })
                            .then(() => sessions.refetch())
                  }
                />
              );
            })}
          </Card>
          {(sessions.data?.length ?? 0) > 1 ? (
            <Button
              label={t("Sign out other devices")}
              variant="secondary"
              loading={action === "sessions"}
              onPress={() => {
                setAction("sessions");
                void authClient.revokeOtherSessions().then(async ({ error: failure }) => {
                  setAction(null);
                  if (failure) return complain(t("Other sessions could not be signed out."));
                  await sessions.refetch();
                  say(t("Other devices have been signed out."));
                });
              }}
            />
          ) : null}
        </Section>

        <Section title={t("Your data") }>
          <Card padded={false}>
            <Row
              first
              title={t("Export everything")}
              subtitle={t("Every year, subject and grade, as JSON.")}
              onPress={() => exportData.mutate()}
            />
          </Card>
        </Section>

        <Section title={t("Start over") }>
          <TextField
            label={t("Type RESET to confirm")}
            value={resetPhrase}
            onChangeText={setResetPhrase}
            autoCapitalize="none"
          />
          <Button
            label={t("Clear everything")}
            variant="destructive"
            disabled={resetPhrase !== "RESET"}
            loading={reset.isPending}
            onPress={() => reset.mutate()}
          />
        </Section>

        <Section title={t("Delete this account") }>
          <TextField
            label={t("Type DELETE to confirm")}
            value={deletePhrase}
            onChangeText={setDeletePhrase}
            autoCapitalize="none"
          />
          <Button
            label={t("Delete my account")}
            variant="destructive"
            disabled={deletePhrase !== "DELETE"}
            onPress={() =>
              Alert.alert(
                t("Delete this account?"),
                t("We email you a link before anything is removed."),
                [
                  { text: t("Cancel"), style: "cancel" },
                  {
                    text: t("Continue"),
                    style: "destructive",
                    onPress: () => void deleteAccount(),
                  },
                ],
              )
            }
          />
        </Section>

        {status ? (
          <Section>
            <Confirmation>{status}</Confirmation>
          </Section>
        ) : null}
        {error ? (
          <Section>
            <Problem>{error}</Problem>
          </Section>
        ) : null}
      </Screen>
    </>
  );
}
