import { describe, expect, test } from "bun:test";
import { ProviderUnavailableError } from "@conduit-llm/core";
import {
  type DeviceAuthSession,
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

  test("device auth requires a callback before requesting a user code", async () => {
    let fetchCalls = 0;
    const oauth = new OAuthClient({
      fetch: (async () => {
        fetchCalls += 1;
        return Response.json({});
      }) as unknown as typeof fetch,
    });

    await expect(oauth.loginDeviceAuth()).rejects.toThrow(
      "requires an onDeviceCode callback",
    );
    await expect(oauth.loginDeviceAuth()).rejects.toThrow(
      ProviderUnavailableError,
    );
    expect(fetchCalls).toBe(0);
  });

  test("loginDeviceCode applies the device callback guard", async () => {
    let fetchCalls = 0;
    const oauth = new OAuthClient({
      fetch: (async () => {
        fetchCalls += 1;
        return Response.json({});
      }) as unknown as typeof fetch,
    });

    await expect(oauth.loginDeviceCode()).rejects.toThrow(
      "requires an onDeviceCode callback",
    );
    expect(fetchCalls).toBe(0);
  });

  test("device auth accepts user_code and exchanges with the device callback URI", async () => {
    const calls: Array<{ url: string; init: Parameters<typeof fetch>[1] }> = [];
    let deviceSession: DeviceAuthSession | undefined;
    const oauth = new OAuthClient({
      onDeviceCode: (session) => {
        deviceSession = session;
      },
      fetch: (async (input, init) => {
        const url = String(input);
        calls.push({ url, init });
        if (url.endsWith("/api/accounts/deviceauth/usercode")) {
          return Response.json({
            device_auth_id: "device-auth-1",
            user_code: "ABCD-EFGH",
            interval: "0",
          });
        }
        if (url.endsWith("/api/accounts/deviceauth/token")) {
          return Response.json({
            authorization_code: "auth-code-1",
            code_verifier: "device-verifier-1",
            code_challenge: "device-challenge-1",
          });
        }
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        });
      }) as typeof fetch,
    });

    const tokens = await oauth.loginDeviceAuth();
    const tokenExchange = calls.at(-1);
    const exchangeBody = tokenExchange?.init?.body as URLSearchParams;

    expect(tokens.accessToken).toBe("access");
    expect(deviceSession).toEqual({
      verificationUrl: "https://auth.openai.com/codex/device",
      userCode: "ABCD-EFGH",
      intervalSeconds: 0,
      expiresInSeconds: 900,
    });
    expect(exchangeBody.get("code")).toBe("auth-code-1");
    expect(exchangeBody.get("code_verifier")).toBe("device-verifier-1");
    expect(exchangeBody.get("redirect_uri")).toBe(
      "https://auth.openai.com/deviceauth/callback",
    );
  });

  test("device auth accepts usercode response alias", async () => {
    const oauth = new OAuthClient({
      onDeviceCode: () => {},
      fetch: (async (input) => {
        const url = String(input);
        if (url.endsWith("/api/accounts/deviceauth/usercode")) {
          return Response.json({
            device_auth_id: "device-auth-1",
            usercode: "WXYZ-1234",
            interval: 0,
          });
        }
        if (url.endsWith("/api/accounts/deviceauth/token")) {
          return Response.json({
            authorization_code: "auth-code-1",
            code_verifier: "device-verifier-1",
          });
        }
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        });
      }) as typeof fetch,
    });

    const tokens = await oauth.loginDeviceAuth();

    expect(tokens.accessToken).toBe("access");
  });

  test("device auth polls pending statuses until authorization succeeds", async () => {
    const tokenPollStatuses = [403, 404];
    const calls: string[] = [];
    const oauth = new OAuthClient({
      onDeviceCode: () => {},
      fetch: (async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/api/accounts/deviceauth/usercode")) {
          return Response.json({
            device_auth_id: "device-auth-1",
            user_code: "ABCD-EFGH",
            interval: "0",
          });
        }
        if (url.endsWith("/api/accounts/deviceauth/token")) {
          const pending = tokenPollStatuses.shift();
          if (pending) {
            return new Response("pending", { status: pending });
          }
          return Response.json({
            authorization_code: "auth-code-1",
            code_verifier: "device-verifier-1",
          });
        }
        return Response.json({
          access_token: "access",
          refresh_token: "refresh",
          expires_in: 3600,
        });
      }) as typeof fetch,
    });

    const tokens = await oauth.loginDeviceAuth();

    expect(tokens.accessToken).toBe("access");
    expect(
      calls.filter((url) => url.endsWith("/api/accounts/deviceauth/token")),
    ).toHaveLength(3);
  });

  test("device auth reports a clear unavailable error when usercode is 404", async () => {
    const oauth = new OAuthClient({
      onDeviceCode: () => {},
      fetch: (async () =>
        new Response("missing", { status: 404 })) as unknown as typeof fetch,
    });

    await expect(oauth.loginDeviceAuth()).rejects.toThrow(
      ProviderUnavailableError,
    );
    await expect(oauth.loginDeviceAuth()).rejects.toThrow(
      "Device-code OAuth is not enabled for this Codex auth server.",
    );
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
