import { expect, test } from "bun:test";
import { createPinnedOpenRouterTransport } from "./openrouter-transport";

test("OpenRouter capability transport pins one upstream and disables both fallback mechanisms", async () => {
  let calls = 0;
  const transport = createPinnedOpenRouterTransport(async (_url, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body));
    expect(body.provider).toEqual({
      order: ["openai"],
      only: ["openai"],
      allow_fallbacks: false,
      require_parameters: true,
    });
    expect(body.models).toBeUndefined();
    expect(body.route).toBeUndefined();
    expect(init?.redirect).toBe("manual");
    return Response.json({}, { status: 503 });
  });
  const result = await transport(
    "https://openrouter.ai/api/v1/chat/completions",
    {
      method: "POST",
      headers: { authorization: "Bearer fixture" },
      body: JSON.stringify({
        model: "openai/gpt-4.1-mini",
        models: ["other-model"],
        route: "fallback",
        provider: { order: ["azure"], allow_fallbacks: true },
      }),
    },
  );
  expect(result.status).toBe(503);
  expect(calls).toBe(1);
  await expect(
    transport("https://untrusted.example/api/v1/chat/completions", {
      method: "POST",
      body: "{}",
    }),
  ).rejects.toThrow("ENDPOINT_MISMATCH");
  await expect(
    transport("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: "other-model" }),
    }),
  ).rejects.toThrow("MODEL_MISMATCH");
  expect(calls).toBe(1);
});
