import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const repositoryRoot = resolve(import.meta.dir, "../../../..");

describe("self-host deployment contract", () => {
  test("exposes every documented MCP and costly-capability setting in Compose", () => {
    const compose = readFileSync(resolve(repositoryRoot, "deploy.yml"), "utf8");
    const documentedEnvironment = readFileSync(
      resolve(repositoryRoot, "apps/server/.env.example"),
      "utf8",
    );
    const requiredComposeVariables = [
      "MCP_RESOURCE_URL",
      "MCP_REQUEST_STATE_SECRET",
      "MCP_ALLOWED_HOSTS",
      "MCP_ALLOWED_ORIGINS",
      "MCP_ENABLE_DCR",
      "GOOGLE_DRIVE_CLIENT_ID",
      "GOOGLE_DRIVE_CLIENT_SECRET",
      "GOOGLE_DRIVE_REDIRECT_URI",
      "GOOGLE_DRIVE_WEBHOOK_URL",
      "MISTRAL_API_KEY",
      "TRANSCRIPTION_API_KEY",
      "TRANSCRIPTION_PROVIDER",
      "TTS_PROVIDER",
      "TTS_MODEL",
      "TTS_VOICE_ID",
      "INFERENCE_API_KEY",
      "OCR_MAX_PAGES_PER_DOCUMENT",
      "DISABLE_EMAIL",
      "DISABLE_UPLOADS",
      "DISABLE_JOBS",
      "DISABLE_OCR",
      "DISABLE_TRANSCRIPTION",
      "DISABLE_TTS",
    ] as const;

    for (const variable of requiredComposeVariables) {
      expect(documentedEnvironment).toMatch(new RegExp(`^${variable}=`, "m"));
      expect(compose).toMatch(new RegExp(`- ${variable}=`));
    }
  });
});
