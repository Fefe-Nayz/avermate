import { safeModelFetchResponse } from "../../agent/model-endpoint-policy";
import type { ProviderFetcher } from "../../search/provider-transport";

const origin = "https://openrouter.ai";
const model = "openai/gpt-4.1-mini";

/** Reviewed single-upstream route. No user-controlled provider options or fallback. */
export function createPinnedOpenRouterTransport(
  providerFetch?: ProviderFetcher,
): ProviderFetcher {
  return async (raw, init) => {
    const url = new URL(raw);
    if (
      url.href !== `${origin}/api/v1/chat/completions` ||
      init?.method !== "POST" ||
      typeof init.body !== "string"
    ) {
      throw new Error("OPENROUTER_CAPABILITY_ENDPOINT_MISMATCH");
    }
    const body = JSON.parse(init.body) as Record<string, unknown>;
    if (body.model !== model)
      throw new Error("OPENROUTER_CAPABILITY_MODEL_MISMATCH");
    // Model fallbacks and provider fallbacks are separate upstream mechanisms.
    delete body.models;
    delete body.route;
    body.provider = {
      order: ["openai"],
      only: ["openai"],
      allow_fallbacks: false,
      require_parameters: true,
    };
    const headers = new Headers(init.headers);
    const authorization = headers.get("authorization");
    if (!authorization)
      throw new Error("OPENROUTER_CAPABILITY_CREDENTIAL_MISSING");
    const request = {
      ...init,
      redirect: "manual" as const,
      body: JSON.stringify(body),
    };
    if (providerFetch) return providerFetch(url, request);
    headers.delete("authorization");
    return safeModelFetchResponse(url, {
      policy: { placement: "hosted-core", allowedOrigins: [origin] },
      credential: { origin, headerName: "authorization", value: authorization },
      method: "POST",
      headers,
      body: request.body,
      signal: init.signal ?? undefined,
      maxRedirects: 0,
      maxResponseBytes: 16 * 1024 * 1024,
      totalTimeoutMs: 120_000,
    });
  };
}
