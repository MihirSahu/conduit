#!/usr/bin/env bun
import { ConsoleSink, EventBus } from "@conduit/core";
import {
  ChatGPTProvider,
  ChatGPTSession,
  FileTokenStorage,
  KeyringTokenStorage,
  OAuthClient,
  createDefaultStorage,
} from "@conduit/provider-chatgpt";

interface CliContext {
  args: string[];
}

async function main(ctx: CliContext): Promise<void> {
  const [command, ...rest] = ctx.args;
  switch (command) {
    case "login":
      await login(rest);
      return;
    case "logout":
      await logout();
      return;
    case "status":
      await status();
      return;
    case "ask":
      await ask(rest);
      return;
    case "doctor":
      await doctor();
      return;
    case undefined:
    case "help":
    case "--help":
    case "-h":
      printHelp();
      return;
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

async function login(args: string[]): Promise<void> {
  const storage = await createDefaultStorage();
  const oauth = new OAuthClient();
  const tokens = isDeviceAuthRequested(args)
    ? await oauth.loginDeviceAuth()
    : await oauth.loginInteractive();
  await storage.set(tokens);
  console.log(
    `Logged in${tokens.email ? ` as ${tokens.email}` : ""} using ${storage.name} storage.`,
  );
}

async function logout(): Promise<void> {
  const activeStorage = await createDefaultStorage();
  const keyringStorage =
    activeStorage.name === "keyring"
      ? activeStorage
      : await KeyringTokenStorage.create().catch(() => undefined);
  const fileStorage =
    activeStorage.name === "file" ? activeStorage : new FileTokenStorage();
  const tasks = [
    ...(keyringStorage
      ? [{ name: "keyring", clear: () => keyringStorage.clear() }]
      : []),
    { name: "file", clear: () => fileStorage.clear() },
  ];
  const results = await Promise.allSettled(tasks.map((task) => task.clear()));
  const failures = results
    .map((result, index) => ({ result, name: tasks[index]?.name }))
    .filter(
      (entry): entry is { result: PromiseRejectedResult; name: string } =>
        entry.result.status === "rejected" && Boolean(entry.name),
    );
  if (failures.length > 0) {
    throw new Error(
      `Failed to clear ${failures.map((failure) => failure.name).join(", ")} token storage.`,
    );
  }
  console.log("Logged out.");
}

async function status(): Promise<void> {
  const storage = await createDefaultStorage();
  const tokens = await storage.get();
  if (!tokens) {
    console.log(`Not logged in. Storage backend: ${storage.name}`);
    process.exitCode = 1;
    return;
  }
  const expiresAt = new Date(tokens.expiresAt).toISOString();
  console.log(`Storage: ${storage.name}`);
  console.log(`Account: ${tokens.email ?? tokens.accountId ?? "unknown"}`);
  console.log(`Plan: ${tokens.planTier ?? "unknown"}`);
  console.log(`Expires: ${expiresAt}`);
}

async function ask(args: string[]): Promise<void> {
  const stream = args.includes("--stream");
  const prompt = args
    .filter((arg) => arg !== "--stream")
    .join(" ")
    .trim();
  if (!prompt) {
    throw new Error("Usage: conduit ask [--stream] <prompt>");
  }
  const provider = await createChatGPTProvider();
  const request = { messages: [{ role: "user" as const, content: prompt }] };
  if (stream) {
    for await (const chunk of provider.streamText(request)) {
      if (chunk.type === "text-delta") {
        process.stdout.write(chunk.text);
      }
    }
    process.stdout.write("\n");
    return;
  }
  const result = await provider.generateText(request);
  console.log(result.text);
}

async function doctor(): Promise<void> {
  const storage = await createDefaultStorage();
  const tokens = await storage.get();
  const checks = [
    ["storage", storage.name],
    ["tokens", tokens ? "present" : "missing"],
    ["expiry", tokens ? new Date(tokens.expiresAt).toISOString() : "n/a"],
  ];
  for (const [name, value] of checks) {
    console.log(`${name}: ${value}`);
  }
  if (!tokens) {
    process.exitCode = 1;
    return;
  }
  const provider = await createChatGPTProvider();
  const status = await provider.getStatus();
  console.log(
    `provider: ${status.healthy ? "healthy" : `unhealthy (${status.reason ?? "unknown"})`}`,
  );
  if (!status.healthy) {
    process.exitCode = 1;
  }
}

async function createChatGPTProvider(): Promise<ChatGPTProvider> {
  const storage = await createDefaultStorage();
  const eventBus =
    process.env.CONDUIT_LOG_EVENTS === "1"
      ? new EventBus(new ConsoleSink())
      : new EventBus();
  return new ChatGPTProvider({
    session: new ChatGPTSession({ storage, eventBus }),
  });
}

function printHelp(): void {
  console.log(`conduit

Commands:
  conduit login [--device-auth]
  conduit logout
  conduit status
  conduit ask [--stream] <prompt>
  conduit doctor

Login options:
  --device-auth             Codex-compatible name for headless device auth
  --device-code             Alias for --device-auth

Environment:
  CONDUIT_STORAGE=file       Force file token storage
  CONDUIT_LOG_EVENTS=1       Emit redacted events to stdout
`);
}

function isDeviceAuthRequested(args: string[]): boolean {
  return args.includes("--device-auth") || args.includes("--device-code");
}

main({ args: process.argv.slice(2) }).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
