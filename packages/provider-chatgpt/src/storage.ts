import type { Stats } from "node:fs";
import {
  chmod,
  mkdir,
  open,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type TokenSet, enrichTokenSet } from "./tokens.js";

export interface TokenStorage {
  readonly name: string;
  get(): Promise<TokenSet | undefined>;
  set(tokens: TokenSet): Promise<void>;
  clear(): Promise<void>;
}

export interface StorageOptions {
  filePath?: string;
  forceFile?: boolean;
}

const SERVICE = "conduit";
const ACCOUNT = "chatgpt-oauth";

export async function createDefaultStorage(
  options: StorageOptions = {},
): Promise<TokenStorage> {
  if (options.forceFile) {
    return new FileTokenStorage(options.filePath);
  }

  const storage = process.env.CONDUIT_STORAGE?.trim();
  if (!storage || storage === "file") {
    return new FileTokenStorage(options.filePath);
  }
  if (storage === "keyring") {
    try {
      return await KeyringTokenStorage.create();
    } catch (error) {
      throw new Error(
        `CONDUIT_STORAGE=keyring requested keyring storage, but it is unavailable: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  throw new Error(
    `Invalid CONDUIT_STORAGE value "${storage}". Expected "file" or "keyring".`,
  );
}

export class FileTokenStorage implements TokenStorage {
  readonly name = "file";
  readonly path: string;

  constructor(path = join(homedir(), ".config", "conduit", "auth.json")) {
    this.path = path;
  }

  async get(): Promise<TokenSet | undefined> {
    let stats: Stats;
    try {
      stats = await stat(this.path);
    } catch {
      return undefined;
    }
    if ((stats.mode & 0o077) !== 0) {
      throw new Error(
        `Refusing to read token file with unsafe permissions: ${this.path}`,
      );
    }
    return enrichTokenSet(
      JSON.parse(await readFile(this.path, "utf8")) as TokenSet,
    );
  }

  async set(tokens: TokenSet): Promise<void> {
    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await chmod(dir, 0o700);
    await ensurePrivateFile(this.path);
    await writeFile(this.path, JSON.stringify(tokens, null, 2), {
      mode: 0o600,
    });
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}

async function ensurePrivateFile(path: string): Promise<void> {
  let stats: Stats | undefined;
  try {
    stats = await stat(path);
  } catch {
    const handle = await open(path, "wx", 0o600);
    await handle.close();
    return;
  }
  if ((stats.mode & 0o077) !== 0) {
    await rm(path, { force: true });
    const handle = await open(path, "wx", 0o600);
    await handle.close();
    return;
  }
  await chmod(path, 0o600);
}

export class KeyringTokenStorage implements TokenStorage {
  readonly name = "keyring";

  private constructor(
    private readonly entry: {
      getPassword(): string | null | Promise<string | null>;
      setPassword(value: string): void | Promise<void>;
      deletePassword(): void | Promise<void>;
    },
  ) {}

  static async create(): Promise<KeyringTokenStorage> {
    const keyring = (await import("@napi-rs/keyring")) as unknown as {
      Entry: new (
        service: string,
        account: string,
      ) => {
        getPassword(): string | null | Promise<string | null>;
        setPassword(value: string): void | Promise<void>;
        deletePassword(): void | Promise<void>;
      };
    };
    return new KeyringTokenStorage(new keyring.Entry(SERVICE, ACCOUNT));
  }

  async get(): Promise<TokenSet | undefined> {
    const value = await Promise.resolve(this.entry.getPassword());
    return value ? enrichTokenSet(JSON.parse(value) as TokenSet) : undefined;
  }

  async set(tokens: TokenSet): Promise<void> {
    await Promise.resolve(this.entry.setPassword(JSON.stringify(tokens)));
  }

  async clear(): Promise<void> {
    await Promise.resolve(this.entry.deletePassword());
  }
}
