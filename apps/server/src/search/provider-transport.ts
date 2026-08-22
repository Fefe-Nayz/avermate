const textDecoder = new TextDecoder("utf-8", { fatal: true });

export type ProviderFetcher = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export function providerSignal(signal: AbortSignal, deadlineMs: number) {
  if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 120_000) {
    throw new Error("Provider deadline is outside the supported range");
  }
  signal.throwIfAborted();
  return AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);
}

/** Read a provider body without ever buffering beyond the declared ceiling. */
export async function boundedProviderJson(
  response: Response,
  maximumBytes: number,
): Promise<unknown> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maximumBytes) {
    throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
  }
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      bytes += next.value.byteLength;
      if (bytes > maximumBytes) {
        await reader.cancel("provider response exceeded the byte limit");
        throw new Error("PROVIDER_RESPONSE_TOO_LARGE");
      }
      chunks.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(textDecoder.decode(body)) as unknown;
  } catch {
    throw new Error("PROVIDER_RESPONSE_INVALID_JSON");
  }
}

export function redactedProviderHttpError(label: string, response: Response) {
  // Provider bodies can echo queries or candidate documents and are therefore
  // deliberately excluded from errors, logs, traces and durable job results.
  return new Error(`${label}_HTTP_${response.status}`);
}

export function utf8Bytes(value: string) {
  return new TextEncoder().encode(value).byteLength;
}
