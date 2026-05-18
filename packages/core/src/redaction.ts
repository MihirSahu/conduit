const SENSITIVE_KEY_PATTERN =
  /(authorization|access[_-]?token|refresh[_-]?token|id[_-]?token|bearer|secret|password)/i;
const BEARER_PATTERN = /bearer\s+[a-z0-9._~+/=-]+/gi;
const JWT_PATTERN = /\beyJ[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+\b/g;

export function redact(value: unknown): unknown {
  if (typeof value === "string") {
    return value
      .replace(BEARER_PATTERN, "Bearer [REDACTED]")
      .replace(JWT_PATTERN, "[REDACTED_TOKEN]");
  }

  if (Array.isArray(value)) {
    return value.map((item) => redact(item));
  }

  if (value && typeof value === "object") {
    const input = value as Record<string, unknown>;
    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(input)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? "[REDACTED]"
        : redact(nested);
    }
    return output;
  }

  return value;
}
