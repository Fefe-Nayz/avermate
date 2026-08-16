import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { Icon } from "@/components/icon";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TextField } from "@/components/field";
import {
  Badge,
  Button,
  Card,
  Confirmation,
  Empty,
  Loading,
  Note,
  Problem,
  Screen,
  Section,
  Title,
} from "@/components/ui";
import { authClient, useSession } from "@/lib/auth-client";
import { env } from "@/lib/env";
import { haptic } from "@/lib/haptics";
import { t } from "@/lib/i18n";
import {
  AVERMATE_OAUTH_SCOPES,
  oauthIntegrationQueryKeys,
  publicClientRegistration,
} from "@/lib/oauth-integrations";
import { radius, space, type, usePalette } from "@/lib/theme";

interface OAuthClientSummary {
  client_id: string;
  client_name?: string;
  redirect_uris?: string[];
  scope?: string;
  token_endpoint_auth_method?: string;
  grant_types?: string[];
  require_pkce?: boolean;
  disabled?: boolean;
  client_id_issued_at?: number;
}

interface OAuthConsentSummary {
  id: string;
  clientId: string;
  scopes: string[];
  createdAt: Date | string | number;
  updatedAt: Date | string | number;
}

const SCOPE_OPTIONS = AVERMATE_OAUTH_SCOPES.map((scope) => ({
  scope,
  ...(scope === "avermate:read" ? { required: true as const } : {}),
}));

function displayDate(value: string | number | undefined): string | null {
  if (value === undefined) return null;
  const date = new Date(
    typeof value === "number" && value < 10_000_000_000 ? value * 1000 : value,
  );
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString();
}

function errorMessage(error: unknown, fallback: string): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }
  return fallback;
}

/**
 * A value whose only purpose is to be copied.
 *
 * The address is the whole product of this page — it is what someone pastes
 * into their assistant — so it is drawn as something pressable, not as a grey
 * caption.
 */
function CopyValue({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  const palette = usePalette();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await Clipboard.setStringAsync(value);
    setCopied(true);
    haptic("success");
    setTimeout(() => setCopied(false), 1_800);
  };

  return (
    <Pressable
      accessibilityLabel={t("Copy {label}", { label })}
      accessibilityRole="button"
      onPress={() => void copy()}
      style={({ pressed }) => ({
        minHeight: 48,
        flexDirection: "row",
        alignItems: "center",
        gap: space.sm,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        backgroundColor: pressed ? palette.accentSoft : palette.background,
        paddingHorizontal: space.md,
        opacity: pressed ? 0.84 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2, paddingVertical: space.sm }}>
        <Text style={[type.label, { color: palette.textFaint }]}>{label}</Text>
        <Text
          selectable
          numberOfLines={1}
          style={[
            type.footnote,
            {
              color: muted ? palette.textMuted : palette.text,
              fontFamily: "monospace",
            },
          ]}
        >
          {value}
        </Text>
      </View>
      <Icon
        name={copied ? "checkmark" : "copy-outline"}
        size={17}
        color={copied ? palette.positive : palette.textMuted}
      />
      <Text accessibilityLiveRegion="polite" style={{ width: 0, height: 0 }}>
        {copied ? t("Copied.") : ""}
      </Text>
    </Pressable>
  );
}

function ScopeChoice({
  description,
  disabled,
  label,
  selected,
  toggle,
}: {
  description: string;
  disabled?: boolean;
  label: string;
  selected: boolean;
  toggle: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={toggle}
      style={({ pressed }) => ({
        minHeight: 64,
        flexDirection: "row",
        alignItems: "center",
        gap: space.md,
        padding: space.md,
        borderRadius: radius.md,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: selected ? palette.accent : palette.border,
        backgroundColor: selected ? palette.accentSoft : palette.surface,
        opacity: disabled ? 0.75 : pressed ? 0.8 : 1,
      })}
    >
      <Icon
        name={selected ? "checkbox" : "square-outline"}
        size={23}
        color={selected ? palette.text : palette.textFaint}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <View
          style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
        >
          <Text style={[type.body, { color: palette.text }]}>{label}</Text>
          {disabled ? <Badge label={t("Always")} /> : null}
        </View>
        <Text style={[type.footnote, { color: palette.textMuted }]}>
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

/** A quiet inline destructive action, the web's ghost text button. */
function DangerAction({
  label,
  disabled,
  onPress,
}: {
  label: string;
  disabled?: boolean;
  onPress: () => void;
}) {
  const palette = usePalette();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      hitSlop={8}
      onPress={() => {
        haptic("warning");
        onPress();
      }}
      style={({ pressed }) => ({
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
        opacity: disabled ? 0.4 : pressed ? 0.6 : 1,
      })}
    >
      <Text style={[type.callout, { color: palette.negative }]}>{label}</Text>
    </Pressable>
  );
}

/**
 * Integrations.
 *
 * Written for someone connecting an assistant, not someone implementing
 * OAuth: the address to paste comes first, grants are named and described in
 * plain permissions, and the registration form is folded away because most
 * assistants never need it.
 */
export default function Integrations() {
  const palette = usePalette();
  const queryClient = useQueryClient();
  const { data: session } = useSession();
  const owner = session?.user.id ?? "anonymous";
  const { clients: clientsKey, consents: consentsKey } =
    oauthIntegrationQueryKeys(owner);
  const [name, setName] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [scopes, setScopes] = useState<Set<string>>(
    new Set(["avermate:read", "avermate:write"]),
  );
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [registerChoice, setRegisterChoice] = useState<boolean | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const say = (message: string) => {
    haptic("success");
    setProblem(null);
    setStatus(message);
  };
  const complain = (message: string) => {
    haptic("error");
    setStatus(null);
    setProblem(message);
  };

  const scopeCopy = {
    "avermate:read": {
      label: t("Read"),
      description: t("Years, subjects, grades, averages, goals and analytics."),
    },
    "avermate:write": {
      label: t("Write"),
      description: t("Create and update academic data and preferences."),
    },
    "avermate:delete": {
      label: t("Delete"),
      description: t("Expose confirmed destructive tools."),
    },
    "avermate:admin": {
      label: t("Admin"),
      description: t(
        "Expose administration tools when this account is an admin.",
      ),
    },
  } satisfies Record<
    (typeof SCOPE_OPTIONS)[number]["scope"],
    { label: string; description: string }
  >;

  /** `avermate:write` means nothing to a reader; "Write" does. */
  const scopeLabel = (scope: string) => {
    if (scope in scopeCopy) {
      return scopeCopy[scope as keyof typeof scopeCopy].label;
    }
    if (scope === "openid" || scope === "profile") return t("Identity");
    if (scope === "offline_access") return t("Stay signed in");
    return scope;
  };

  const baseUrl = env.apiUrl.replace(/\/$/, "");
  const mcpUrl = useMemo(() => `${baseUrl}/mcp`, [baseUrl]);
  const metadataUrl = useMemo(
    () => `${baseUrl}/.well-known/oauth-protected-resource/mcp`,
    [baseUrl],
  );

  const clients = useQuery({
    queryKey: clientsKey,
    queryFn: async () => {
      const result = await authClient.oauth2.getClients();
      if (result.error) throw result.error;
      return [...((result.data ?? []) as OAuthClientSummary[])].sort(
        (left, right) => left.client_id.localeCompare(right.client_id),
      );
    },
    enabled: owner !== "anonymous",
    staleTime: 30_000,
  });
  const consents = useQuery({
    queryKey: consentsKey,
    queryFn: async () => {
      const result = await authClient.oauth2.getConsents();
      if (result.error) throw result.error;
      return [...((result.data ?? []) as OAuthConsentSummary[])].sort(
        (left, right) => left.clientId.localeCompare(right.clientId),
      );
    },
    enabled: owner !== "anonymous",
    staleTime: 30_000,
  });

  /** A grant is about an assistant, so show the assistant, not its id. */
  const clientNames = useMemo(
    () =>
      new Map(
        (clients.data ?? []).map((client) => [
          client.client_id,
          client.client_name ?? "",
        ]),
      ),
    [clients.data],
  );

  const createClient = useMutation({
    mutationFn: async () => {
      const result = await authClient.oauth2.createClient(
        publicClientRegistration({ name, redirectUri, scopes }),
      );
      if (result.error) throw result.error;
      if (!result.data?.client_id) {
        throw new Error(t("The OAuth client was not created."));
      }
      return result.data as OAuthClientSummary;
    },
    onSuccess: (created) => {
      queryClient.setQueryData<OAuthClientSummary[]>(
        clientsKey,
        (current = []) =>
          [...current, created].sort((left, right) =>
            left.client_id.localeCompare(right.client_id),
          ),
      );
      setName("");
      setRedirectUri("");
      setRegisterChoice(false);
      say(t("Integration client created."));
    },
    onError: (error) =>
      complain(errorMessage(error, t("The client could not be created."))),
  });

  const revokeClient = useMutation({
    mutationFn: async (clientId: string) => {
      const result = await authClient.oauth2.deleteClient({
        client_id: clientId,
      });
      if (result.error) throw result.error;
      return clientId;
    },
    onSuccess: (clientId) => {
      queryClient.setQueryData<OAuthClientSummary[]>(
        clientsKey,
        (current = []) =>
          current.filter((client) => client.client_id !== clientId),
      );
      queryClient.setQueryData<OAuthConsentSummary[]>(
        consentsKey,
        (current = []) =>
          current.filter((consent) => consent.clientId !== clientId),
      );
      say(t("Client revoked."));
    },
    onError: (error) => complain(errorMessage(error, t("Revocation failed."))),
  });

  const revokeConsent = useMutation({
    mutationFn: async (consentId: string) => {
      const result = await authClient.oauth2.deleteConsent({ id: consentId });
      if (result.error) throw result.error;
      return consentId;
    },
    onSuccess: (consentId) => {
      queryClient.setQueryData<OAuthConsentSummary[]>(
        consentsKey,
        (current = []) => current.filter((consent) => consent.id !== consentId),
      );
      say(t("Access grant revoked."));
    },
    onError: (error) => complain(errorMessage(error, t("Revocation failed."))),
  });

  const busy =
    createClient.isPending || revokeClient.isPending || revokeConsent.isPending;
  const canCreate = name.trim().length > 0 && redirectUri.trim().length > 0;

  if (clients.isPending || consents.isPending) return <Loading />;
  if (clients.isError || consents.isError) {
    return (
      <Screen>
        <Stack.Screen options={{ title: t("Integrations") }} />
        <Empty
          icon="cloud-offline-outline"
          title={t("Integrations could not be loaded.")}
          body={t("Check your connection and try again.")}
          action={
            <Button
              label={t("Try again")}
              onPress={() => {
                void clients.refetch();
                void consents.refetch();
              }}
            />
          }
        />
      </Screen>
    );
  }

  const clientList = clients.data ?? [];
  const consentList = consents.data ?? [];
  // The form starts open only when nothing is registered — the common case is
  // an assistant that registers itself and never needs this section.
  const registerOpen = registerChoice ?? clientList.length === 0;

  const confirmRemoveClient = (client: OAuthClientSummary) =>
    Alert.alert(
      t("Remove this client?"),
      t(
        "Its saved grants and refresh access will be removed. Short-lived access tokens already issued expire on their own.",
      ),
      [
        { text: t("Cancel"), style: "cancel" },
        {
          text: t("Remove client"),
          style: "destructive",
          onPress: () => revokeClient.mutate(client.client_id),
        },
      ],
    );

  return (
    <Screen>
      <Stack.Screen options={{ title: t("Integrations") }} />
      <Title
        subtitle={t(
          "Let an AI assistant read or update your Avermate data, without ever giving it your password.",
        )}
      >
        {t("Integrations")}
      </Title>

      <Section
        icon="sparkles"
        title={t("Connect an assistant")}
        description={t(
          "Paste this address into an assistant that speaks MCP. It will ask you to sign in, then to approve exactly what it may do.",
        )}
      >
        <Card style={{ gap: space.md }}>
          <CopyValue label={t("Avermate MCP server")} value={mcpUrl} />
          <Pressable
            accessibilityRole="button"
            accessibilityState={{ expanded: discoveryOpen }}
            onPress={() => {
              haptic("selection");
              setDiscoveryOpen((current) => !current);
            }}
            style={({ pressed }) => ({
              flexDirection: "row",
              alignItems: "center",
              gap: space.xs,
              alignSelf: "flex-start",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Icon
              name={discoveryOpen ? "chevron-up" : "chevron-down"}
              size={14}
              color={palette.textMuted}
            />
            <Text style={[type.footnote, { color: palette.textMuted }]}>
              {t("My assistant asks for a discovery URL")}
            </Text>
          </Pressable>
          {discoveryOpen ? (
            <CopyValue
              muted
              label={t("Protected-resource metadata")}
              value={metadataUrl}
            />
          ) : null}
        </Card>
      </Section>

      <Section
        icon="shield-checkmark-outline"
        title={t("What has access")}
        description={t(
          "Revoking blocks any further use straight away. A token already handed out stops working within minutes.",
        )}
      >
        {consentList.length === 0 ? (
          <Card>
            <Text style={[type.body, { color: palette.textMuted }]}>
              {t("Nothing has access to your account right now.")}
            </Text>
          </Card>
        ) : (
          <Card padded={false}>
            {consentList.map((consent, index) => {
              const label =
                clientNames.get(consent.clientId) || t("Unnamed assistant");
              return (
                <View
                  key={consent.id}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: space.md,
                    padding: space.md,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: palette.hairline,
                  }}
                >
                  <View
                    style={{
                      width: 36,
                      height: 36,
                      alignItems: "center",
                      justifyContent: "center",
                      borderRadius: radius.md,
                      borderCurve: "continuous",
                      backgroundColor: palette.accentSoft,
                    }}
                  >
                    <Icon name="sparkles" size={18} color={palette.accent} />
                  </View>
                  <View style={{ flex: 1, gap: space.sm }}>
                    <Text
                      selectable
                      style={[type.callout, { color: palette.text }]}
                    >
                      {label}
                    </Text>
                    <View
                      style={{
                        flexDirection: "row",
                        flexWrap: "wrap",
                        gap: space.xs,
                      }}
                    >
                      {consent.scopes.map((scope) => (
                        <Badge key={scope} label={scopeLabel(scope)} />
                      ))}
                    </View>
                  </View>
                  <DangerAction
                    label={t("Revoke access")}
                    disabled={busy}
                    onPress={() => revokeConsent.mutate(consent.id)}
                  />
                </View>
              );
            })}
          </Card>
        )}
      </Section>

      <Section
        icon="lock-closed-outline"
        title={t("Registered clients")}
        description={t(
          "Only needed for assistants that cannot register themselves. A client ID is a public identifier — there is no secret to protect.",
        )}
      >
        {clientList.length === 0 && !registerOpen ? (
          <Card>
            <Text style={[type.body, { color: palette.textMuted }]}>
              {t("No client registered. Most assistants do not need one.")}
            </Text>
          </Card>
        ) : null}

        {clientList.length > 0 ? (
          <Card padded={false}>
            {clientList.map((client, index) => {
              const issuedAt = displayDate(client.client_id_issued_at);
              return (
                <View
                  key={client.client_id}
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: space.md,
                    padding: space.md,
                    borderTopWidth: index === 0 ? 0 : StyleSheet.hairlineWidth,
                    borderTopColor: palette.hairline,
                  }}
                >
                  <View style={{ flex: 1, gap: space.xs }}>
                    <Text
                      selectable
                      style={[type.callout, { color: palette.text }]}
                    >
                      {client.client_name || t("Unnamed client")}
                    </Text>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={t("Copy {label}", {
                        label: client.client_id,
                      })}
                      onPress={() => {
                        haptic("success");
                        void Clipboard.setStringAsync(client.client_id);
                        say(t("Copied."));
                      }}
                      style={({ pressed }) => ({
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.xs,
                        opacity: pressed ? 0.6 : 1,
                      })}
                    >
                      <Text
                        numberOfLines={1}
                        style={[
                          type.footnote,
                          {
                            color: palette.textMuted,
                            fontFamily: "monospace",
                            flexShrink: 1,
                          },
                        ]}
                      >
                        {client.client_id}
                      </Text>
                      <Icon
                        name="copy-outline"
                        size={12}
                        color={palette.textMuted}
                      />
                    </Pressable>
                    {client.redirect_uris?.map((uri) => (
                      <Text
                        key={uri}
                        numberOfLines={1}
                        style={[type.footnote, { color: palette.textMuted }]}
                      >
                        {t("Returns to")} {uri}
                      </Text>
                    ))}
                    {issuedAt ? (
                      <Text
                        style={[type.footnote, { color: palette.textMuted }]}
                      >
                        {t("Registered {date}", { date: issuedAt })}
                      </Text>
                    ) : null}
                  </View>
                  <DangerAction
                    label={t("Remove")}
                    disabled={busy}
                    onPress={() => confirmRemoveClient(client)}
                  />
                </View>
              );
            })}
          </Card>
        ) : null}

        {registerOpen ? (
          <Card style={{ gap: space.lg }}>
            <TextField
              label={t("Client name")}
              value={name}
              onChangeText={setName}
              placeholder="Claude Desktop"
              maxLength={120}
              autoCapitalize="words"
            />
            <TextField
              label={t("Redirect URI")}
              value={redirectUri}
              onChangeText={setRedirectUri}
              placeholder="https://assistant.example/oauth/callback"
              keyboardType="url"
              autoCapitalize="none"
            />
            <View style={{ gap: space.sm }}>
              <Text style={[type.label, { color: palette.textFaint }]}>
                {t("The most this client may ever ask for")}
              </Text>
              {SCOPE_OPTIONS.map((option) => {
                const selected = scopes.has(option.scope);
                const copy = scopeCopy[option.scope];
                return (
                  <ScopeChoice
                    key={option.scope}
                    selected={selected}
                    disabled={"required" in option && option.required}
                    label={copy.label}
                    description={copy.description}
                    toggle={() =>
                      setScopes((current) => {
                        const next = new Set(current);
                        if (selected) next.delete(option.scope);
                        else next.add(option.scope);
                        return next;
                      })
                    }
                  />
                );
              })}
              <Note>
                {t(
                  "This is a ceiling, not a grant. You still approve each connection, and can approve less than this.",
                )}
              </Note>
            </View>
            <View style={{ gap: space.sm }}>
              <Button
                label={t("Create client")}
                icon="add"
                loading={createClient.isPending}
                disabled={!canCreate || busy}
                onPress={() => createClient.mutate()}
              />
              {clientList.length > 0 ? (
                <Button
                  label={t("Cancel")}
                  variant="ghost"
                  onPress={() => setRegisterChoice(false)}
                />
              ) : null}
              <Note>{t("No password or secret is created.")}</Note>
            </View>
          </Card>
        ) : (
          <Button
            label={t("Register a client")}
            icon="add"
            variant="secondary"
            onPress={() => setRegisterChoice(true)}
          />
        )}
      </Section>

      {status ? <Confirmation>{status}</Confirmation> : null}
      {problem ? <Problem>{problem}</Problem> : null}
    </Screen>
  );
}
