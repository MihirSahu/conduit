import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  generateStructuredWithRepair,
  parseStructuredText,
  zodToStrictJsonSchema,
} from "../src/structured";
import type {
  GenerateTextRequest,
  GenerateTextResult,
  LLMProvider,
  StructuredRequest,
  TextChunk,
} from "../src/types";

describe("structured output", () => {
  test("validates parsed JSON with Zod", () => {
    const schema = z.object({ title: z.string() });
    expect(parseStructuredText('{"title":"Ship"}', schema)).toEqual({
      title: "Ship",
    });
  });

  test("adds additionalProperties false to objects", () => {
    const schema = z.object({ title: z.string() });
    const strict = zodToStrictJsonSchema(schema);
    expect(JSON.stringify(strict.schema)).toContain(
      '"additionalProperties":false',
    );
  });

  test("rejects optional object properties in strict schemas", () => {
    const schema = z.object({
      title: z.string().optional(),
      count: z.number(),
    });

    expect(() => zodToStrictJsonSchema(schema)).toThrow(
      "Optional object properties are not supported",
    );
  });

  test("rejects record schemas instead of changing them to empty objects", () => {
    expect(() => zodToStrictJsonSchema(z.record(z.string()))).toThrow(
      "Record schemas are not supported",
    );
  });

  test("rejects recursive lazy schemas before JSON Schema conversion", () => {
    type Tree = { name: string; children: Tree[] };
    const tree: z.ZodType<Tree> = z.lazy(() =>
      z.object({
        name: z.string(),
        children: z.array(tree),
      }),
    );

    expect(() => zodToStrictJsonSchema(tree)).toThrow(
      "Recursive Zod schemas are not supported",
    );
  });

  test("rejects nested recursive lazy schemas inside object shapes", () => {
    type Tree = { children: Tree[] };
    const tree: z.ZodType<Tree> = z.object({
      children: z.array(z.lazy(() => tree)),
    });

    expect(() => zodToStrictJsonSchema(tree)).toThrow(
      "Recursive Zod schemas are not supported",
    );
  });

  test("repair prompt includes Zod validation issue details", async () => {
    const provider = new RepairPromptProvider();

    await expect(
      generateStructuredWithRepair(provider, {
        schema: z.object({ title: z.string() }),
        messages: [{ role: "user", content: "Return a task" }],
        repair: false,
      }),
    ).rejects.toThrow("Structured output did not match");

    const repairedProvider = new RepairPromptProvider();
    await repairedProvider.generateStructured({
      schema: z.object({ title: z.string() }),
      messages: [{ role: "user", content: "Return a task" }],
    });

    expect(repairedProvider.repairPrompt).toContain("validationError");
    expect(repairedProvider.repairPrompt).toContain("title");
  });
});

class RepairPromptProvider implements LLMProvider {
  readonly name = "repair-test";
  readonly capabilities = { streaming: false, tools: false, structured: true };
  calls = 0;
  repairPrompt = "";

  async generateText(req: GenerateTextRequest): Promise<GenerateTextResult> {
    this.calls += 1;
    if (this.calls === 1) {
      return {
        text: '{"name":"wrong"}',
        requestId: "first",
        provider: this.name,
      };
    }
    this.repairPrompt = req.messages.at(-1)?.content ?? "";
    return {
      text: '{"title":"fixed"}',
      requestId: "repair",
      provider: this.name,
    };
  }

  async *streamText(): AsyncIterable<TextChunk> {}

  async generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
    return generateStructuredWithRepair(this, req);
  }

  async getStatus() {
    return { healthy: true };
  }
}
