import Constants from "expo-constants";

/**
 * Where the API lives.
 *
 * A phone cannot reach `localhost` — that is the phone. In development the
 * host running Metro is the machine serving the API too, so its address is
 * read from the packager URL and only falls back to the configured value.
 */
function developmentHost(): string | null {
  const source =
    Constants.expoConfig?.hostUri ??
    // Older SDKs expose it here; both are absent in a production build.
    (Constants.expoGoConfig as { debuggerHost?: string } | undefined)
      ?.debuggerHost;
  if (!source) return null;

  const host = source.split(":")[0];
  return host ? `http://${host}:5000` : null;
}

const configured = process.env.EXPO_PUBLIC_SERVER_URL;

export const env = {
  apiUrl: configured ?? developmentHost() ?? "http://localhost:5000",
  scheme: (Constants.expoConfig?.scheme as string | undefined) ?? "avermate",
} as const;
