import type { Config } from "@libsql/client";

export const LOCAL_SQLITE_BUSY_TIMEOUT_MS = 5_000;

export function isLocalSqliteUrl(url: string) {
  return url === ":memory:" || url.startsWith("file:");
}

export function databaseClientConfig(input: {
  url: string;
  authToken?: string;
}): Config {
  return {
    url: input.url,
    authToken: input.authToken,
    timeout: isLocalSqliteUrl(input.url)
      ? LOCAL_SQLITE_BUSY_TIMEOUT_MS
      : undefined,
  };
}
