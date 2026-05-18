import { createServer } from "node:http";
import { URL } from "node:url";
import { AuthExpiredError, ProviderUnavailableError } from "@conduit/core";
import {
  CALLBACK_HOST,
  CALLBACK_PORT,
  OAUTH_CLIENT_ID,
  OAUTH_ISSUER,
  ORIGINATOR,
  REDIRECT_URI,
} from "./codex/constants.js";
import { createPkcePair, createState } from "./pkce.js";
import { type TokenSet, enrichTokenSet } from "./tokens.js";

export interface OAuthClientOptions {
  fetch?: typeof fetch;
  openBrowser?: (url: string) => Promise<void> | void;
}

export class OAuthClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: OAuthClientOptions = {}) {
    this.fetchImpl = options.fetch ?? fetch;
  }

  async loginInteractive(): Promise<TokenSet> {
    const pkce = createPkcePair();
    const state = createState();
    const callbackPromise = waitForCallback(state);
    const authUrl = buildAuthorizeUrl({
      challenge: pkce.challenge,
      state,
    });

    await this.openBrowser(authUrl);
    const code = await callbackPromise;
    return this.exchangeCode(code, pkce.verifier);
  }

  async loginDeviceAuth(): Promise<TokenSet> {
    throw new ProviderUnavailableError(
      "Device-code OAuth is not enabled until the public Codex auth flow is confirmed.",
    );
  }

  async loginDeviceCode(): Promise<TokenSet> {
    return this.loginDeviceAuth();
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const response = await this.fetchImpl(`${OAUTH_ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });
    if (!response.ok) {
      throw new AuthExpiredError(
        "Refresh token was rejected. Run conduit login again.",
      );
    }
    return parseTokenResponse(await response.json(), {
      refreshTokenFallback: refreshToken,
    });
  }

  private async exchangeCode(
    code: string,
    verifier: string,
  ): Promise<TokenSet> {
    const response = await this.fetchImpl(`${OAUTH_ISSUER}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: OAUTH_CLIENT_ID,
        code,
        code_verifier: verifier,
        grant_type: "authorization_code",
        redirect_uri: REDIRECT_URI,
      }),
    });
    if (!response.ok) {
      throw new AuthExpiredError(
        `OAuth token exchange failed with HTTP ${response.status}.`,
      );
    }
    return parseTokenResponse(await response.json());
  }

  private async openBrowser(url: string): Promise<void> {
    if (this.options.openBrowser) {
      await this.options.openBrowser(url);
      return;
    }
    const { spawn } = await import("node:child_process");
    const { command, args } = getBrowserOpenCommand(url);
    spawn(command, args, { detached: true, stdio: "ignore" }).unref();
  }
}

export interface AuthorizeUrlOptions {
  challenge: string;
  state: string;
  issuer?: string | undefined;
  clientId?: string | undefined;
  redirectUri?: string | undefined;
  originator?: string | undefined;
}

export function buildAuthorizeUrl(options: AuthorizeUrlOptions): string {
  const authUrl = new URL(`${options.issuer ?? OAUTH_ISSUER}/oauth/authorize`);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("client_id", options.clientId ?? OAUTH_CLIENT_ID);
  authUrl.searchParams.set("redirect_uri", options.redirectUri ?? REDIRECT_URI);
  authUrl.searchParams.set(
    "scope",
    "openid profile email offline_access api.connectors.read api.connectors.invoke",
  );
  authUrl.searchParams.set("code_challenge", options.challenge);
  authUrl.searchParams.set("code_challenge_method", "S256");
  authUrl.searchParams.set("id_token_add_organizations", "true");
  authUrl.searchParams.set("codex_cli_simplified_flow", "true");
  authUrl.searchParams.set("state", options.state);
  authUrl.searchParams.set("originator", options.originator ?? ORIGINATOR);
  return authUrl.toString();
}

export function getBrowserOpenCommand(
  url: string,
  platform: string = process.platform,
): { command: string; args: string[] } {
  if (platform === "darwin") {
    return { command: "open", args: [url] };
  }
  if (platform === "win32") {
    return {
      command: "cmd",
      args: ["/d", "/s", "/c", `start "" "${escapeCmdDoubleQuotes(url)}"`],
    };
  }
  return { command: "xdg-open", args: [url] };
}

export function waitForCallback(expectedState: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const settleReject = (error: unknown) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      closeServer(server);
      reject(error);
    };
    const settleResolve = (code: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      closeServer(server);
      resolve(code);
    };
    const timeout = setTimeout(
      () => {
        settleReject(
          new AuthExpiredError("OAuth callback timed out after 5 minutes."),
        );
      },
      5 * 60 * 1000,
    );

    const server = createServer((req, res) => {
      try {
        const callback = parseOAuthCallback(req.url ?? "/", expectedState);
        if (!callback.ok) {
          res.writeHead(callback.status, { "content-type": "text/plain" });
          res.end(callback.body);
          if (callback.error) {
            settleReject(callback.error);
          }
          return;
        }
        res.writeHead(200, { "content-type": "text/plain" });
        res.end("Conduit login complete. You can close this tab.");
        settleResolve(callback.code);
      } catch (error) {
        settleReject(error);
      }
    });

    server.once("error", (error) => {
      settleReject(error);
    });
    server.listen(CALLBACK_PORT, CALLBACK_HOST);
  });
}

export type OAuthCallbackParseResult =
  | { ok: true; code: string }
  | { ok: false; status: number; body: string; error?: AuthExpiredError };

export function parseOAuthCallback(
  requestUrl: string,
  expectedState: string,
): OAuthCallbackParseResult {
  const url = new URL(requestUrl, REDIRECT_URI);
  const state = url.searchParams.get("state");
  if (url.pathname !== "/auth/callback" || state !== expectedState) {
    return { ok: false, status: 400, body: "Invalid OAuth callback." };
  }

  const oauthError = url.searchParams.get("error");
  if (oauthError) {
    const description = url.searchParams.get("error_description") ?? oauthError;
    return {
      ok: false,
      status: 400,
      body: `OAuth failed: ${description}`,
      error: new AuthExpiredError(`OAuth failed: ${description}`),
    };
  }
  const code = url.searchParams.get("code");
  if (!code) {
    return { ok: false, status: 400, body: "Invalid OAuth callback." };
  }
  return { ok: true, code };
}

function escapeCmdDoubleQuotes(value: string): string {
  return value.replaceAll('"', '""');
}

function closeServer(server: ReturnType<typeof createServer>): void {
  if (server.listening) {
    server.close();
  }
}

function parseTokenResponse(
  input: unknown,
  options: { refreshTokenFallback?: string | undefined } = {},
): TokenSet {
  const body = input as Record<string, unknown>;
  const accessToken = stringField(body, "access_token");
  const refreshToken =
    stringField(body, "refresh_token") ?? options.refreshTokenFallback;
  if (!accessToken || !refreshToken) {
    throw new AuthExpiredError(
      "OAuth response did not include access and refresh tokens.",
    );
  }
  const expiresIn =
    typeof body.expires_in === "number" ? body.expires_in : 3600;
  const tokenSet: TokenSet = {
    accessToken,
    refreshToken,
    expiresAt: Date.now() + expiresIn * 1000,
  };
  const idToken = stringField(body, "id_token");
  if (idToken) {
    tokenSet.idToken = idToken;
  }
  return enrichTokenSet(tokenSet);
}

function stringField(
  input: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = input[key];
  return typeof value === "string" ? value : undefined;
}
