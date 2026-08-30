import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

const bool = z
  .union([z.boolean(), z.string()])
  .transform((value) =>
    typeof value === "boolean" ? value : value === "true" || value === "1",
  )
  .default(false);

export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    DATABASE_AUTH_TOKEN: z.string().optional(),

    BETTER_AUTH_URL: z.url(),
    BETTER_AUTH_SECRET: z.string().min(32),
    /** Optional independent root for sealed/hashed Node channel credentials. */
    NODE_CREDENTIAL_MASTER_SECRET: z.string().min(32).optional(),
    /** Optional independent root for deterministic Ed25519 Node grants. */
    NODE_GRANT_SIGNING_SECRET: z.string().min(32).optional(),
    /** Parent domain shared by the web and API services, for authenticated SSR. */
    AUTH_COOKIE_DOMAIN: z.string().min(1).optional(),
    ADMIN_USER_IDS: z.string().optional(),

    /** Canonical OAuth resource identifier exposed in access-token audiences. */
    MCP_RESOURCE_URL: z.url().optional(),
    /** Separate HMAC key for multi-round-trip requestState (falls back to BETTER_AUTH_SECRET). */
    MCP_REQUEST_STATE_SECRET: z.string().min(32).optional(),
    /** Additional comma-separated HTTP Host values accepted by the MCP endpoint. */
    MCP_ALLOWED_HOSTS: z.string().optional(),
    /** Additional comma-separated browser Origins accepted by the MCP endpoint. */
    MCP_ALLOWED_ORIGINS: z.string().optional(),
    /** Temporary RFC 7591 bridge. Off unless explicitly enabled; CIMD is preferred. */
    MCP_ENABLE_DCR: bool,

    CLIENT_URL: z.url(),
    /** URL scheme the mobile app returns to after an OAuth round trip. */
    MOBILE_SCHEME: z.string().default("avermate"),
    PORT: z.coerce.number().default(3000),
    NODE_ENV: z
      .enum(["development", "production", "test"])
      .default("development"),
    /** Plan 034 ships accounting in non-blocking shadow mode only. */
    MANAGED_ACCOUNTING_MODE: z.enum(["shadow", "enforce"]).default("shadow"),
    AVERMATE_DEPLOYMENT_MODE: z
      .enum(["hosted", "full-self-host"])
      .default("hosted"),
    /** Costly operator placements remain off until their launch gates pass. */
    MANAGED_ADAPTERS_ENABLED: bool,
    /** Invite, consent and beta quota gates fail closed before managed dispatch. */
    MANAGED_BETA_ENFORCEMENT_ENABLED: bool,
    /** Residency-aware managed pool/model catalogue region. */
    MANAGED_REGION: z.string().min(1).max(64).default("local"),
    MANAGED_TERMS_REVISION: z
      .string()
      .min(1)
      .max(128)
      .default("managed-beta/1"),
    MANAGED_PRIVACY_REVISION: z
      .string()
      .min(1)
      .max(128)
      .default("managed-privacy/1"),

    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),

    /** Separate delegated Graph grant used by the read-only Materials connector. */
    ONEDRIVE_CLIENT_ID: z.string().optional(),
    ONEDRIVE_CLIENT_SECRET: z.string().optional(),
    ONEDRIVE_TENANT_ID: z.string().min(1).default("common"),
    ONEDRIVE_REDIRECT_URI: z.url().optional(),
    ONEDRIVE_WEBHOOK_URL: z.url().optional(),

    /** Separate delegated Google Drive grant used by the Materials connector. */
    GOOGLE_DRIVE_CLIENT_ID: z.string().optional(),
    GOOGLE_DRIVE_CLIENT_SECRET: z.string().optional(),
    GOOGLE_DRIVE_REDIRECT_URI: z.url().optional(),
    GOOGLE_DRIVE_WEBHOOK_URL: z.url().optional(),

    RESEND_API_KEY: z.string().optional(),
    EMAIL_FROM: z.email().default("noreply@avermate.fr"),

    /** Local is zero-config for development; production should use Garage's S3 API. */
    STORAGE_DRIVER: z.enum(["local", "s3"]).optional(),
    LOCAL_UPLOAD_DIR: z.string().min(1).optional(),
    S3_ENDPOINT: z.url().optional(),
    S3_REGION: z.string().min(1).default("garage"),
    S3_ACCESS_KEY_ID: z.string().min(1).optional(),
    S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
    S3_BUCKET: z.string().min(1).default("avermate"),
    S3_PRIVATE_BUCKET: z.string().min(1).default("avermate"),
    MISTRAL_API_KEY: z.string().optional(),
    GEMINI_API_KEY: z.string().optional(),
    COHERE_API_KEY: z.string().optional(),
    TRANSCRIPTION_API_KEY: z.string().optional(),
    TRANSCRIPTION_PROVIDER: z.enum(["mistral", "node"]).default("mistral"),
    OCR_PROVIDER: z.enum(["mistral", "node"]).default("mistral"),
    TTS_PROVIDER: z.enum(["mistral"]).default("mistral"),
    /**
     * Capability rollout modes are deliberately per family. `shadow` resolves
     * and compares a registry route but still executes the legacy path once;
     * it must never issue a second provider request.
     */
    CAPABILITY_REGISTRY_SHADOW: bool,
    CAPABILITY_TTS_EXECUTION: z
      .enum(["legacy", "shadow", "registry"])
      .default("legacy"),
    CAPABILITY_STT_EXECUTION: z
      .enum(["legacy", "shadow", "registry"])
      .default("legacy"),
    CAPABILITY_OCR_EXECUTION: z
      .enum(["legacy", "shadow", "registry"])
      .default("legacy"),
    CAPABILITY_DOCUMENT_EXTRACTION_EXECUTION: z
      .enum(["legacy", "shadow", "registry"])
      .default("legacy"),
    CAPABILITY_RERANK_EXECUTION: z
      .enum(["legacy", "shadow", "registry"])
      .default("legacy"),
    CAPABILITY_EMBEDDING_EXECUTION: z
      .enum(["legacy", "shadow", "registry"])
      .default("legacy"),
    CAPABILITY_LANGUAGE_EXECUTION: z
      .enum(["legacy", "shadow", "registry"])
      .default("legacy"),
    TTS_MODEL: z.string().min(1).default("voxtral-mini-tts-2603"),
    /** Optional preset/custom Mistral voice id; empty uses the provider default. */
    TTS_VOICE_ID: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().optional(),
    OPENROUTER_API_KEY: z.string().optional(),
    ELEVENLABS_API_KEY: z.string().optional(),
    /**
     * Compatibility fence for the former generic inference key. The key is
     * ignored unless its one exact destination is declared.
     */
    INFERENCE_PROVIDER: z.enum(["openai", "openrouter"]).optional(),
    INFERENCE_API_KEY: z.string().optional(),
    OCR_MAX_PAGES_PER_DOCUMENT: z.coerce.number().int().positive().default(300),
    TECTONIC_BIN: z.string().min(1).default("tectonic"),
    /** Optional pinned Tectonic bundle URL/path. The default bundle is used otherwise. */
    TECTONIC_BUNDLE: z.string().min(1).optional(),
    /** Shared writable package cache, persisted by the reference deployment. */
    TECTONIC_CACHE_DIR: z.string().min(1).optional(),
    /** Air-gapped mode: compilation may only use packages already in the cache. */
    TECTONIC_ONLY_CACHED: bool,
    PDFTOPPM_BIN: z.string().min(1).default("pdftoppm"),
    PDFINFO_BIN: z.string().min(1).default("pdfinfo"),
    MAGICK_BIN: z.string().min(1).default("magick"),
    FFMPEG_BIN: z.string().min(1).default("ffmpeg"),

    // Escape hatches for local development, where no third party is reachable.
    DISABLE_EMAIL: bool,
    DISABLE_UPLOADS: bool,
    DISABLE_JOBS: bool,
    DISABLE_OCR: bool,
    DISABLE_TRANSCRIPTION: bool,
    DISABLE_TTS: bool,
  },
  runtimeEnv: process.env,
  emptyStringAsUndefined: true,
});

export const isProduction = env.NODE_ENV === "production";
