import { describe, expect, test } from "bun:test";
import {
  OAuthClient,
  buildAuthorizeUrl,
  getBrowserOpenCommand,
  parseOAuthCallback,
} from "../src/oauth";
import type { TokenSet } from "../src/tokens";

class TestOAuthClient extends OAuthClient {
  calls = 0;

  override async loginDeviceAuth(): Promise<TokenSet> {
    this.calls += 1;
    return {
      accessToken: "access",
      refreshToken: "refresh",
      expiresAt: Date.now() + 60_000,
    };
  }
}

describe("OAuthClient", () => {
  test("authorize URL includes Codex ChatGPT account parameters", () => {
    const url = new URL(
      buildAuthorizeUrl({
        challenge: "challenge-1",
        state: "state-1",
        issuer: "https://auth.openai.com",
        clientId: "client-1",
        redirectUri: "http://localhost:1455/auth/callback",
        originator: "codex_cli_rs",
      }),
    );

    expect(url.toString()).toStartWith(
      "https://auth.openai.com/oauth/authorize?",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("client-1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:1455/auth/callback",
    );
    expect(url.searchParams.get("scope")).toBe(
      "openid profile email offline_access api.connectors.read api.connectors.invoke",
    );
    expect(url.searchParams.get("code_challenge")).toBe("challenge-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("id_token_add_organizations")).toBe("true");
    expect(url.searchParams.get("codex_cli_simplified_flow")).toBe("true");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("originator")).toBe("codex_cli_rs");
  });

  test("loginDeviceCode aliases loginDeviceAuth", async () => {
    const oauth = new TestOAuthClient();
    const tokens = await oauth.loginDeviceCode();

    expect(tokens.accessToken).toBe("access");
    expect(oauth.calls).toBe(1);
  });

  test("refresh reuses the existing refresh token when response does not rotate it", async () => {
    const oauth = new OAuthClient({
      fetch: (async () =>
        Response.json({
          access_token: "new-access",
          expires_in: 3600,
        })) as unknown as typeof fetch,
    });

    const tokens = await oauth.refresh("existing-refresh");

    expect(tokens.accessToken).toBe("new-access");
    expect(tokens.refreshToken).toBe("existing-refresh");
  });

  test("OAuth callback errors are parsed as immediate auth failures", () => {
    const result = parseOAuthCallback(
      "/auth/callback?state=state-1&error=access_denied&error_description=Denied",
      "state-1",
    );

    expect(result).toMatchObject({
      ok: false,
      status: 400,
      body: "OAuth failed: Denied",
    });
    expect(result.ok ? undefined : result.error).toBeInstanceOf(Error);
  });

  test("OAuth callback errors must match the expected state", () => {
    const result = parseOAuthCallback(
      "/auth/callback?error=access_denied&error_description=Denied",
      "state-1",
    );

    expect(result).toEqual({
      ok: false,
      status: 400,
      body: "Invalid OAuth callback.",
    });
  });

  test("Windows browser open command quotes OAuth URLs", () => {
    const url =
      "https://auth.openai.com/oauth/authorize?client_id=abc&state=state-1";
    const command = getBrowserOpenCommand(url, "win32");

    expect(command.command).toBe("cmd");
    expect(command.args).toEqual(["/d", "/s", "/c", `start "" "${url}"`]);
  });
});
