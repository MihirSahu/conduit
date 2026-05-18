import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import {
  CODEX_SYSTEM_PROMPT_URL,
  FALLBACK_CODEX_SYSTEM_PROMPT,
  PROMPT_CACHE_DIR,
  SYSTEM_PROMPT_CACHE_FILE,
  SYSTEM_PROMPT_CACHE_TTL_MS,
} from "./codex/constants.js";

export interface SystemPromptOptions {
  cachePath?: string;
  fetch?: typeof fetch;
  sourceUrl?: string;
}

export async function getSystemPrompt(
  options: SystemPromptOptions = {},
): Promise<string> {
  const cachePath =
    options.cachePath ??
    join(homedir(), ".cache", PROMPT_CACHE_DIR, SYSTEM_PROMPT_CACHE_FILE);
  const cached = await readFreshCache(cachePath);
  if (cached) {
    return cached;
  }
  const sourceUrl = options.sourceUrl ?? CODEX_SYSTEM_PROMPT_URL;
  if (sourceUrl) {
    try {
      const response = await (options.fetch ?? fetch)(sourceUrl);
      if (response.ok) {
        const prompt = await response.text();
        await mkdir(dirname(cachePath), { recursive: true });
        await writeFile(cachePath, prompt, { mode: 0o600 });
        return prompt;
      }
    } catch {
      // Fall through to bundled prompt.
    }
  }
  return FALLBACK_CODEX_SYSTEM_PROMPT;
}

async function readFreshCache(path: string): Promise<string | undefined> {
  try {
    const stats = await stat(path);
    if (Date.now() - stats.mtimeMs > SYSTEM_PROMPT_CACHE_TTL_MS) {
      return undefined;
    }
    return readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
