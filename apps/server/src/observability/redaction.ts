const sensitiveKey =
  /(?:authorization|cookie|password|secret|token|credential|api.?key|private.?key|signed.?url|prompt|document.?body|message.?body|raw.?payload)/iu;
const secretValue =
  /(?:\bBearer\s+[A-Za-z0-9._~+/-]{8,}|\bsk-[A-Za-z0-9_-]{12,}|[?&](?:X-Amz-Signature|X-Goog-Signature|sig|signature)=|-----BEGIN [A-Z ]*PRIVATE KEY-----)/iu;

const MAX_STRING = 2_048;
const MAX_ARRAY = 128;
const MAX_DEPTH = 16;

export function redactOperationalValue(
  input: unknown,
  depth = 0,
): unknown {
  if (depth > MAX_DEPTH) return "[DEPTH_LIMIT]";
  if (typeof input === "string") {
    if (secretValue.test(input)) return "[REDACTED]";
    return input.length > MAX_STRING
      ? `${input.slice(0, MAX_STRING)}…[TRUNCATED]`
      : input;
  }
  if (
    input === null ||
    typeof input === "number" ||
    typeof input === "boolean"
  ) {
    return input;
  }
  if (Array.isArray(input)) {
    return input
      .slice(0, MAX_ARRAY)
      .map((value) => redactOperationalValue(value, depth + 1));
  }
  if (typeof input === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(
      input as Record<string, unknown>,
    ).slice(0, 256)) {
      result[key] = sensitiveKey.test(key)
        ? "[REDACTED]"
        : redactOperationalValue(value, depth + 1);
    }
    return result;
  }
  return String(input);
}

export function assertNoOperationalSecret(input: unknown): void {
  const encoded = JSON.stringify(input);
  if (encoded && secretValue.test(encoded)) {
    throw new Error("OPERATIONAL_PAYLOAD_CONTAINS_SECRET");
  }
}

export function safeOperationalMetadata(input: unknown): unknown {
  const redacted = redactOperationalValue(input);
  assertNoOperationalSecret(redacted);
  return redacted;
}
