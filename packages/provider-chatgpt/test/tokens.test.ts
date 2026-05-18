import { describe, expect, test } from "bun:test";
import { enrichTokenSet } from "../src/tokens";

describe("Token metadata", () => {
  test("enriches tokens from nested ChatGPT auth and profile claims", () => {
    const tokens = enrichTokenSet({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
      idToken: fakeJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "account-123",
          chatgpt_plan_type: "plus",
          chatgpt_user_id: "user-123",
        },
        "https://api.openai.com/profile": {
          email: "nested@example.com",
        },
      }),
    });

    expect(tokens).toMatchObject({
      accountId: "account-123",
      planTier: "plus",
      chatgptUserId: "user-123",
      email: "nested@example.com",
    });
  });

  test("keeps compatibility with flat claim shapes", () => {
    const tokens = enrichTokenSet({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
      idToken: fakeJwt({
        chatgpt_account_id: "flat-account",
        "https://api.openai.com/auth/chatgpt_plan_type": "pro",
        email: "flat@example.com",
      }),
    });

    expect(tokens).toMatchObject({
      accountId: "flat-account",
      planTier: "pro",
      email: "flat@example.com",
    });
  });
});

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}
