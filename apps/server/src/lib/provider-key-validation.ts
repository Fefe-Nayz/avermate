export type SupportedKeyProvider =
  | "mistral"
  | "openai"
  | "openrouter"
  | "elevenlabs"
  | "gemini"
  | "cohere";

const probes: Record<
  SupportedKeyProvider,
  { url: string; headers: (key: string) => HeadersInit }
> = {
  mistral: {
    url: "https://api.mistral.ai/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
  openai: {
    url: "https://api.openai.com/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
  openrouter: {
    url: "https://openrouter.ai/api/v1/models",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
  elevenlabs: {
    url: "https://api.elevenlabs.io/v1/user/subscription",
    headers: (key) => ({ "xi-api-key": key }),
  },
  gemini: {
    url: "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-2",
    headers: (key) => ({ "x-goog-api-key": key }),
  },
  cohere: {
    url: "https://api.cohere.com/v1/models?endpoint=rerank",
    headers: (key) => ({ authorization: `Bearer ${key}` }),
  },
};

export async function validateProviderCredential(
  provider: SupportedKeyProvider,
  key: string,
  options: { fetch?: typeof fetch; timeoutMs?: number } = {},
) {
  const probe = probes[provider];
  const response = await (options.fetch ?? fetch)(probe.url, {
    method: "GET",
    headers: { ...probe.headers(key), accept: "application/json" },
    redirect: "error",
    signal: AbortSignal.timeout(Math.min(options.timeoutMs ?? 10_000, 15_000)),
  });
  if (!response.ok) {
    throw new Error(
      response.status === 401 || response.status === 403
        ? "PROVIDER_KEY_REJECTED"
        : "PROVIDER_KEY_VALIDATION_UNAVAILABLE",
    );
  }
}
