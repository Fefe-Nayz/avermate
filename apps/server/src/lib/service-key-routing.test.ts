import { describe, expect, test } from "bun:test";
import {
  assertProviderServiceKeyRoute,
  providerServiceKeyRouteSchema,
} from "./service-key-routing";
import { providerOperatorKey } from "./service-keys";

describe("provider service-key routing", () => {
  test("allows only the provider that owns each adapter credential", () => {
    expect(() =>
      assertProviderServiceKeyRoute("transcription", "mistral"),
    ).not.toThrow();
    expect(() =>
      assertProviderServiceKeyRoute("mistral", "mistral"),
    ).not.toThrow();
    expect(() =>
      assertProviderServiceKeyRoute("inference", "openai"),
    ).not.toThrow();
    expect(() =>
      assertProviderServiceKeyRoute("inference", "openrouter"),
    ).not.toThrow();
  });

  test("rejects cross-provider and unknown credential routes", () => {
    expect(() =>
      assertProviderServiceKeyRoute("transcription", "openai"),
    ).toThrow("SERVICE_KEY_PROVIDER_ROUTE_UNSUPPORTED:transcription:openai");
    expect(() => assertProviderServiceKeyRoute("mistral", "openai")).toThrow(
      "SERVICE_KEY_PROVIDER_ROUTE_UNSUPPORTED:mistral:openai",
    );
    expect(() => assertProviderServiceKeyRoute("inference", "mistral")).toThrow(
      "SERVICE_KEY_PROVIDER_ROUTE_UNSUPPORTED:inference:mistral",
    );
    expect(() =>
      assertProviderServiceKeyRoute("transcription", "unknown"),
    ).toThrow("SERVICE_KEY_PROVIDER_ROUTE_UNSUPPORTED:transcription:unknown");
    expect(
      providerServiceKeyRouteSchema.safeParse({
        kind: "transcription",
        provider: "openai",
      }).success,
    ).toBe(false);
    expect(
      providerServiceKeyRouteSchema.safeParse({
        kind: "transcription",
        provider: "mistral",
      }).success,
    ).toBe(true);
  });

  test("never routes one legacy operator inference key to multiple origins", () => {
    const legacy = {
      MISTRAL_API_KEY: undefined,
      TRANSCRIPTION_API_KEY: undefined,
      OPENAI_API_KEY: undefined,
      OPENROUTER_API_KEY: undefined,
      ELEVENLABS_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      COHERE_API_KEY: undefined,
      INFERENCE_API_KEY: "legacy-secret",
      INFERENCE_PROVIDER: undefined,
    };
    expect(providerOperatorKey("inference", "openai", legacy)).toBeUndefined();
    expect(
      providerOperatorKey("inference", "openrouter", legacy),
    ).toBeUndefined();
    expect(
      providerOperatorKey("inference", "openai", {
        ...legacy,
        INFERENCE_PROVIDER: "openai",
      }),
    ).toBe("legacy-secret");
    expect(
      providerOperatorKey("inference", "openrouter", {
        ...legacy,
        INFERENCE_PROVIDER: "openai",
      }),
    ).toBeUndefined();
  });

  test("keeps exact OpenAI and OpenRouter operator keys isolated", () => {
    const values = {
      MISTRAL_API_KEY: undefined,
      TRANSCRIPTION_API_KEY: undefined,
      OPENAI_API_KEY: "openai-secret",
      OPENROUTER_API_KEY: "openrouter-secret",
      ELEVENLABS_API_KEY: undefined,
      GEMINI_API_KEY: undefined,
      COHERE_API_KEY: undefined,
      INFERENCE_API_KEY: undefined,
      INFERENCE_PROVIDER: undefined,
    };
    expect(providerOperatorKey("inference", "openai", values)).toBe(
      "openai-secret",
    );
    expect(providerOperatorKey("inference", "openrouter", values)).toBe(
      "openrouter-secret",
    );
  });
});
