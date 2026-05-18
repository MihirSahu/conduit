import { describe, expect, test } from "bun:test";
import type { OAuthClient } from "../src/oauth";
import { ChatGPTSession } from "../src/session";
import type { TokenStorage } from "../src/storage";
import type { TokenSet } from "../src/tokens";

class MemoryStorage implements TokenStorage {
  readonly name = "memory";
  tokens: TokenSet | undefined;

  constructor(tokens: TokenSet) {
    this.tokens = tokens;
  }

  async get(): Promise<TokenSet | undefined> {
    return this.tokens;
  }

  async set(tokens: TokenSet): Promise<void> {
    this.tokens = tokens;
  }

  async clear(): Promise<void> {
    this.tokens = undefined;
  }
}

describe("ChatGPTSession", () => {
  test("loads token metadata from nested ChatGPT claims", async () => {
    const storage = new MemoryStorage({
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 10 * 60_000,
      idToken: fakeJwt({
        "https://api.openai.com/auth": {
          chatgpt_account_id: "account-123",
          chatgpt_plan_type: "plus",
        },
      }),
    });
    const session = new ChatGPTSession({ storage });

    const tokens = await session.getTokens();

    expect(tokens).toMatchObject({
      accountId: "account-123",
      planTier: "plus",
    });
  });

  test("refresh preserves account metadata when refresh response omits it", async () => {
    const storage = new MemoryStorage({
      accessToken: "old-access",
      refreshToken: "old-refresh",
      idToken: "old-id",
      expiresAt: Date.now() - 1,
      accountId: "account",
      email: "user@example.com",
      planTier: "plus",
    });
    const oauth = {
      async refresh(): Promise<TokenSet> {
        return {
          accessToken: "new-access",
          refreshToken: "old-refresh",
          expiresAt: Date.now() + 60_000,
        };
      },
    } as unknown as OAuthClient;
    const session = new ChatGPTSession({ storage, oauth });

    const tokens = await session.getTokens();

    expect(tokens).toMatchObject({
      accessToken: "new-access",
      refreshToken: "old-refresh",
      idToken: "old-id",
      accountId: "account",
      email: "user@example.com",
      planTier: "plus",
    });
    expect(storage.tokens?.accountId).toBe("account");
  });
});

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}
