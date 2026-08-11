import { useState } from "react";
import { Alert, Text, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Button,
  Card,
  Empty,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
} from "@/components/ui";
import { ChoiceField, SwitchField, TextField } from "@/components/field";
import { DateField } from "@/components/date-field";
import { AdminGate } from "@/components/admin/admin-gate";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

const invalidate = (key: readonly unknown[]) =>
  queryClient.invalidateQueries({ queryKey: key });

export function AdminOverviewScreen() {
  const palette = usePalette();
  const router = useRouter();
  const overview = useQuery(
    orpc.admin.overview.queryOptions({ input: { days: 30 } }),
  );

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Administration") }} />
      <Screen>
        {overview.isLoading ? <Loading /> : null}
        {overview.data ? (
          <>
            <Section title={t("Last 30 days")}>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                }}
              >
                {[
                  [t("Users"), overview.data.totals.users],
                  [t("Years"), overview.data.totals.years],
                  [t("Subjects"), overview.data.totals.subjects],
                  [t("Grades"), overview.data.totals.grades],
                  [t("Weekly active"), overview.data.weeklyActiveUsers],
                  [t("Open feedback"), overview.data.openFeedback],
                ].map(([label, value]) => (
                  <Card
                    key={String(label)}
                    style={{ flexBasis: "47%", flexGrow: 1 }}
                  >
                    <Text style={[type.footnote, { color: palette.textMuted }]}>
                      {label}
                    </Text>
                    <Text
                      selectable
                      style={[type.title, numeric, { color: palette.text }]}
                    >
                      {String(value)}
                    </Text>
                  </Card>
                ))}
              </View>
            </Section>
            <Section title={t("Manage")}>
              <Card padded={false}>
                <Row
                  first
                  title={t("Users")}
                  onPress={() => router.push("/admin/users")}
                />
                <Row
                  title={t("Announcements")}
                  onPress={() => router.push("/admin/announcements")}
                />
                <Row
                  title={t("Feedback")}
                  onPress={() => router.push("/admin/feedback")}
                />
                <Row
                  title={t("Social moderation")}
                  onPress={() => router.push("/admin/social")}
                />
                <Row
                  title={t("Managed presets")}
                  onPress={() => router.push("/admin/presets")}
                />
              </Card>
            </Section>
          </>
        ) : null}
      </Screen>
    </AdminGate>
  );
}

export function AdminUsersScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");
  const users = useQuery(
    orpc.admin.users.queryOptions({
      input: { query: search.trim(), limit: 25, offset },
    }),
  );
  const create = useMutation({
    ...orpc.admin.createUser.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      await invalidate(orpc.admin.users.key());
    },
  });

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Users") }} />
      <Screen>
        <Section>
          <TextField
            label={t("Search")}
            value={search}
            onChangeText={(value) => {
              setSearch(value);
              setOffset(0);
            }}
            placeholder={t("Name, email or user ID")}
            autoCapitalize="none"
          />
        </Section>
        {users.isLoading ? <Loading /> : null}
        <Section title={t("{count} users", { count: users.data?.total ?? 0 })}>
          <Card padded={false}>
            {(users.data?.users ?? []).map((user, index) => (
              <Row
                key={user.id}
                first={index === 0}
                title={user.name}
                subtitle={`${user.email} · ${user.grades} ${t("grades")}`}
                trailing={
                  <Text
                    style={{
                      color: user.banned ? "#c0392b" : palette.textMuted,
                    }}
                  >
                    {user.banned ? t("Banned") : user.role}
                  </Text>
                }
                onPress={() =>
                  router.push({
                    pathname: "/admin/user/[id]",
                    params: { id: user.id },
                  })
                }
              />
            ))}
          </Card>
          <View style={{ flexDirection: "row", gap: space.sm }}>
            <View style={{ flex: 1 }}>
              <Button
                label={t("Previous")}
                variant="ghost"
                disabled={offset === 0}
                onPress={() => setOffset(Math.max(0, offset - 25))}
              />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                label={t("Next")}
                variant="ghost"
                disabled={offset + 25 >= (users.data?.total ?? 0)}
                onPress={() => setOffset(offset + 25)}
              />
            </View>
          </View>
        </Section>
        <Section title={t("Create a user")}>
          <TextField
            label={t("Name")}
            value={newName}
            onChangeText={setNewName}
          />
          <TextField
            label={t("Email")}
            value={newEmail}
            onChangeText={setNewEmail}
            keyboardType="email-address"
            autoCapitalize="none"
          />
          <TextField
            label={t("Temporary password")}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
          />
          <ChoiceField
            label={t("Role")}
            value={newRole}
            onChange={(value) => setNewRole(value as typeof newRole)}
            choices={[
              { value: "user", label: t("User") },
              { value: "admin", label: t("Administrator") },
            ]}
          />
          <Button
            label={t("Create user")}
            disabled={
              !newName.trim() ||
              !newEmail.includes("@") ||
              newPassword.length < 8
            }
            loading={create.isPending}
            onPress={() =>
              create.mutate({
                name: newName.trim(),
                email: newEmail.trim().toLowerCase(),
                password: newPassword,
                role: newRole,
              })
            }
          />
        </Section>
      </Screen>
    </AdminGate>
  );
}

export function AdminUserScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const userId = typeof params.id === "string" ? params.id : "";
  const details = useQuery({
    ...orpc.admin.user.queryOptions({ input: { userId, days: 90 } }),
    enabled: Boolean(userId),
  });
  const [banReason, setBanReason] = useState(t("Administrative suspension"));
  const [banDuration, setBanDuration] = useState("indefinite");
  const refresh = () => details.refetch();
  const setRole = useMutation({
    ...orpc.admin.setRole.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
      await invalidate(orpc.admin.users.key());
    },
  });
  const setBanned = useMutation({
    ...orpc.admin.setBanned.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
      await invalidate(orpc.admin.users.key());
    },
  });
  const remove = useMutation({
    ...orpc.admin.deleteUser.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      await invalidate(orpc.admin.users.key());
      router.replace("/admin/users");
    },
  });
  const grantTheme = useMutation({
    ...orpc.admin.grantTheme.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      await refresh();
    },
  });

  const suspensionExpiry = () => {
    if (banDuration === "indefinite") return null;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(banDuration));
    return expiresAt;
  };

  return (
    <AdminGate>
      <Stack.Screen options={{ title: details.data?.user.name ?? t("User") }} />
      {details.isLoading ? <Loading /> : null}
      {details.data ? (
        <Screen>
          <Section title={t("Identity")}>
            <Card padded={false}>
              <Row
                first
                title={details.data.user.name}
                subtitle={details.data.user.email}
              />
              <Row title={t("User ID")} subtitle={details.data.user.id} />
              <Row
                title={t("Email verified")}
                subtitle={details.data.user.emailVerified ? t("Yes") : t("No")}
              />
              <Row
                title={t("Created")}
                subtitle={new Date(
                  details.data.user.createdAt,
                ).toLocaleString()}
              />
            </Card>
          </Section>
          <Section title={t("Access")}>
            <ChoiceField
              label={t("Role")}
              value={details.data.user.role ?? "user"}
              onChange={(role) =>
                setRole.mutate({ userId, role: role as "user" | "admin" })
              }
              choices={[
                { value: "user", label: t("User") },
                { value: "admin", label: t("Administrator") },
              ]}
            />
            <SwitchField
              label={t("Suspended")}
              hint={t("Suspending also signs out every session")}
              value={Boolean(details.data.user.banned)}
              onValueChange={(banned) =>
                setBanned.mutate({
                  userId,
                  banned,
                  reason: banned
                    ? banReason.trim() || t("Administrative suspension")
                    : null,
                  expiresAt: banned ? suspensionExpiry() : null,
                })
              }
            />
            {!details.data.user.banned ? (
              <>
                <TextField
                  label={t("Suspension reason")}
                  value={banReason}
                  onChangeText={setBanReason}
                />
                <ChoiceField
                  label={t("Duration")}
                  value={banDuration}
                  onChange={setBanDuration}
                  columns={2}
                  choices={[
                    { value: "1", label: t("1 day") },
                    { value: "7", label: t("7 days") },
                    { value: "30", label: t("30 days") },
                    { value: "indefinite", label: t("Indefinite") },
                  ]}
                />
              </>
            ) : (
              <Note>
                {details.data.user.banReason ?? t("No suspension reason")}
              </Note>
            )}
            <SwitchField
              label={t("Mokattam theme")}
              hint={t("Grant this unlockable theme to the user")}
              value={details.data.user.mokattamThemeAvailable}
              onValueChange={(available) =>
                grantTheme.mutate({ userId, theme: "mokattam", available })
              }
            />
          </Section>
          <Section title={t("Usage")}>
            <Card padded={false}>
              <Row
                first
                title={t("Grades")}
                subtitle={String(details.data.totals.grades)}
              />
              <Row
                title={t("Subjects")}
                subtitle={String(details.data.totals.subjects)}
              />
              <Row
                title={t("Periods")}
                subtitle={String(details.data.totals.periods)}
              />
              <Row
                title={t("Custom averages")}
                subtitle={String(details.data.totals.customAverages)}
              />
              <Row
                title={t("Linked sign-ins")}
                subtitle={
                  details.data.providers
                    .map((provider) => provider.providerId)
                    .join(" · ") || t("None")
                }
              />
            </Card>
          </Section>
          <Section title={t("Years")}>
            {details.data.years.length === 0 ? (
              <Note>{t("No years")}</Note>
            ) : (
              <Card padded={false}>
                {details.data.years.map((year, index) => (
                  <Row
                    key={year.id}
                    first={index === 0}
                    title={year.name}
                    subtitle={`${new Date(year.startsAt).toLocaleDateString()} → ${new Date(year.endsAt).toLocaleDateString()}`}
                  />
                ))}
              </Card>
            )}
          </Section>
          <Section title={t("Sessions")}>
            <Card padded={false}>
              {details.data.sessions.map((session, index) => (
                <Row
                  key={session.id}
                  first={index === 0}
                  title={session.userAgent?.slice(0, 72) || t("Unknown device")}
                  subtitle={new Date(session.updatedAt).toLocaleString()}
                />
              ))}
            </Card>
          </Section>
          <Section title={t("Danger zone")}>
            <Button
              label={t("Delete user permanently")}
              variant="destructive"
              onPress={() =>
                Alert.alert(t("Delete this user?"), userId, [
                  { text: t("Cancel"), style: "cancel" },
                  {
                    text: t("Delete"),
                    style: "destructive",
                    onPress: () =>
                      remove.mutate({ userId, confirmation: userId }),
                  },
                ])
              }
            />
          </Section>
        </Screen>
      ) : null}
    </AdminGate>
  );
}

export function AdminAnnouncementsScreen() {
  const palette = usePalette();
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<"info" | "success" | "warning" | "danger">(
    "info",
  );
  const [scheduled, setScheduled] = useState(false);
  const [startsAt, setStartsAt] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() + 1);
    return value;
  });
  const [endsAt, setEndsAt] = useState(() => {
    const value = new Date();
    value.setDate(value.getDate() + 8);
    return value;
  });
  const announcements = useQuery(orpc.admin.announcements.queryOptions());
  const refresh = () => invalidate(orpc.admin.announcements.key());
  const create = useMutation({
    ...orpc.admin.createAnnouncement.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setTitle("");
      setMessage("");
      await refresh();
    },
  });
  const update = useMutation({
    ...orpc.admin.updateAnnouncement.mutationOptions(),
    onSuccess: refresh,
  });
  const remove = useMutation({
    ...orpc.admin.deleteAnnouncement.mutationOptions(),
    onSuccess: refresh,
  });

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Announcements") }} />
      <Screen>
        <Section title={t("New announcement")}>
          <TextField label={t("Title")} value={title} onChangeText={setTitle} />
          <TextField
            label={t("Message")}
            value={message}
            onChangeText={setMessage}
            multiline
          />
          <ChoiceField
            label={t("Tone")}
            value={tone}
            onChange={(value) => setTone(value as typeof tone)}
            columns={2}
            choices={[
              { value: "info", label: t("Information") },
              { value: "success", label: t("Success") },
              { value: "warning", label: t("Warning") },
              { value: "danger", label: t("Danger") },
            ]}
          />
          <SwitchField
            label={t("Schedule publication")}
            hint={t("Keep it hidden until the start date")}
            value={scheduled}
            onValueChange={setScheduled}
          />
          {scheduled ? (
            <>
              <DateField
                label={t("Starts")}
                value={startsAt}
                onChange={setStartsAt}
              />
              <DateField
                label={t("Ends")}
                value={endsAt}
                onChange={setEndsAt}
                min={startsAt}
              />
            </>
          ) : null}
          <Button
            label={t("Publish")}
            disabled={!title.trim() || !message.trim()}
            loading={create.isPending}
            onPress={() =>
              create.mutate({
                title: title.trim(),
                message: message.trim(),
                tone,
                active: true,
                startsAt: scheduled ? startsAt : null,
                endsAt: scheduled ? endsAt : null,
              })
            }
          />
        </Section>
        <Section title={t("History")}>
          <View style={{ gap: space.md }}>
            {(announcements.data ?? []).map((announcement) => (
              <Card key={announcement.id}>
                <Text
                  selectable
                  style={[type.heading, { color: palette.text }]}
                >
                  {announcement.title}
                </Text>
                <Text selectable style={[type.body, { color: palette.text }]}>
                  {announcement.message}
                </Text>
                <SwitchField
                  label={t("Active")}
                  value={announcement.active}
                  onValueChange={(active) =>
                    update.mutate({ announcementId: announcement.id, active })
                  }
                />
                <Button
                  label={t("Delete")}
                  variant="destructive"
                  onPress={() =>
                    remove.mutate({ announcementId: announcement.id })
                  }
                />
              </Card>
            ))}
          </View>
        </Section>
      </Screen>
    </AdminGate>
  );
}

export function AdminFeedbackScreen() {
  const palette = usePalette();
  const [status, setStatus] = useState<"open" | "closed" | "all">("open");
  const [offset, setOffset] = useState(0);
  const feedback = useQuery(
    orpc.admin.feedback.queryOptions({ input: { status, limit: 25, offset } }),
  );
  const update = useMutation({
    ...orpc.admin.setFeedbackStatus.mutationOptions(),
    onSuccess: () => invalidate(orpc.admin.feedback.key()),
  });

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Feedback") }} />
      <Screen>
        <ChoiceField
          value={status}
          onChange={(value) => {
            setStatus(value as typeof status);
            setOffset(0);
          }}
          choices={[
            { value: "open", label: t("Open") },
            { value: "closed", label: t("Closed") },
            { value: "all", label: t("All") },
          ]}
          columns={2}
        />
        {feedback.isLoading ? <Loading /> : null}
        {(feedback.data ?? []).length === 0 ? (
          <Empty icon="checkmark-circle-outline" title={t("Nothing here")} />
        ) : (
          <View style={{ gap: space.md }}>
            {(feedback.data ?? []).map((item) => (
              <Card key={item.id}>
                <View style={{ gap: space.sm }}>
                  <Text
                    selectable
                    style={[type.heading, { color: palette.text }]}
                  >
                    {item.subject}
                  </Text>
                  <Text
                    selectable
                    style={[type.footnote, { color: palette.textMuted }]}
                  >
                    {item.userName} · {item.userEmail} · {item.kind}
                  </Text>
                  <Text selectable style={[type.body, { color: palette.text }]}>
                    {item.message}
                  </Text>
                  {item.attachmentUrl ? (
                    <Image
                      source={item.attachmentUrl}
                      contentFit="contain"
                      style={{
                        width: "100%",
                        height: 200,
                        borderRadius: radius.md,
                      }}
                    />
                  ) : null}
                  <Button
                    label={item.status === "open" ? t("Close") : t("Reopen")}
                    variant="secondary"
                    onPress={() =>
                      update.mutate({
                        feedbackId: item.id,
                        status: item.status === "open" ? "closed" : "open",
                      })
                    }
                  />
                </View>
              </Card>
            ))}
          </View>
        )}
        <View style={{ flexDirection: "row", gap: space.sm }}>
          <View style={{ flex: 1 }}>
            <Button
              label={t("Previous")}
              variant="ghost"
              disabled={offset === 0}
              onPress={() => setOffset(Math.max(0, offset - 25))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              label={t("Next")}
              variant="ghost"
              disabled={(feedback.data?.length ?? 0) < 25}
              onPress={() => setOffset(offset + 25)}
            />
          </View>
        </View>
      </Screen>
    </AdminGate>
  );
}
