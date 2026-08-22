import type { ServiceKeyKind } from "../db/schema";
import { z } from "zod";

export const providerServiceKeyProviders = [
  "mistral",
  "openai",
  "openrouter",
  "elevenlabs",
  "gemini",
  "cohere",
] as const;

export type ProviderServiceKeyProvider =
  (typeof providerServiceKeyProviders)[number];

const providersByKind: Readonly<
  Record<ServiceKeyKind, ReadonlySet<ProviderServiceKeyProvider>>
> = {
  mistral: new Set(["mistral"]),
  transcription: new Set(["mistral"]),
  inference: new Set([
    "openai",
    "openrouter",
    "elevenlabs",
    "gemini",
    "cohere",
  ]),
};

/** Fail closed before validation, persistence or resolution can mix adapters. */
export function assertProviderServiceKeyRoute(
  kind: ServiceKeyKind,
  provider: string,
): asserts provider is ProviderServiceKeyProvider {
  if (
    !providerServiceKeyProviders.includes(
      provider as ProviderServiceKeyProvider,
    ) ||
    !providersByKind[kind].has(provider as ProviderServiceKeyProvider)
  ) {
    throw new Error(`SERVICE_KEY_PROVIDER_ROUTE_UNSUPPORTED:${kind}:${provider}`);
  }
}

export const providerServiceKeyRouteSchema = z
  .strictObject({
    kind: z.enum(["mistral", "transcription", "inference"]),
    provider: z.enum(providerServiceKeyProviders),
  })
  .superRefine((route, context) => {
    try {
      assertProviderServiceKeyRoute(route.kind, route.provider);
    } catch {
      context.addIssue({
        code: "custom",
        path: ["provider"],
        message: "Provider does not implement this credential capability",
      });
    }
  });
