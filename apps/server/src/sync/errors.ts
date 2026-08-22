/** A synchronization failure that another job attempt may recover from. */
export class RetryableSyncError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RetryableSyncError";
  }
}

/** A file/provider failure that will not change if the job is replayed. */
export class NonRetryableSyncError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "NonRetryableSyncError";
  }
}

/** The remote service proved that the stored login can no longer authenticate. */
export class CredentialsRevokedSyncError extends NonRetryableSyncError {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "CredentialsRevokedSyncError";
  }
}
