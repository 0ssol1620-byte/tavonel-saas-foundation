export class PermanentReject extends Error {
  readonly retryable = false as const;

  constructor(message: string) {
    super(message);
    this.name = "PermanentReject";
  }
}

export class RetryableError extends Error {
  readonly retryable = true as const;

  constructor(message: string) {
    super(message);
    this.name = "RetryableError";
  }
}

export function isRetryable(error: unknown): boolean {
  if (error instanceof PermanentReject) {
    return false;
  }
  if (error instanceof RetryableError) {
    return true;
  }
  return true;
}