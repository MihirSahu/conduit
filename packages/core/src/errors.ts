export interface ConduitErrorOptions {
  cause?: unknown;
  requestId?: string | undefined;
  provider?: string | undefined;
  retryable?: boolean | undefined;
}

export class ConduitError extends Error {
  readonly requestId: string | undefined;
  readonly provider: string | undefined;
  readonly retryable: boolean;

  constructor(message: string, options: ConduitErrorOptions = {}) {
    super(message);
    this.name = new.target.name;
    this.cause = options.cause;
    this.requestId = options.requestId;
    this.provider = options.provider;
    this.retryable = options.retryable ?? false;
  }
}

export class AuthExpiredError extends ConduitError {
  constructor(
    message = "Authentication expired. Run conduit login again.",
    options: ConduitErrorOptions = {},
  ) {
    super(message, { ...options, retryable: false });
  }
}

export interface RateLimitWindow {
  remaining?: number | undefined;
  resetAt?: Date | undefined;
}

export class RateLimitError extends ConduitError {
  readonly retryAfterMs: number | undefined;
  readonly fiveHour: RateLimitWindow | undefined;
  readonly weekly: RateLimitWindow | undefined;

  constructor(
    message = "Provider rate limit exceeded.",
    options: ConduitErrorOptions & {
      retryAfterMs?: number | undefined;
      fiveHour?: RateLimitWindow | undefined;
      weekly?: RateLimitWindow | undefined;
    } = {},
  ) {
    super(message, {
      ...options,
      retryable: options.retryable ?? Boolean(options.retryAfterMs),
    });
    this.retryAfterMs = options.retryAfterMs;
    this.fiveHour = options.fiveHour;
    this.weekly = options.weekly;
  }
}

export class SchemaValidationError extends ConduitError {
  readonly rawText: string;
  readonly validationError: unknown;

  constructor(
    message: string,
    options: ConduitErrorOptions & {
      rawText: string;
      validationError: unknown;
    },
  ) {
    super(message, { ...options, retryable: false });
    this.rawText = options.rawText;
    this.validationError = options.validationError;
  }
}

export class ProviderUnavailableError extends ConduitError {
  constructor(message: string, options: ConduitErrorOptions = {}) {
    super(message, { ...options, retryable: options.retryable ?? true });
  }
}

export class TimeoutError extends ConduitError {
  readonly timeoutMs: number;

  constructor(timeoutMs: number, options: ConduitErrorOptions = {}) {
    super(`Provider request timed out after ${timeoutMs}ms.`, {
      ...options,
      retryable: true,
    });
    this.timeoutMs = timeoutMs;
  }
}

export function isRetryableError(error: unknown): boolean {
  if (error instanceof ConduitError) {
    return error.retryable;
  }
  if (error instanceof DOMException && error.name === "AbortError") {
    return true;
  }
  return false;
}
