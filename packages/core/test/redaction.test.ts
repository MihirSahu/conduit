import { describe, expect, test } from "bun:test";
import { redact } from "../src/redaction";

describe("redact", () => {
  test("removes token-like values recursively", () => {
    const output = redact({
      authorization: "Bearer abc.def.ghi",
      nested: {
        accessToken: "secret",
        message: "use Bearer token-value here",
      },
    });

    expect(output).toEqual({
      authorization: "[REDACTED]",
      nested: {
        accessToken: "[REDACTED]",
        message: "use Bearer [REDACTED] here",
      },
    });
  });
});
