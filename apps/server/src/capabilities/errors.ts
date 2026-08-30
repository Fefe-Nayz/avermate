import {
  capabilityErrorSchema,
  type CapabilityError,
  type CapabilityErrorCode,
} from "@avermate/agent-contracts";

export class CapabilityExecutionError extends Error {
  constructor(readonly capabilityError: CapabilityError) {
    super(capabilityError.message);
    this.name = "CapabilityExecutionError";
  }
}

function statusOf(error: unknown): number | null {
  if (!error || typeof error !== "object") return null;
  for (const key of ["status", "statusCode"]) {
    const value = (error as Record<string, unknown>)[key];
    if (typeof value === "number" && Number.isSafeInteger(value)) return value;
  }
  return null;
}

export function capabilityFailure(
  code: CapabilityErrorCode,
  message: string,
  options: {
    retryable?: boolean;
    ambiguous?: boolean;
    providerRequestId?: string | null;
    status?: number | null;
  } = {},
): CapabilityError {
  return capabilityErrorSchema.parse({
    version: 1,
    code,
    message,
    retryable: options.retryable ?? false,
    ambiguous: options.ambiguous ?? false,
    providerRequestId: options.providerRequestId ?? null,
    safeDiagnostic:
      options.status === null || options.status === undefined
        ? null
        : { httpStatus: options.status },
  });
}

/** Closed, secret-free error taxonomy for attempts, telemetry and UI. */
export function normalizeCapabilityError(
  error: unknown,
  options: { signal?: AbortSignal } = {},
): CapabilityError {
  if (error instanceof CapabilityExecutionError) return error.capabilityError;
  if (
    options.signal?.aborted ||
    (error instanceof DOMException && error.name === "AbortError")
  ) {
    return capabilityFailure("CANCELLED", "Capability execution was cancelled");
  }
  const status = statusOf(error);
  const raw = error instanceof Error ? error.message : "";
  const message = raw.toUpperCase();
  if (message.includes("CREDENTIAL_UNAVAILABLE")) {
    return capabilityFailure(
      "AUTHENTICATION_REQUIRED",
      "A required capability credential is unavailable",
    );
  }
  if (message.includes("CREDENTIAL") || status === 401 || status === 403) {
    return capabilityFailure("CREDENTIAL_INVALID", "Capability credential was rejected", {
      status,
    });
  }
  if (message.includes("CONSENT")) {
    return capabilityFailure("CONSENT_REQUIRED", "Capability consent is missing or stale");
  }
  if (message.includes("INPUT") && message.includes("LIMIT")) {
    return capabilityFailure("INPUT_TOO_LARGE", "Capability input exceeds its frozen limit");
  }
  if (message.includes("OUTPUT") && message.includes("LIMIT")) {
    return capabilityFailure("OUTPUT_TOO_LARGE", "Capability output exceeds its frozen limit");
  }
  if (message.includes("UNSUPPORTED") || status === 400 || status === 422) {
    return capabilityFailure("UNSUPPORTED_INPUT", "Provider does not support this input", {
      status,
    });
  }
  if (status === 429) {
    return capabilityFailure("RATE_LIMITED", "Provider rate limit was reached", {
      retryable: true,
      status,
    });
  }
  if (status !== null && status >= 500) {
    return capabilityFailure("PROVIDER_UNAVAILABLE", "Provider is temporarily unavailable", {
      retryable: true,
      status,
    });
  }
  if (/TIMEOUT|TIMED OUT|DEADLINE/u.test(message)) {
    return capabilityFailure("PROVIDER_TIMEOUT", "Provider request timed out", {
      retryable: true,
      ambiguous: true,
    });
  }
  if (error instanceof TypeError) {
    return capabilityFailure("PROVIDER_UNAVAILABLE", "Provider transport failed", {
      retryable: true,
      ambiguous: true,
    });
  }
  if (/MALFORMED|INVALID_JSON|MIME_MISMATCH|UNEXPECTED_MIME/u.test(message)) {
    return capabilityFailure(
      "PROVIDER_MALFORMED_RESPONSE",
      "Provider returned a malformed response",
    );
  }
  return capabilityFailure("INTERNAL_ERROR", "Capability execution failed");
}
