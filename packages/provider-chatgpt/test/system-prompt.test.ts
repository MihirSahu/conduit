import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CODEX_SYSTEM_PROMPT_URL } from "../src/codex/constants";
import { getSystemPrompt } from "../src/system-prompt";

describe("getSystemPrompt", () => {
  test("fetches from the default pinned Codex prompt URL", async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), "conduit-prompt-"));
    let requestedUrl = "";

    const prompt = await getSystemPrompt({
      cachePath: join(cacheDir, "prompt.txt"),
      fetch: (async (url: string) => {
        requestedUrl = url;
        return new Response("fetched prompt", { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(prompt).toBe("fetched prompt");
    expect(requestedUrl).toBe(CODEX_SYSTEM_PROMPT_URL);
  });
});
