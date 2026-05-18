export interface TokenSet {
  accessToken: string;
  refreshToken: string;
  idToken?: string | undefined;
  expiresAt: number;
  accountId?: string | undefined;
  email?: string | undefined;
  planTier?: string | undefined;
  chatgptUserId?: string | undefined;
}

export function decodeJwtPayload(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) {
    return {};
  }
  const padded = payload.padEnd(
    payload.length + ((4 - (payload.length % 4)) % 4),
    "=",
  );
  try {
    return JSON.parse(
      Buffer.from(
        padded.replace(/-/g, "+").replace(/_/g, "/"),
        "base64",
      ).toString("utf8"),
    ) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function enrichTokenSet(tokens: TokenSet): TokenSet {
  if (!tokens.idToken) {
    return tokens;
  }
  const payload = decodeJwtPayload(tokens.idToken);
  const enriched: TokenSet = {
    ...tokens,
  };
  const authClaims = objectValue(payload["https://api.openai.com/auth"]);
  const profileClaims = objectValue(payload["https://api.openai.com/profile"]);
  const accountId =
    stringValue(authClaims?.chatgpt_account_id) ??
    stringValue(payload.chatgpt_account_id) ??
    stringValue(payload["https://api.openai.com/auth/chatgpt_account_id"]) ??
    tokens.accountId;
  const email =
    stringValue(payload.email) ??
    stringValue(profileClaims?.email) ??
    tokens.email;
  const planTier =
    stringValue(authClaims?.chatgpt_plan_type) ??
    stringValue(payload["https://api.openai.com/auth/plan_type"]) ??
    stringValue(payload["https://api.openai.com/auth/chatgpt_plan_type"]) ??
    stringValue(payload.plan_type) ??
    tokens.planTier;
  const chatgptUserId =
    stringValue(authClaims?.chatgpt_user_id) ??
    stringValue(authClaims?.user_id) ??
    stringValue(payload.chatgpt_user_id) ??
    tokens.chatgptUserId;
  if (accountId) enriched.accountId = accountId;
  if (email) enriched.email = email;
  if (planTier) enriched.planTier = planTier;
  if (chatgptUserId) enriched.chatgptUserId = chatgptUserId;
  return enriched;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : undefined;
}
