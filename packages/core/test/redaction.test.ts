import { describe, expect, test } from "bun:test";
import { redact } from "../src/redaction";

describe("redact", () => {
  test("removes token-like values recursively", () => {
    const output = redact({
      authorization: "Bearer abc.def.ghi",
      nested: {
        accessToken: "secret",
        api_key: "api-secret",
        message: "use Bearer token-value here",
      },
    });

    expect(output).toEqual({
      authorization: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        api_key: "[REDACTED]",
        message: "use Bearer [REDACTED] here",
      },
    });
  });

  test("redacts token-like key value text in strings", () => {
    const output = redact(
      "failed access_token=secret-token refresh-token: refresh-secret api_key: key-secret secret=password-value password='quoted-secret' authorization: Bearer auth-secret",
    );

    expect(output).toBe(
      "failed access_token=[REDACTED] refresh-token: [REDACTED] api_key: [REDACTED] secret=[REDACTED] password=[REDACTED] authorization: [REDACTED]",
    );
  });
});
