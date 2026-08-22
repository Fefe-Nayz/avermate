import {
  assistantSkillDescriptorSchema,
  modelCapabilitySchema,
  type AssistantSkillDescriptor,
  type ModelCapability,
} from "@avermate/agent-contracts";

export const REVIEWED_ASSISTANT_SKILLS: readonly AssistantSkillDescriptor[] = [
  {
    id: "explain-lesson",
    version: 1,
    label: "Expliquer un cours",
    description:
      "Explique progressivement une notion à partir des sources explicitement sélectionnées.",
    compatibleToolIds: ["materials.documents.get", "subjects.list"],
    contextPolicy: "project-and-explicit",
  },
  {
    id: "grade-trend",
    version: 1,
    label: "Analyser les notes",
    description:
      "Analyse une tendance de notes sans modifier les notes, matières ou coefficients.",
    compatibleToolIds: ["years.get", "grades.recent", "subjects.list"],
    contextPolicy: "explicit-only",
  },
  {
    id: "revision-questions",
    version: 1,
    label: "Questions de révision",
    description:
      "Prépare des questions de révision traçables vers les sources du projet.",
    compatibleToolIds: ["materials.documents.get"],
    contextPolicy: "project-and-explicit",
  },
  {
    id: "summarize-sources",
    version: 1,
    label: "Résumer les sources",
    description:
      "Résume les documents explicitement joints et signale les éléments insuffisants.",
    compatibleToolIds: ["materials.documents.get", "recordings.list"],
    contextPolicy: "explicit-only",
  },
].map((skill) => assistantSkillDescriptorSchema.parse(skill));

export const MOCK_ASSISTANT_MODEL: ModelCapability =
  modelCapabilitySchema.parse({
    modelKey: "mock-readonly",
    providerKey: "mock",
    label: "Assistant de démonstration (lecture seule)",
    placement: "core",
    modalities: ["text"],
    supportsTools: true,
    supportsReasoningSummary: false,
    contextTokens: 16_384,
    maxOutputTokens: 2_048,
    estimatedInputPrice: "0",
    estimatedOutputPrice: "0",
    currency: "EUR",
    contentLeavesPlacement: false,
    privacyUrl: null,
  });

export const MISTRAL_ASSISTANT_MODEL: ModelCapability =
  modelCapabilitySchema.parse({
    modelKey: "mistral-small-latest",
    providerKey: "mistral-byok",
    label: "Mistral Small (clé personnelle)",
    placement: "direct-byok",
    modalities: ["text", "image"],
    supportsTools: true,
    supportsReasoningSummary: false,
    contextTokens: 128_000,
    maxOutputTokens: 16_384,
    estimatedInputPrice: null,
    estimatedOutputPrice: null,
    currency: null,
    contentLeavesPlacement: true,
    privacyUrl: "https://mistral.ai/terms/",
  });

export const MISTRAL_MANAGED_ASSISTANT_MODEL: ModelCapability =
  modelCapabilitySchema.parse({
    modelKey: "mistral-small-latest-managed",
    providerKey: "mistral-managed",
    label: "Mistral Small (allocation gérée — aperçu)",
    placement: "managed",
    modalities: ["text", "image"],
    supportsTools: true,
    supportsReasoningSummary: false,
    contextTokens: 128_000,
    maxOutputTokens: 16_384,
    estimatedInputPrice: null,
    estimatedOutputPrice: null,
    currency: null,
    contentLeavesPlacement: true,
    privacyUrl: "https://mistral.ai/terms/",
  });

/** Instance-owned key for local development/full self-host, never a paid claim. */
export const MISTRAL_INSTANCE_ASSISTANT_MODEL: ModelCapability =
  modelCapabilitySchema.parse({
    ...MISTRAL_ASSISTANT_MODEL,
    providerKey: "mistral-instance",
    label: "Mistral Small (clé de cette instance)",
    placement: "core",
  });

export const OPENAI_ASSISTANT_MODEL: ModelCapability =
  modelCapabilitySchema.parse({
    modelKey: "openai-gpt-4.1-mini",
    providerKey: "openai-byok",
    label: "OpenAI GPT-4.1 mini (clé personnelle)",
    placement: "direct-byok",
    modalities: ["text", "image"],
    supportsTools: true,
    supportsReasoningSummary: false,
    contextTokens: 1_000_000,
    maxOutputTokens: 32_768,
    estimatedInputPrice: null,
    estimatedOutputPrice: null,
    currency: null,
    contentLeavesPlacement: true,
    privacyUrl: "https://openai.com/policies/privacy-policy/",
  });

export const OPENAI_INSTANCE_ASSISTANT_MODEL: ModelCapability =
  modelCapabilitySchema.parse({
    ...OPENAI_ASSISTANT_MODEL,
    providerKey: "openai-instance",
    label: "OpenAI GPT-4.1 mini (clé de cette instance)",
    placement: "core",
  });

export const OPENROUTER_ASSISTANT_MODEL: ModelCapability =
  modelCapabilitySchema.parse({
    modelKey: "openrouter-openai-gpt-4.1-mini",
    providerKey: "openrouter-byok",
    label: "GPT-4.1 mini via OpenRouter (clé personnelle)",
    placement: "direct-byok",
    modalities: ["text", "image"],
    supportsTools: true,
    supportsReasoningSummary: false,
    contextTokens: 1_000_000,
    maxOutputTokens: 32_768,
    estimatedInputPrice: null,
    estimatedOutputPrice: null,
    currency: null,
    contentLeavesPlacement: true,
    privacyUrl: "https://openrouter.ai/privacy",
  });

export const OPENROUTER_INSTANCE_ASSISTANT_MODEL: ModelCapability =
  modelCapabilitySchema.parse({
    ...OPENROUTER_ASSISTANT_MODEL,
    providerKey: "openrouter-instance",
    label: "GPT-4.1 mini via OpenRouter (clé de cette instance)",
    placement: "core",
  });
