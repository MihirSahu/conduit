import { join } from "node:path";

export interface ServerConfig {
  apiKey: string | undefined;
  authPath: string | undefined;
  host: string;
  port: number;
  model: string | undefined;
  allowedOrigins: string[];
}

export function readServerConfig(
  env: Record<string, string | undefined> = process.env,
): ServerConfig {
  return {
    apiKey: clean(env.CONDUIT_SERVER_API_KEY),
    authPath: clean(env.CONDUIT_AUTH_PATH) ?? defaultDockerAuthPath(env),
    host: clean(env.CONDUIT_HOST) ?? "0.0.0.0",
    port: parsePort(env.CONDUIT_PORT),
    model: clean(env.CONDUIT_MODEL),
    allowedOrigins: parseAllowedOrigins(env.CONDUIT_ALLOWED_ORIGINS),
  };
}

function clean(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function parsePort(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? "", 10);
  if (Number.isInteger(parsed) && parsed > 0 && parsed <= 65535) {
    return parsed;
  }
  return 3000;
}

function parseAllowedOrigins(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function defaultDockerAuthPath(
  env: Record<string, string | undefined>,
): string | undefined {
  return env.CONDUIT_DOCKER === "1" ? join("/data", "auth.json") : undefined;
}
