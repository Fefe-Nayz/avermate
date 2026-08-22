import type { IngestionReasonCode } from "@avermate/agent-contracts";
import { IngestError } from "../lib/ingest";

export class AdvancedIngestionError extends Error {
  readonly name = "AdvancedIngestionError";

  constructor(
    readonly reasonCode: IngestionReasonCode,
    message: string,
    readonly retryable: boolean,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function asAdvancedIngestionError(
  error: unknown,
  fallback: {
    reasonCode?: IngestionReasonCode;
    message?: string;
    retryable?: boolean;
  } = {},
): AdvancedIngestionError {
  if (error instanceof AdvancedIngestionError) return error;
  if (error instanceof IngestError) {
    return new AdvancedIngestionError(
      error.reasonCode,
      error.message,
      error.retryable,
      { cause: error },
    );
  }
  return new AdvancedIngestionError(
    fallback.reasonCode ?? "internal_failure",
    fallback.message ?? "The ingestion operation failed",
    fallback.retryable ?? true,
    { cause: error },
  );
}

export function safeIngestionFailure(error: unknown) {
  const normalized = asAdvancedIngestionError(error);
  return Object.freeze({
    reasonCode: normalized.reasonCode,
    retryable: normalized.retryable,
    message: normalized.message.slice(0, 1_000),
  });
}
