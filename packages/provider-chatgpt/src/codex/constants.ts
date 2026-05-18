export const CODEX_CLI_VERSION = "0.1.2505172129";
export const OAUTH_ISSUER = "https://auth.openai.com";
export const OAUTH_CLIENT_ID = "app_EMoamEEZ73f0CkXaXp7hrann";
export const REDIRECT_URI = "http://localhost:1455/auth/callback";
export const CALLBACK_HOST = "localhost";
export const CALLBACK_PORT = 1455;
export const CODEX_RESPONSES_URL =
  "https://chatgpt.com/backend-api/codex/responses";
export const OPENAI_BETA_HEADER = "responses=v1";
export const ORIGINATOR = "codex_cli_rs";
export const USER_AGENT = `conduit/${CODEX_CLI_VERSION}`;
export const PROMPT_CACHE_DIR = "conduit";
export const SYSTEM_PROMPT_CACHE_FILE = "codex-system-prompt.txt";
export const SYSTEM_PROMPT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CODEX_SYSTEM_PROMPT_URL =
  "https://raw.githubusercontent.com/openai/codex/d90a3488704c6a2d0a3f50c3a17c9e1a52a7ddd9/codex-rs/protocol/src/prompts/base_instructions/default.md";
export const FALLBACK_CODEX_SYSTEM_PROMPT =
  "You are Codex, a coding agent running in a local developer environment. Follow the user's instructions precisely, preserve security boundaries, and avoid exposing secrets.";

export const DEFAULT_CODEX_MODEL = "gpt-5.1-codex";
