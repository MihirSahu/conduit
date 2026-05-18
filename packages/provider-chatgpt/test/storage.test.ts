import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileTokenStorage } from "../src/storage";

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
});
