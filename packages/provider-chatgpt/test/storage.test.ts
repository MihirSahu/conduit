import { afterEach, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  FileTokenStorage,
  KeyringTokenStorage,
  createDefaultStorage,
  type TokenStorage,
} from "../src/storage";

const originalStorageEnv = process.env.CONDUIT_STORAGE;
const originalCreateKeyringStorage = KeyringTokenStorage.create;

afterEach(() => {
  if (originalStorageEnv === undefined) {
    delete process.env.CONDUIT_STORAGE;
  } else {
    process.env.CONDUIT_STORAGE = originalStorageEnv;
  }
  KeyringTokenStorage.create = originalCreateKeyringStorage;
});

describe("createDefaultStorage", () => {
  test("uses file storage by default", async () => {
    delete process.env.CONDUIT_STORAGE;

    const storage = await createDefaultStorage();

    expect(storage.name).toBe("file");
    expect(storage).toBeInstanceOf(FileTokenStorage);
  });

  test("uses file storage when CONDUIT_STORAGE=file", async () => {
    process.env.CONDUIT_STORAGE = "file";

    const storage = await createDefaultStorage();

    expect(storage.name).toBe("file");
    expect(storage).toBeInstanceOf(FileTokenStorage);
  });

  test("uses keyring storage when CONDUIT_STORAGE=keyring", async () => {
    process.env.CONDUIT_STORAGE = "keyring";
    let calls = 0;
    const keyringStorage: TokenStorage = {
      name: "keyring",
      get: async () => undefined,
      set: async () => undefined,
      clear: async () => undefined,
    };
    KeyringTokenStorage.create = async () => {
      calls += 1;
      return keyringStorage as unknown as KeyringTokenStorage;
    };

    const storage = await createDefaultStorage();

    expect(calls).toBe(1);
    expect(storage.name).toBe("keyring");
  });

  test("fails clearly when explicit keyring storage is unavailable", async () => {
    process.env.CONDUIT_STORAGE = "keyring";
    KeyringTokenStorage.create = async () => {
      throw new Error("native keyring module missing");
    };

    await expect(createDefaultStorage()).rejects.toThrow(
      "CONDUIT_STORAGE=keyring requested keyring storage, but it is unavailable: native keyring module missing",
    );
  });

  test("rejects invalid CONDUIT_STORAGE values", async () => {
    process.env.CONDUIT_STORAGE = "vault";

    await expect(createDefaultStorage()).rejects.toThrow(
      'Invalid CONDUIT_STORAGE value "vault". Expected "file" or "keyring".',
    );
  });

  test("forceFile keeps using file storage when CONDUIT_STORAGE=keyring", async () => {
    process.env.CONDUIT_STORAGE = "keyring";

    const storage = await createDefaultStorage({ forceFile: true });

    expect(storage.name).toBe("file");
    expect(storage).toBeInstanceOf(FileTokenStorage);
  });
});

describe("FileTokenStorage", () => {
  test("writes token files with 0600 permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "conduit-"));
    const storage = new FileTokenStorage(join(dir, "auth.json"));
    await storage.set({
      accessToken: "a",
      refreshToken: "r",
      expiresAt: Date.now() + 1000,
    });
    const mode = (await stat(storage.path)).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  test("rejects unsafe permissions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "conduit-"));
    const path = join(dir, "auth.json");
    await writeFile(
      path,
      JSON.stringify({
        accessToken: "a",
        refreshToken: "r",
        expiresAt: Date.now() + 1000,
      }),
    );
    await chmod(path, 0o644);
    const storage = new FileTokenStorage(path);
    await expect(storage.get()).rejects.toThrow("unsafe permissions");
  });

  test("replaces unsafe existing files before writing new token contents", async () => {
    const dir = await mkdtemp(join(tmpdir(), "conduit-"));
    const path = join(dir, "auth.json");
    await writeFile(path, "old unsafe contents", { mode: 0o644 });
    await chmod(path, 0o644);
    const storage = new FileTokenStorage(path);

    await storage.set({
      accessToken: "new-access",
      refreshToken: "new-refresh",
      expiresAt: Date.now() + 1000,
    });

    const mode = (await stat(path)).mode & 0o777;
    expect(mode).toBe(0o600);
    await expect(storage.get()).resolves.toMatchObject({
      accessToken: "new-access",
    });
  });

  test("enriches persisted token metadata on read", async () => {
    const dir = await mkdtemp(join(tmpdir(), "conduit-"));
    const path = join(dir, "auth.json");
    await writeFile(
      path,
      JSON.stringify({
        accessToken: "access",
        refreshToken: "refresh",
        expiresAt: Date.now() + 1000,
        idToken: fakeJwt({
          "https://api.openai.com/auth": {
            chatgpt_account_id: "account-123",
            chatgpt_plan_type: "plus",
          },
        }),
      }),
      { mode: 0o600 },
    );
    const storage = new FileTokenStorage(path);

    await expect(storage.get()).resolves.toMatchObject({
      accountId: "account-123",
      planTier: "plus",
    });
  });
});

function fakeJwt(payload: Record<string, unknown>): string {
  const encode = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}
