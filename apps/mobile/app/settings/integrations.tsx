import { useMemo, useState } from "react";
import { Alert, Pressable, StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { TextField } from "@/components/field";
import {
  Button,
  Card,
  Empty,
  Loading,
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

function Pill({ children }: { children: string }) {
  const palette = usePalette();
  return (
    <View
      style={{
        borderRadius: radius.pill,
        borderWidth: StyleSheet.hairlineWidth,
        borderColor: palette.border,
        backgroundColor: palette.accentSoft,
        paddingHorizontal: space.sm,
        paddingVertical: space.xs,
      }}
    >
      <Text selectable style={[type.footnote, { color: palette.textMuted }]}>
        {children}
      </Text>
    </View>
  );
}

function CopyValue({ label, value }: { label: string; value: string }) {
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
        backgroundColor: pressed ? palette.accentSoft : palette.background,
        paddingHorizontal: space.md,
        opacity: pressed ? 0.84 : 1,
      })}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.label, { color: palette.textFaint }]}>{label}</Text>
        <Text
          selectable
          numberOfLines={1}
          style={[
            type.footnote,
            { color: palette.text, fontFamily: "monospace" },
          ]}
        >
          {value}
        </Text>
      </View>
      <Ionicons
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
      <Ionicons
        name={selected ? "checkbox" : "square-outline"}
        size={23}
        color={selected ? palette.text : palette.textFaint}
      />
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={[type.body, { color: palette.text }]}>{label}</Text>
        <Text style={[type.footnote, { color: palette.textMuted }]}>
          {description}
        </Text>
      </View>
    </Pressable>
  );
}

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
      haptic("success");
      Alert.alert(t("Integration client created."));
    },
    onError: (error) =>
      Alert.alert(
        t("The client could not be created."),
        errorMessage(error, t("Please try again.")),
      ),
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
      haptic("success");
    },
    onError: (error) =>
      Alert.alert(
        t("Revocation failed."),
        errorMessage(error, t("Please try again.")),
      ),
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
      haptic("success");
    },
    onError: (error) =>
      Alert.alert(
        t("Revocation failed."),
        errorMessage(error, t("Please try again.")),
      ),
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

  return (
    <Screen>
      <Stack.Screen options={{ title: t("Integrations") }} />
      <Title
        subtitle={t("Connect AI assistants without sharing your password.")}
      >
        {t("Integrations")}
      </Title>

      <Section title={t("Avermate MCP")}>
        <Card style={{ gap: space.md }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <Ionicons name="sparkles" size={19} color={palette.accent} />
            <Text style={[type.heading, { flex: 1, color: palette.text }]}>
              MCP 2026-07-28 · Streamable HTTP
            </Text>
          </View>
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {t(
              "Assistants authenticate with OAuth 2.1 and only receive the permissions you approve.",
            )}
          </Text>
          <CopyValue label={t("MCP endpoint")} value={mcpUrl} />
          <CopyValue label={t("OAuth metadata")} value={metadataUrl} />
          <Text style={[type.label, { color: palette.textFaint }]}>
            {t("Available scopes")}
          </Text>
          {AVERMATE_OAUTH_SCOPES.map((scope) => (
            <CopyValue key={scope} label={t("OAuth scope")} value={scope} />
          ))}
        </Card>
      </Section>

      <Section title={t("Register a public client")}>
        <Card style={{ gap: space.lg }}>
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {t(
              "Use this when an assistant cannot publish a Client ID Metadata Document yet.",
            )}
          </Text>
          <TextField
            label={t("Client name")}
            value={name}
            onChangeText={setName}
            placeholder="Claude Desktop"
            autoCapitalize="words"
          />
          <TextField
            label={t("Redirect URI")}
            value={redirectUri}
            onChangeText={setRedirectUri}
            placeholder="http://127.0.0.1:8765/callback"
            keyboardType="url"
            autoCapitalize="none"
          />
          <View style={{ gap: space.sm }}>
            <Text style={[type.label, { color: palette.textFaint }]}>
              {t("Maximum permissions")}
            </Text>
            {SCOPE_OPTIONS.map((option) => {
              const selected = scopes.has(option.scope);
              const copy = scopeCopy[option.scope];
              return (
                <ScopeChoice
                  key={option.scope}
                  selected={selected}
                  disabled={"required" in option && option.required}
                  label={`${copy.label} · ${option.scope}`}
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
          </View>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.sm }}
          >
            <Pill>PKCE S256</Pill>
            <Pill>client auth: none</Pill>
          </View>
          <Text style={[type.footnote, { color: palette.textMuted }]}>
            {t("No client secret is created.")}
          </Text>
          <Button
            label={t("Create client")}
            icon="add"
            loading={createClient.isPending}
            disabled={!canCreate || busy}
            onPress={() => createClient.mutate()}
          />
        </Card>
      </Section>

      <Section title={t("Registered clients")}>
        {(clients.data ?? []).length === 0 ? (
          <Card>
            <Text style={[type.body, { color: palette.textMuted }]}>
              {t("No integration client has been registered yet.")}
            </Text>
          </Card>
        ) : (
          (clients.data ?? []).map((client) => {
            const issuedAt = displayDate(client.client_id_issued_at);
            return (
              <Card key={client.client_id} style={{ gap: space.md }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "flex-start",
                    gap: space.md,
                  }}
                >
                  <View style={{ flex: 1, gap: space.xs }}>
                    <Text style={[type.heading, { color: palette.text }]}>
                      {client.client_name || t("Unnamed client")}
                    </Text>
                    <CopyValue
                      label={t("Client ID")}
                      value={client.client_id}
                    />
                  </View>
                  <Pressable
                    accessibilityLabel={t("Revoke client")}
                    accessibilityRole="button"
                    disabled={busy}
                    onPress={() =>
                      Alert.alert(
                        t("Revoke this client?"),
                        t(
                          "Its saved grants and refresh access will be removed. Short-lived access tokens already issued expire on their own.",
                        ),
                        [
                          { text: t("Cancel"), style: "cancel" },
                          {
                            text: t("Revoke client"),
                            style: "destructive",
                            onPress: () =>
                              revokeClient.mutate(client.client_id),
                          },
                        ],
                      )
                    }
                    style={{ padding: space.sm, opacity: busy ? 0.4 : 1 }}
                  >
                    <Ionicons
                      name="trash-outline"
                      size={21}
                      color={palette.negative}
                    />
                  </Pressable>
                </View>
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.sm,
                  }}
                >
                  <Pill>PKCE S256</Pill>
                  <Pill>{client.token_endpoint_auth_method ?? "none"}</Pill>
                  {issuedAt ? <Pill>{issuedAt}</Pill> : null}
                </View>
                {client.redirect_uris?.map((uri) => (
                  <CopyValue key={uri} label={t("Redirect URI")} value={uri} />
                ))}
              </Card>
            );
          })
        )}
      </Section>

      <Section title={t("Authorized connections")}>
        {(consents.data ?? []).length === 0 ? (
          <Card>
            <Text style={[type.body, { color: palette.textMuted }]}>
              {t("No assistant currently has an active grant.")}
            </Text>
          </Card>
        ) : (
          (consents.data ?? []).map((consent) => (
            <Card key={consent.id} style={{ gap: space.md }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-start",
                  gap: space.md,
                }}
              >
                <View style={{ flex: 1, gap: space.sm }}>
                  <CopyValue label={t("Client ID")} value={consent.clientId} />
                  <View
                    style={{
                      flexDirection: "row",
                      flexWrap: "wrap",
                      gap: space.sm,
                    }}
                  >
                    {consent.scopes.map((scope) => (
                      <Pill key={scope}>{scope}</Pill>
                    ))}
                  </View>
                </View>
                <Pressable
                  accessibilityLabel={t("Revoke access grant")}
                  accessibilityRole="button"
                  disabled={busy}
                  onPress={() =>
                    Alert.alert(t("Revoke this access grant?"), undefined, [
                      { text: t("Cancel"), style: "cancel" },
                      {
                        text: t("Revoke access"),
                        style: "destructive",
                        onPress: () => revokeConsent.mutate(consent.id),
                      },
                    ])
                  }
                  style={{ padding: space.sm, opacity: busy ? 0.4 : 1 }}
                >
                  <Ionicons
                    name="trash-outline"
                    size={21}
                    color={palette.negative}
                  />
                </Pressable>
              </View>
            </Card>
          ))
        )}
        <Text
          style={[
            type.footnote,
            { color: palette.textMuted, paddingHorizontal: space.xs },
          ]}
        >
          {t(
            "Better Auth does not expose a stable token-list API. Access tokens are therefore never serialized into this page.",
          )}
        </Text>
      </Section>
    </Screen>
  );
}
