#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_CODEX_MODEL,
  FileTokenStorage,
  OAuthClient,
} from "@conduit-llm/provider-chatgpt";
import { readServerConfig } from "./config.js";
import { createServerProvider } from "./provider.js";
import { createConduitServer } from "./server.js";

interface CliContext {
  args: string[];
  env?: Record<string, string | undefined> | undefined;
}

export async function main(ctx: CliContext): Promise<void> {
  const [command = "serve", ...rest] = ctx.args;
  switch (command) {
    case "serve":
      await serve(ctx.env);
      return;
    case "login":
      await login(rest, ctx.env);
      return;
    case "logout":
      await logout(ctx.env);
      return;
    case "status":
      await status(ctx.env);
      return;
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function serve(env: Record<string, string | undefined> = process.env) {
  const config = readServerConfig(env);
  const provider = await createServerProvider({
    authPath: config.authPath,
    model: config.model,
  });
  const server = createConduitServer({
    provider,
    apiKey: config.apiKey,
    allowedOrigins: config.allowedOrigins,
    defaultModel: config.model ?? DEFAULT_CODEX_MODEL,
    logger: true,
  });
  await server.listen({ host: config.host, port: config.port });
}

async function login(
  args: string[],
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const storage = createServerStorage(env);
  const oauth = new OAuthClient({
    onDeviceCode: (session) => {
      console.log("Open this link and sign in:");
      console.log(session.verificationUrl);
      console.log("");
      console.log("Enter this one-time code:");
      console.log(session.userCode);
      console.log("");
      console.log("This code expires in about 15 minutes.");
      console.log("Waiting for authentication...");
    },
  });
  const tokens = isDeviceAuthRequested(args)
    ? await oauth.loginDeviceAuth()
    : await oauth.loginInteractive();
  await storage.set(tokens);
  console.log(
    `Logged in${tokens.email ? ` as ${tokens.email}` : ""} using ${storage.path}.`,
  );
}

async function logout(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  await createServerStorage(env).clear();
  console.log("Logged out.");
}

async function status(
  env: Record<string, string | undefined> = process.env,
): Promise<void> {
  const storage = createServerStorage(env);
  const tokens = await storage.get();
  if (!tokens) {
    console.log(`Not logged in. Token path: ${storage.path}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Token path: ${storage.path}`);
  console.log(`Account: ${tokens.email ?? tokens.accountId ?? "unknown"}`);
  console.log(`Plan: ${tokens.planTier ?? "unknown"}`);
  console.log(`Expires: ${new Date(tokens.expiresAt).toISOString()}`);
}

function createServerStorage(
  env: Record<string, string | undefined>,
): FileTokenStorage {
  const config = readServerConfig(env);
  return config.authPath
    ? new FileTokenStorage(config.authPath)
    : new FileTokenStorage();
}

function isDeviceAuthRequested(args: string[]): boolean {
  return args.includes("--device-auth") || args.includes("--device-code");
}

function printHelp(): void {
  console.log(`conduit-server

Commands:
  conduit-server serve
  conduit-server login [--device-auth]
  conduit-server logout
  conduit-server status

Environment:
  CONDUIT_SERVER_API_KEY      Bearer token required for /v1/* routes
  CONDUIT_AUTH_PATH           Token file path (Docker default: /data/auth.json)
  CONDUIT_DOCKER=1            Use /data/auth.json when CONDUIT_AUTH_PATH is unset
  CONDUIT_HOST                Listen host (default: 0.0.0.0)
  CONDUIT_PORT                Listen port (default: 3000)
  CONDUIT_MODEL               Default provider model
  CONDUIT_ALLOWED_ORIGINS     Comma-separated CORS origins
`);
}

export { createConduitServer, createServerProvider, readServerConfig };

if (isCliEntrypoint(process.argv[1])) {
  main({ args: process.argv.slice(2) }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

function isCliEntrypoint(argvPath: string | undefined): boolean {
  if (!argvPath) {
    return false;
  }
  try {
    return (
      realpathSync(fileURLToPath(import.meta.url)) === realpathSync(argvPath)
    );
  } catch {
    return false;
  }
}
