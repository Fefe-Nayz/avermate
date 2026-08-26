export const SQLITE_BUSY_RETRY_DELAYS_MS = [50, 200] as const;

const RETRYABLE_SQLITE_CODES = new Set([
  "SQLITE_BUSY",
  "SQLITE_BUSY_SNAPSHOT",
  "SQLITE_LOCKED",
  "SQLITE_LOCKED_SHAREDCACHE",
]);

export function isSqliteBusyError(error: unknown): boolean {
  let current = error;
  for (let depth = 0; current && depth < 8; depth += 1) {
    const candidate = current as {
      cause?: unknown;
      code?: unknown;
      extendedCode?: unknown;
    };
    if (
      (typeof candidate.code === "string" &&
        RETRYABLE_SQLITE_CODES.has(candidate.code)) ||
      (typeof candidate.extendedCode === "string" &&
        RETRYABLE_SQLITE_CODES.has(candidate.extendedCode))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function retrySqliteBusy<T>(
  operation: () => Promise<T>,
  options: {
    delaysMs?: readonly number[];
    sleep?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<T> {
  const delays = options.delaysMs ?? SQLITE_BUSY_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ??
    ((delayMs: number) =>
      new Promise<void>((resolve) => setTimeout(resolve, delayMs)));

  for (let attempt = 0; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= delays.length) throw error;
      await sleep(delays[attempt]!);
    }
  }
}
