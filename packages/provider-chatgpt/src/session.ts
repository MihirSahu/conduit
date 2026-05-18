import { AuthExpiredError, EventBus } from "@conduit-llm/core";
import { OAuthClient } from "./oauth.js";
import type { TokenStorage } from "./storage.js";
import { type TokenSet, enrichTokenSet } from "./tokens.js";

export interface SessionOptions {
  storage: TokenStorage;
  oauth?: OAuthClient;
  eventBus?: EventBus;
}

export class ChatGPTSession {
  private readonly oauth: OAuthClient;
  private readonly eventBus: EventBus;
  private tokens: TokenSet | undefined;
  private refreshPromise: Promise<TokenSet> | undefined;

  constructor(private readonly options: SessionOptions) {
    this.oauth = options.oauth ?? new OAuthClient();
    this.eventBus = options.eventBus ?? new EventBus();
  }

  async getTokens(): Promise<TokenSet> {
    const tokens = await this.loadTokens();
    if (tokens.expiresAt - Date.now() < 5 * 60 * 1000) {
      return this.refresh();
    }
    return tokens;
  }

  async forceRefresh(): Promise<TokenSet> {
    return this.refresh();
  }

  async save(tokens: TokenSet): Promise<void> {
    this.tokens = tokens;
    await this.options.storage.set(tokens);
  }

  async clear(): Promise<void> {
    this.tokens = undefined;
    await this.options.storage.clear();
  }

  private async loadTokens(): Promise<TokenSet> {
    if (this.tokens) {
      return this.tokens;
    }
    const tokens = await this.options.storage.get();
    if (!tokens) {
      throw new AuthExpiredError("No ChatGPT tokens found. Run conduit login.");
    }
    this.tokens = enrichTokenSet(tokens);
    return this.tokens;
  }

  private async refresh(): Promise<TokenSet> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }
    this.refreshPromise = this.loadTokens()
      .then((tokens) => {
        this.eventBus.emit({ type: "auth.refresh", provider: "chatgpt" });
        return this.oauth
          .refresh(tokens.refreshToken)
          .then((refreshed) => mergeRefreshedTokens(tokens, refreshed));
      })
      .then(async (tokens) => {
        this.tokens = tokens;
        await this.options.storage.set(tokens);
        return tokens;
      })
      .catch((error) => {
        this.eventBus.emit({
          type: "auth.expired",
          provider: "chatgpt",
          reason: String(error),
        });
        throw error;
      })
      .finally(() => {
        this.refreshPromise = undefined;
      });
    return this.refreshPromise;
  }
}

function mergeRefreshedTokens(
  previous: TokenSet,
  refreshed: TokenSet,
): TokenSet {
  return {
    ...refreshed,
    idToken: refreshed.idToken ?? previous.idToken,
    accountId: refreshed.accountId ?? previous.accountId,
    email: refreshed.email ?? previous.email,
    planTier: refreshed.planTier ?? previous.planTier,
  };
}
