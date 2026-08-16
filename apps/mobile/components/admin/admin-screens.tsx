import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Confirmation,
  Loading,
  Note,
  Problem,
  Row,
  Screen,
  Section,
  StatTile,
} from "@/components/ui";
import { ChoiceField, SwitchField, TextField } from "@/components/field";
import { DateField } from "@/components/date-field";
import { formatDate, formatNumber } from "@/components/format";
import { Icon } from "@/components/icon";
import { AdminGate } from "@/components/admin/admin-gate";
import { useSession } from "@/lib/auth-client";
import { haptic } from "@/lib/haptics";
import { locale, t } from "@/lib/i18n";
import { orpc, queryClient } from "@/lib/orpc";
import { numeric, radius, space, type, usePalette } from "@/lib/theme";

/**
 * The admin surfaces, aligned screen by screen with the web admin area
 * (`apps/web/src/app/(app)/admin`): the same metrics, the same actions, the
 * same confirmations — laid out with the mobile kit instead of cards and
 * dialogs. Server error messages are surfaced verbatim, exactly where the web
 * toasts them.
 */

const invalidate = (key: readonly unknown[]) =>
  queryClient.invalidateQueries({ queryKey: key });

export type AdminRange = 30 | 90 | 180 | 365 | "all";

/** "12 Aug 2026, 14:05" — the web's `dateStyle: medium, timeStyle: short`. */
export function formatDateTime(value: Date | string): string {
  return new Date(value).toLocaleString(locale() === "fr" ? "fr-FR" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function percentage(value: number | null | undefined): string {
  return `${(value ?? 0).toFixed(1)}%`;
}

function decimal(value: number | null | undefined): string {
  return value == null ? "—" : value.toFixed(2);
}

function hasAdminRole(role: string | null | undefined): boolean {
  return (role ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .includes("admin");
}

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
  return initials || "?";
}

/** The web's activity range selector, shared by the overview and user detail. */
function RangeField({
  value,
  onChange,
}: {
  value: AdminRange;
  onChange: (value: AdminRange) => void;
}) {
  return (
    <ChoiceField
      label={t("Activity range")}
      value={String(value)}
      onChange={(next) =>
        onChange(next === "all" ? "all" : (Number(next) as 30 | 90 | 180 | 365))
      }
      columns={2}
      choices={[
        { value: "30", label: t("30 days") },
        { value: "90", label: t("90 days") },
        { value: "180", label: t("180 days") },
        { value: "365", label: t("1 year") },
        { value: "all", label: t("All time") },
      ]}
    />
  );
}

/**
 * The web's interactive activity chart, reduced to what a phone card can
 * carry: the same day-by-day series, bucketed to a fixed number of bars so a
 * year still shows its shape, with the domain ends labelled underneath.
 */
function ActivityBars({
  data,
}: {
  data: ReadonlyArray<{ day: string; count: number }>;
}) {
  const palette = usePalette();
  const points = data
    .map((datum) => ({
      timestamp: Date.parse(`${datum.day}T00:00:00Z`),
      count: datum.count,
    }))
    .filter((point) => Number.isFinite(point.timestamp))
    .sort((left, right) => left.timestamp - right.timestamp);

  if (points.length === 0) {
    return (
      <Text
        style={[
          type.footnote,
          {
            color: palette.textFaint,
            textAlign: "center",
            paddingVertical: space.lg,
          },
        ]}
      >
        —
      </Text>
    );
  }

  const DAY = 86_400_000;
  const first = points[0]!.timestamp;
  const last = points[points.length - 1]!.timestamp;
  const spanDays = Math.max(1, Math.round((last - first) / DAY) + 1);
  const bucketDays = Math.max(1, Math.ceil(spanDays / 42));
  const values = Array.from(
    { length: Math.ceil(spanDays / bucketDays) },
    () => 0,
  );
  for (const point of points) {
    const index = Math.floor((point.timestamp - first) / DAY / bucketDays);
    values[index] = (values[index] ?? 0) + point.count;
  }
  const maximum = Math.max(1, ...values);

  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 2,
          height: 72,
        }}
      >
        {values.map((value, index) => (
          <View
            key={index}
            style={{
              flex: 1,
              height: Math.max(3, Math.round((value / maximum) * 72)),
              borderRadius: 2,
              backgroundColor:
                value === 0 ? palette.accentSoft : palette.accent,
              opacity: value === 0 ? 0.7 : 0.9,
            }}
          />
        ))}
      </View>
      <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={[type.footnote, { color: palette.textFaint }]}>
          {formatDate(new Date(first), "short")}
        </Text>
        <Text style={[type.footnote, { color: palette.textFaint }]}>
          {formatDate(new Date(last), "short")}
        </Text>
      </View>
    </View>
  );
}

function AdminAvatar({
  name,
  image,
  size = 40,
}: {
  name: string;
  image?: string | null;
  size?: number;
}) {
  const palette = usePalette();
  if (image) {
    return (
      <Image
        source={image}
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: palette.accentSoft,
        }}
      />
    );
  }
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: palette.accentSoft,
      }}
    >
      <Text style={[type.callout, { color: palette.textMuted }]}>
        {initialsOf(name)}
      </Text>
    </View>
  );
}

/** The web's user badges: admin, verified email, suspended, Mokattam. */
function UserMarks({
  user,
}: {
  user: {
    role: string | null;
    emailVerified: boolean;
    banned: boolean;
    mokattamThemeAvailable: boolean;
  };
}) {
  const palette = usePalette();
  return (
    <View
      style={{
        flexDirection: "row",
        flexWrap: "wrap",
        alignItems: "center",
        gap: space.xs,
      }}
    >
      {hasAdminRole(user.role) ? (
        <Badge label={t("Admin")} icon="shield-checkmark" />
      ) : null}
      {user.emailVerified ? (
        <Icon name="checkmark-circle" size={14} color={palette.positive} />
      ) : null}
      {user.banned ? (
        <Badge label={t("Suspended")} icon="ban-outline" toneColor="negative" />
      ) : null}
      {user.mokattamThemeAvailable ? (
        <Badge label={t("Mokattam")} icon="sparkles" toneColor="accent" />
      ) : null}
    </View>
  );
}

// ---------------------------------------------------------------- overview

export function AdminOverviewScreen() {
  const router = useRouter();
  const [range, setRange] = useState<AdminRange>(30);
  const overview = useQuery(
    orpc.admin.overview.queryOptions({ input: { days: range } }),
  );
  const data = overview.data;

  const metrics = data
    ? [
        {
          label: t("Accounts"),
          value: formatNumber(data.totals.users),
          hint: t("{count} created in 30 days", {
            count: data.last30Days.newUsers,
          }),
        },
        {
          label: t("Grades"),
          value: formatNumber(data.totals.grades),
          hint: t("{count} added in 30 days", {
            count: data.last30Days.newGrades,
          }),
        },
        {
          label: t("Active users"),
          value: formatNumber(data.last30Days.activeUsers),
          hint: t("Accounts that recorded a grade in 30 days"),
        },
        {
          label: t("Suspended"),
          value: formatNumber(data.totals.bannedUsers),
          hint: t("{count} administrator accounts", {
            count: data.totals.admins,
          }),
        },
        {
          label: t("Verified email"),
          value: percentage(data.health.verificationRate),
          hint: t("{count} verified accounts", {
            count: data.health.verifiedUsers,
          }),
        },
        {
          label: t("Grade adoption"),
          value: percentage(data.health.adoptionRate),
          hint: t("{count} accounts have recorded a grade", {
            count: data.health.usersWithGrades,
          }),
        },
        {
          label: t("Global average"),
          value: decimal(data.health.globalAverageOn20),
          hint:
            data.health.passRateOn20 == null
              ? t("Not enough grade data")
              : t("{rate} of account averages are at least 10/20", {
                  rate: percentage(data.health.passRateOn20),
                }),
        },
        {
          label: t("Grades per account"),
          value: decimal(data.health.averageGradesPerUser),
          hint: t("{count} among active accounts", {
            count: decimal(data.health.averageGradesPerActiveUser),
          }),
        },
      ]
    : [];

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Administration") }} />
      <Screen>
        <Note>{t("Product health, adoption and account operations.")}</Note>
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
            <Row
              title={t("Card gallery")}
              onPress={() => router.push("/admin/card-templates")}
            />
          </Card>
        </Section>

        <RangeField value={range} onChange={setRange} />

        {overview.isLoading ? <Loading /> : null}
        {data ? (
          <>
            <View
              style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
            >
              {metrics.map((metric) => (
                <View
                  key={metric.label}
                  style={{ flexBasis: "47%", flexGrow: 1 }}
                >
                  <StatTile
                    label={metric.label}
                    value={metric.value}
                    hint={metric.hint}
                  />
                </View>
              ))}
            </View>

            <Section title={t("New accounts")}>
              <Card>
                <ActivityBars data={data.signups} />
              </Card>
            </Section>
            <Section title={t("Grades recorded")}>
              <Card>
                <ActivityBars data={data.gradeActivity} />
              </Card>
            </Section>

            <Section title={t("Last 7 days")}>
              <View style={{ flexDirection: "row", gap: space.sm }}>
                <StatTile
                  label={t("accounts")}
                  value={formatNumber(data.last7Days.newUsers)}
                />
                <StatTile
                  label={t("grades")}
                  value={formatNumber(data.last7Days.newGrades)}
                />
                <StatTile
                  label={t("active")}
                  value={formatNumber(data.last7Days.activeUsers)}
                />
              </View>
            </Section>

            <Section title={t("Roles")}>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                  paddingHorizontal: space.xs,
                }}
              >
                {data.distribution.roles.map((entry) => (
                  <Badge
                    key={entry.role}
                    label={`${entry.role} · ${formatNumber(entry.count)}`}
                  />
                ))}
              </View>
            </Section>

            <Section title={t("Sign-in providers")}>
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                  paddingHorizontal: space.xs,
                }}
              >
                {data.distribution.providers.map((entry) => (
                  <Badge
                    key={entry.providerId}
                    label={`${entry.providerId} · ${formatNumber(entry.count)}`}
                  />
                ))}
              </View>
            </Section>

            <Section title={t("Most active accounts")}>
              <Card padded={false}>
                {data.topUsers.map((user, index) => (
                  <Row
                    key={user.id}
                    first={index === 0}
                    title={user.name}
                    subtitle={user.email}
                    trailing={
                      <Badge
                        label={t("{count} grades", { count: user.gradeCount })}
                      />
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
            </Section>

            <Section title={t("Most used subjects")}>
              <Card padded={false}>
                {data.topSubjects.map((subject, index) => (
                  <Row
                    key={subject.id}
                    first={index === 0}
                    title={subject.name}
                    trailing={
                      <Badge
                        label={t("{count} grades", {
                          count: subject.gradeCount,
                        })}
                      />
                    }
                  />
                ))}
              </Card>
            </Section>
          </>
        ) : null}
      </Screen>
    </AdminGate>
  );
}

// ------------------------------------------------------------------- users

const USERS_PAGE_SIZE = 25;

function AdminUserListRow({
  user,
  first,
  onPress,
}: {
  user: {
    id: string;
    name: string;
    email: string;
    image: string | null;
    role: string | null;
    emailVerified: boolean;
    banned: boolean;
    mokattamThemeAvailable: boolean;
    years: number;
    grades: number;
    createdAt: Date | string;
  };
  first: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      onPress={() => {
        haptic("selection");
        onPress();
      }}
      style={({ pressed }) => ({
        backgroundColor: pressed ? palette.accentSoft : "transparent",
      })}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          paddingHorizontal: space.lg,
          paddingVertical: space.md,
          borderTopWidth: first ? 0 : StyleSheet.hairlineWidth,
          borderTopColor: palette.hairline,
        }}
      >
        <AdminAvatar name={user.name} image={user.image} />
        <View style={{ flex: 1, gap: 2 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <Text
              numberOfLines={1}
              style={[type.callout, { flexShrink: 1, color: palette.text }]}
            >
              {user.name}
            </Text>
            <UserMarks user={user} />
          </View>
          <Text
            numberOfLines={1}
            style={[type.footnote, { color: palette.textMuted }]}
          >
            {user.email}
          </Text>
          <Text
            numberOfLines={1}
            style={[type.footnote, { color: palette.textFaint }]}
          >
            {t("{years} years · {grades} grades · joined {date}", {
              years: user.years,
              grades: user.grades,
              date: formatDate(new Date(user.createdAt), "short"),
            })}
          </Text>
        </View>
        <Icon name="chevron-forward" size={16} color={palette.textFaint} />
      </View>
    </Pressable>
  );
}

export function AdminUsersScreen() {
  const palette = usePalette();
  const router = useRouter();
  const [searchInput, setSearchInput] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<"user" | "admin">("user");

  // The web debounces the search by 250ms before it reaches the queue.
  useEffect(() => {
    const timer = setTimeout(() => {
      setQuery(searchInput.trim());
      setPage(1);
    }, 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const offset = (page - 1) * USERS_PAGE_SIZE;
  const users = useQuery(
    orpc.admin.users.queryOptions({
      input: { query, limit: USERS_PAGE_SIZE, offset },
    }),
  );
  const totalPages = Math.max(
    1,
    Math.ceil((users.data?.total ?? 0) / USERS_PAGE_SIZE),
  );

  const create = useMutation({
    ...orpc.admin.createUser.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setNewName("");
      setNewEmail("");
      setNewPassword("");
      setNewRole("user");
      await Promise.all([
        invalidate(orpc.admin.users.key()),
        invalidate(orpc.admin.overview.key()),
      ]);
    },
    onError: () => haptic("error"),
  });

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Users") }} />
      <Screen>
        <Note>
          {t("Search accounts, inspect their activity and manage access.")}
        </Note>
        <Section>
          <TextField
            label={t("Search")}
            value={searchInput}
            onChangeText={setSearchInput}
            placeholder={t("Search by name, email or id…")}
            autoCapitalize="none"
          />
        </Section>

        {users.isLoading ? <Loading /> : null}
        {users.data ? (
          <Section>
            {users.data.users.length === 0 ? (
              <Text
                style={[
                  type.footnote,
                  {
                    color: palette.textMuted,
                    textAlign: "center",
                    paddingVertical: space.xl,
                  },
                ]}
              >
                {t("Nobody matches.")}
              </Text>
            ) : (
              <Card padded={false}>
                {users.data.users.map((user, index) => (
                  <AdminUserListRow
                    key={user.id}
                    user={user}
                    first={index === 0}
                    onPress={() =>
                      router.push({
                        pathname: "/admin/user/[id]",
                        params: { id: user.id },
                      })
                    }
                  />
                ))}
              </Card>
            )}
            <Note>
              {t("Page {page} of {total} · {count} accounts", {
                page,
                total: totalPages,
                count: users.data.total,
              })}
            </Note>
            <View style={{ flexDirection: "row", gap: space.sm }}>
              <View style={{ flex: 1 }}>
                <Button
                  label={t("Previous")}
                  variant="ghost"
                  disabled={page <= 1 || users.isFetching}
                  onPress={() => setPage((current) => Math.max(1, current - 1))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Button
                  label={t("Next")}
                  variant="ghost"
                  disabled={page >= totalPages || users.isFetching}
                  onPress={() =>
                    setPage((current) => Math.min(totalPages, current + 1))
                  }
                />
              </View>
            </View>
          </Section>
        ) : null}

        <Section
          title={t("Create an account")}
          description={t(
            "The person must still verify their email before using application data.",
          )}
        >
          <TextField
            label={t("Name")}
            value={newName}
            onChangeText={setNewName}
            autoComplete="off"
          />
          <TextField
            label={t("Email")}
            value={newEmail}
            onChangeText={setNewEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            autoComplete="off"
          />
          <TextField
            label={t("Temporary password")}
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
            autoComplete="new-password"
          />
          <ChoiceField
            label={t("Role")}
            value={newRole}
            onChange={(value) => setNewRole(value as typeof newRole)}
            columns={2}
            choices={[
              { value: "user", label: t("User") },
              { value: "admin", label: t("Administrator") },
            ]}
          />
          <Button
            label={t("Create account")}
            icon="person-add-outline"
            disabled={
              create.isPending ||
              !newName.trim() ||
              !newEmail.trim() ||
              newPassword.length < 8
            }
            loading={create.isPending}
            onPress={() =>
              create.mutate({
                name: newName.trim(),
                email: newEmail.trim(),
                password: newPassword,
                role: newRole,
              })
            }
          />
          {create.isSuccess ? (
            <Confirmation>{t("Account created.")}</Confirmation>
          ) : null}
          {create.error instanceof Error ? (
            <Problem>{create.error.message}</Problem>
          ) : null}
        </Section>
      </Screen>
    </AdminGate>
  );
}

// ------------------------------------------------------------- user detail

export function AdminUserScreen() {
  const palette = usePalette();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string }>();
  const userId = typeof params.id === "string" ? params.id : "";
  const session = useSession();
  const self = session.data?.user.id === userId;
  const [range, setRange] = useState<AdminRange>(90);
  const details = useQuery({
    ...orpc.admin.user.queryOptions({ input: { userId, days: range } }),
    enabled: Boolean(userId),
  });
  const [banReason, setBanReason] = useState("");
  const [banDuration, setBanDuration] = useState("indefinite");
  const [confirmation, setConfirmation] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const refresh = async () => {
    await Promise.all([
      details.refetch(),
      invalidate(orpc.admin.users.key()),
      invalidate(orpc.admin.overview.key()),
    ]);
  };
  const done = (message: string) => {
    haptic("success");
    setNotice(message);
    setProblem(null);
    void refresh();
  };
  const fail = (error: Error) => {
    haptic("error");
    setNotice(null);
    setProblem(error.message);
  };

  const setRole = useMutation({
    ...orpc.admin.setRole.mutationOptions(),
    onSuccess: () => done(t("Role updated.")),
    onError: fail,
  });
  const setBanned = useMutation({
    ...orpc.admin.setBanned.mutationOptions(),
    onSuccess: (_data, variables) =>
      done(
        variables.banned ? t("Account suspended.") : t("Suspension lifted."),
      ),
    onError: fail,
  });
  const remove = useMutation({
    ...orpc.admin.deleteUser.mutationOptions(),
    onSuccess: async () => {
      haptic("warning");
      await Promise.all([
        invalidate(orpc.admin.users.key()),
        invalidate(orpc.admin.overview.key()),
      ]);
      router.replace("/admin/users");
    },
  });
  const grantTheme = useMutation({
    ...orpc.admin.grantTheme.mutationOptions(),
    onSuccess: (_data, variables) =>
      done(
        variables.available
          ? t("Mokattam unlocked for this account.")
          : t("Mokattam access removed."),
      ),
    onError: fail,
  });

  const suspensionExpiry = () => {
    if (banDuration === "indefinite") return null;
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + Number(banDuration));
    return expiresAt;
  };

  const data = details.data;
  const user = data?.user;
  const administrator = hasAdminRole(user?.role);

  const stats = data
    ? ([
        [t("Grades"), formatNumber(data.totals.grades)],
        [t("Subjects"), formatNumber(data.totals.subjects)],
        [t("Years"), formatNumber(data.totals.years)],
        [t("Custom averages"), formatNumber(data.totals.customAverages)],
        [t("Average /20"), decimal(data.gradeStats.averageOn20)],
        [t("Best /20"), decimal(data.gradeStats.bestOn20)],
        [t("Lowest /20"), decimal(data.gradeStats.worstOn20)],
        [t("Sessions"), formatNumber(data.totals.sessions)],
      ] as const)
    : [];

  return (
    <AdminGate>
      <Stack.Screen options={{ title: user?.name ?? t("User") }} />
      {details.isLoading ? <Loading /> : null}
      {data && user ? (
        <Screen>
          <Section>
            <Card style={{ gap: space.md }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                }}
              >
                <AdminAvatar name={user.name} image={user.image} size={48} />
                <View style={{ flex: 1, gap: 2 }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.sm,
                    }}
                  >
                    <Text
                      numberOfLines={1}
                      style={[
                        type.heading,
                        { flexShrink: 1, color: palette.text },
                      ]}
                    >
                      {user.name}
                    </Text>
                    <UserMarks user={user} />
                  </View>
                  <Text
                    selectable
                    numberOfLines={1}
                    style={[type.footnote, { color: palette.textMuted }]}
                  >
                    {user.email}
                  </Text>
                </View>
              </View>
              <Text
                selectable
                style={[type.footnote, numeric, { color: palette.textFaint }]}
              >
                {user.id}
              </Text>
            </Card>
            {user.banned ? (
              <Card style={{ borderColor: palette.negative, gap: 2 }}>
                <Text style={[type.callout, { color: palette.negative }]}>
                  {user.banReason ?? t("No suspension reason")}
                </Text>
                <Text style={[type.footnote, { color: palette.textMuted }]}>
                  {user.banExpires
                    ? t("Expires {date}", {
                        date: formatDateTime(user.banExpires),
                      })
                    : t("No automatic expiry")}
                </Text>
              </Card>
            ) : null}
          </Section>

          <RangeField value={range} onChange={setRange} />

          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            {stats.map(([label, value]) => (
              <View key={label} style={{ flexBasis: "47%", flexGrow: 1 }}>
                <StatTile label={label} value={value} />
              </View>
            ))}
          </View>

          <Section title={t("Grade activity")}>
            <Card>
              <ActivityBars data={data.timeline} />
            </Card>
          </Section>

          <Section title={t("Access")}>
            <ChoiceField
              label={t("Role")}
              value={user.role ?? "user"}
              onChange={(role) => {
                if (role !== (user.role ?? "user")) {
                  setRole.mutate({ userId, role: role as "user" | "admin" });
                }
              }}
              choices={[
                {
                  value: "user",
                  label: t("User"),
                  disabled: self && administrator,
                },
                { value: "admin", label: t("Administrator") },
              ]}
            />
            <SwitchField
              label={t("Mokattam theme")}
              hint={t("Grant this unlockable theme to the user")}
              value={user.mokattamThemeAvailable}
              disabled={grantTheme.isPending}
              onValueChange={(available) =>
                grantTheme.mutate({ userId, theme: "mokattam", available })
              }
            />
            {user.banned ? (
              <Button
                label={t("Lift suspension")}
                variant="secondary"
                icon="ban-outline"
                disabled={self}
                loading={setBanned.isPending}
                onPress={() =>
                  setBanned.mutate({
                    userId,
                    banned: false,
                    reason: null,
                    expiresAt: null,
                  })
                }
              />
            ) : (
              <>
                <TextField
                  label={t("Reason")}
                  value={banReason}
                  onChangeText={setBanReason}
                  placeholder={t("Explain why this account is suspended")}
                  maxLength={300}
                  multiline
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
                <Button
                  label={t("Suspend account")}
                  variant="destructive"
                  icon="ban-outline"
                  disabled={self || !banReason.trim()}
                  loading={setBanned.isPending}
                  onPress={() =>
                    setBanned.mutate({
                      userId,
                      banned: true,
                      reason: banReason.trim(),
                      expiresAt: suspensionExpiry(),
                    })
                  }
                />
                <Note>
                  {t(
                    "All current sessions are revoked immediately. The reason is shown when access is denied.",
                  )}
                </Note>
              </>
            )}
            {notice ? <Confirmation>{notice}</Confirmation> : null}
            {problem ? <Problem>{problem}</Problem> : null}
          </Section>

          <Section title={t("Academic years")}>
            {data.years.length === 0 ? (
              <Note>{t("No years")}</Note>
            ) : (
              <Card padded={false}>
                {data.years.map((year, index) => (
                  <Row
                    key={year.id}
                    first={index === 0}
                    title={year.name}
                    subtitle={`${formatDate(new Date(year.startsAt), "short")} → ${formatDate(new Date(year.endsAt), "short")}`}
                    trailing={
                      year.archivedAt ? <Badge label={t("Archived")} /> : null
                    }
                  />
                ))}
              </Card>
            )}
          </Section>

          <Section title={t("Linked sign-ins")}>
            {data.providers.length === 0 ? (
              <Note>{t("None")}</Note>
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  flexWrap: "wrap",
                  gap: space.sm,
                  paddingHorizontal: space.xs,
                }}
              >
                {data.providers.map((provider) => (
                  <Badge
                    key={`${provider.providerId}:${String(provider.createdAt)}`}
                    label={provider.providerId}
                    icon="link-outline"
                  />
                ))}
              </View>
            )}
          </Section>

          <Section title={t("Recent sessions")}>
            <Card padded={false}>
              {data.sessions.map((item, index) => (
                <Row
                  key={item.id}
                  first={index === 0}
                  title={item.userAgent?.slice(0, 72) || t("Unknown device")}
                  subtitle={`${item.ipAddress ?? t("Unknown IP")} · ${formatDateTime(item.updatedAt)}`}
                />
              ))}
            </Card>
          </Section>

          <Section title={t("Top subjects")}>
            <Card padded={false}>
              {data.topSubjects.map((subject, index) => (
                <Row
                  key={subject.id}
                  first={index === 0}
                  title={subject.name}
                  trailing={
                    <Badge
                      label={t("{count} grades", { count: subject.gradeCount })}
                    />
                  }
                />
              ))}
            </Card>
          </Section>

          <Section title={t("Recent grades")}>
            <Card padded={false}>
              {data.recentGrades.map((grade, index) => (
                <Row
                  key={grade.id}
                  first={index === 0}
                  title={grade.name}
                  subtitle={`${grade.subjectName} · ${formatDate(new Date(grade.passedAt), "short")}`}
                  trailing={
                    <Text
                      style={[type.callout, numeric, { color: palette.text }]}
                    >
                      {grade.value}/{grade.outOf}
                    </Text>
                  }
                />
              ))}
            </Card>
          </Section>

          <Section title={t("Danger zone")}>
            <Note>
              {t(
                "This permanently deletes the account and all of its years, grades, goals and settings. Type the account id to confirm.",
              )}
            </Note>
            <TextField
              label={t("User ID")}
              value={confirmation}
              onChangeText={setConfirmation}
              placeholder={userId}
              autoCapitalize="none"
            />
            <Button
              label={t("Delete permanently")}
              variant="destructive"
              icon="trash-outline"
              disabled={self || confirmation !== userId || remove.isPending}
              loading={remove.isPending}
              onPress={() => remove.mutate({ userId, confirmation })}
            />
            {remove.error instanceof Error ? (
              <Problem>{remove.error.message}</Problem>
            ) : null}
          </Section>
        </Screen>
      ) : null}
    </AdminGate>
  );
}

// ----------------------------------------------------------- announcements

type AnnouncementTone = "info" | "success" | "warning" | "danger";

function toneLabel(tone: string): string {
  switch (tone) {
    case "success":
      return t("Good news");
    case "warning":
      return t("Heads up");
    case "danger":
      return t("Problem");
    default:
      return t("Info");
  }
}

export function AdminAnnouncementsScreen() {
  const palette = usePalette();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [tone, setTone] = useState<AnnouncementTone>("info");
  const [audience, setAudience] = useState<"global" | "preset">("global");
  const [presetIds, setPresetIds] = useState<string[]>([]);
  const [active, setActive] = useState(true);
  const [startEnabled, setStartEnabled] = useState(false);
  const [endEnabled, setEndEnabled] = useState(false);
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
  const [notice, setNotice] = useState<string | null>(null);
  const [renderedAt] = useState(() => Date.now());
  const announcements = useQuery(orpc.admin.announcements.queryOptions());
  const presets = useQuery(orpc.presets.admin.list.queryOptions());
  const refresh = () =>
    Promise.all([
      invalidate(orpc.admin.announcements.key()),
      invalidate(orpc.announcements.active.key()),
      invalidate(orpc.announcements.history.key()),
    ]);
  const resetEditor = () => {
    const nextStart = new Date();
    nextStart.setDate(nextStart.getDate() + 1);
    const nextEnd = new Date(nextStart);
    nextEnd.setDate(nextEnd.getDate() + 7);
    setEditingId(null);
    setTitle("");
    setMessage("");
    setTone("info");
    setAudience("global");
    setPresetIds([]);
    setActive(true);
    setStartEnabled(false);
    setEndEnabled(false);
    setStartsAt(nextStart);
    setEndsAt(nextEnd);
  };
  const create = useMutation({
    ...orpc.admin.createAnnouncement.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setNotice(t("Announcement saved."));
      resetEditor();
      await refresh();
    },
    onError: () => setNotice(null),
  });
  const update = useMutation({
    ...orpc.admin.updateAnnouncement.mutationOptions(),
    onSuccess: async () => {
      setNotice(t("Announcement updated."));
      await refresh();
    },
    onError: () => setNotice(null),
  });
  const saveUpdate = useMutation({
    ...orpc.admin.updateAnnouncement.mutationOptions(),
    onSuccess: async () => {
      haptic("success");
      setNotice(t("Announcement updated."));
      resetEditor();
      await refresh();
    },
    onError: () => setNotice(null),
  });
  const remove = useMutation({
    ...orpc.admin.deleteAnnouncement.mutationOptions(),
    onSuccess: async () => {
      setNotice(t("Announcement deleted."));
      await refresh();
    },
    onError: () => setNotice(null),
  });
  const editorError = create.error ?? saveUpdate.error;
  const historyError = update.error ?? remove.error;

  return (
    <AdminGate>
      <Stack.Screen options={{ title: t("Announcements") }} />
      <Screen>
        <Note>
          {t("Publish immediately or schedule a precise visibility window.")}
        </Note>
        <Section
          title={editingId ? t("Edit announcement") : t("New announcement")}
          description={
            editingId
              ? t(
                  "Changes are reflected in the inbox and active banner immediately.",
                )
              : undefined
          }
        >
          <TextField
            label={t("Title")}
            value={title}
            onChangeText={setTitle}
            maxLength={120}
          />
          <TextField
            label={t("Message")}
            value={message}
            onChangeText={setMessage}
            multiline
            maxLength={2000}
          />
          <ChoiceField
            label={t("Tone")}
            value={tone}
            onChange={(value) => setTone(value as AnnouncementTone)}
            columns={2}
            choices={[
              { value: "info", label: t("Info") },
              { value: "success", label: t("Good news") },
              { value: "warning", label: t("Heads up") },
              { value: "danger", label: t("Problem") },
            ]}
          />
          <ChoiceField
            label={t("Audience")}
            value={audience}
            onChange={(value) => {
              const next = value as typeof audience;
              setAudience(next);
              if (next === "global") setPresetIds([]);
            }}
            columns={2}
            choices={[
              {
                value: "global",
                label: t("Everyone"),
                hint: t("All signed-in users"),
              },
              {
                value: "preset",
                label: t("Selected presets"),
                hint: t("Only linked members of the selected presets"),
              },
            ]}
          />
          {audience === "preset" ? (
            <View style={{ gap: space.sm }}>
              <Text style={[type.label, { color: palette.textFaint }]}>
                {t("Target presets")}
              </Text>
              {(presets.data ?? []).map((preset) => (
                <SwitchField
                  key={preset.id}
                  label={preset.name}
                  hint={preset.archived ? t("Archived") : undefined}
                  value={presetIds.includes(preset.id)}
                  onValueChange={(selected) =>
                    setPresetIds((current) =>
                      selected
                        ? [...current, preset.id]
                        : current.filter((id) => id !== preset.id),
                    )
                  }
                />
              ))}
              {(presets.data?.length ?? 0) === 0 ? (
                <Note>
                  {t(
                    "Create a managed preset before targeting an announcement.",
                  )}
                </Note>
              ) : presetIds.length === 0 ? (
                <Problem>{t("Select at least one preset.")}</Problem>
              ) : (
                <Note>
                  {presetIds.length === 1
                    ? t("One preset selected")
                    : t("{count} presets selected", {
                        count: presetIds.length,
                      })}
                </Note>
              )}
              <Note>
                {t(
                  "Preset targeting follows active memberships across preset updates. Users who customize their year leave that audience.",
                )}
              </Note>
            </View>
          ) : null}
          <SwitchField
            label={t("Schedule the start")}
            hint={t("Keep it hidden until the start date")}
            value={startEnabled}
            onValueChange={setStartEnabled}
          />
          {startEnabled ? (
            <DateField
              label={t("Starts")}
              value={startsAt}
              onChange={setStartsAt}
            />
          ) : null}
          <SwitchField
            label={t("Schedule the end")}
            hint={t("Remove it automatically at the end date")}
            value={endEnabled}
            onValueChange={setEndEnabled}
          />
          {endEnabled ? (
            <DateField
              label={t("Ends")}
              value={endsAt}
              onChange={setEndsAt}
              min={startEnabled ? startsAt : undefined}
            />
          ) : null}
          <SwitchField
            label={t("Active")}
            hint={t(
              "Inactive announcements stay as drafts regardless of their schedule.",
            )}
            value={active}
            onValueChange={setActive}
          />
          <Button
            label={
              editingId
                ? t("Save changes")
                : active
                  ? t("Publish or schedule")
                  : t("Save draft")
            }
            disabled={
              !title.trim() ||
              !message.trim() ||
              (audience === "preset" && presetIds.length === 0)
            }
            loading={editingId ? saveUpdate.isPending : create.isPending}
            onPress={() => {
              const values = {
                title: title.trim(),
                message: message.trim(),
                tone,
                audience,
                presetIds,
                active,
                startsAt: startEnabled ? startsAt : null,
                endsAt: endEnabled ? endsAt : null,
              };
              if (editingId) {
                saveUpdate.mutate({ announcementId: editingId, ...values });
              } else {
                create.mutate(values);
              }
            }}
          />
          {editingId ? (
            <Button label={t("Cancel")} variant="ghost" onPress={resetEditor} />
          ) : null}
          {notice ? <Confirmation>{notice}</Confirmation> : null}
          {editorError instanceof Error ? (
            <Problem>{editorError.message}</Problem>
          ) : null}
        </Section>
        <Section title={t("History")}>
          {announcements.data?.length === 0 ? (
            <Text
              style={[
                type.footnote,
                {
                  color: palette.textMuted,
                  textAlign: "center",
                  paddingVertical: space.xl,
                },
              ]}
            >
              {t("No announcements yet.")}
            </Text>
          ) : null}
          <View style={{ gap: space.md }}>
            {(announcements.data ?? []).map((announcement) => {
              const starts = announcement.startsAt
                ? new Date(announcement.startsAt).getTime()
                : null;
              const ends = announcement.endsAt
                ? new Date(announcement.endsAt).getTime()
                : null;
              const state = !announcement.active
                ? t("Inactive")
                : starts && starts > renderedAt
                  ? t("Scheduled")
                  : ends && ends < renderedAt
                    ? t("Expired")
                    : t("Visible");
              return (
                <Card key={announcement.id} style={{ gap: space.sm }}>
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      alignItems: "center",
                      gap: space.sm,
                    }}
                  >
                    <Text
                      selectable
                      numberOfLines={1}
                      style={[
                        type.heading,
                        { flexShrink: 1, color: palette.text },
                      ]}
                    >
                      {announcement.title}
                    </Text>
                    <Badge
                      label={state}
                      toneColor={announcement.active ? "accent" : "neutral"}
                    />
                    <Badge label={toneLabel(announcement.tone)} />
                    <Badge
                      label={
                        announcement.audience === "preset"
                          ? t("Selected presets")
                          : t("Everyone")
                      }
                    />
                  </View>
                  <Text selectable style={[type.body, { color: palette.text }]}>
                    {announcement.message}
                  </Text>
                  {announcement.audience === "preset" ? (
                    <Text style={[type.footnote, { color: palette.textMuted }]}>
                      {announcement.presets
                        .map((preset) => preset.name)
                        .join(", ")}
                    </Text>
                  ) : null}
                  <Text style={[type.footnote, { color: palette.textMuted }]}>
                    {(announcement.startsAt
                      ? t("Starts {date}", {
                          date: formatDateTime(announcement.startsAt),
                        })
                      : t("Starts immediately")) +
                      " · " +
                      (announcement.endsAt
                        ? t("ends {date}", {
                            date: formatDateTime(announcement.endsAt),
                          })
                        : t("no expiry"))}
                  </Text>
                  <SwitchField
                    label={t("Active")}
                    value={announcement.active}
                    onValueChange={(next) =>
                      update.mutate({
                        announcementId: announcement.id,
                        active: next,
                      })
                    }
                  />
                  <View style={{ flexDirection: "row", gap: space.sm }}>
                    <View style={{ flex: 1 }}>
                      <Button
                        size="sm"
                        label={t("Edit")}
                        variant="secondary"
                        onPress={() => {
                          const fallbackStart = new Date();
                          fallbackStart.setDate(fallbackStart.getDate() + 1);
                          const fallbackEnd = new Date(fallbackStart);
                          fallbackEnd.setDate(fallbackEnd.getDate() + 7);
                          setEditingId(announcement.id);
                          setTitle(announcement.title);
                          setMessage(announcement.message);
                          setTone(announcement.tone as AnnouncementTone);
                          setAudience(announcement.audience as typeof audience);
                          setPresetIds(announcement.presetIds);
                          setActive(announcement.active);
                          setStartEnabled(Boolean(announcement.startsAt));
                          setEndEnabled(Boolean(announcement.endsAt));
                          setStartsAt(
                            announcement.startsAt
                              ? new Date(announcement.startsAt)
                              : fallbackStart,
                          );
                          setEndsAt(
                            announcement.endsAt
                              ? new Date(announcement.endsAt)
                              : fallbackEnd,
                          );
                          setNotice(null);
                        }}
                      />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Button
                        size="sm"
                        label={t("Delete")}
                        variant="destructive"
                        disabled={remove.isPending}
                        onPress={() =>
                          remove.mutate({ announcementId: announcement.id })
                        }
                      />
                    </View>
                  </View>
                </Card>
              );
            })}
          </View>
          {historyError instanceof Error ? (
            <Problem>{historyError.message}</Problem>
          ) : null}
        </Section>
      </Screen>
    </AdminGate>
  );
}
