import { describe, expect, test } from "bun:test";
import {
  toGenerateTextRequest,
  validateChatCompletionsRequest,
} from "../src/openai";

describe("OpenAI compatibility helpers", () => {
  test("translates chat completions requests to provider requests", () => {
    const request = toGenerateTextRequest(
      validateChatCompletionsRequest({
        model: "gpt-test",
        messages: [
          { role: "system", content: "Be brief." },
          { role: "user", content: "Hello" },
        ],
        temperature: 0.2,
        max_tokens: 10,
      }),
    );

    expect(request).toEqual({
      model: "gpt-test",
      messages: [
        { role: "system", content: "Be brief." },
        { role: "user", content: "Hello" },
      ],
      temperature: 0.2,
      maxOutputTokens: 10,
    });
  });

  test("treats conduit-default as the provider default model", () => {
    const request = toGenerateTextRequest(
      validateChatCompletionsRequest({
        model: "conduit-default",
        messages: [{ role: "user", content: "Hello" }],
      }),
    );

    expect(request).toEqual({
      messages: [{ role: "user", content: "Hello" }],
    });
  });

  test("extracts text content parts", () => {
    const request = toGenerateTextRequest(
      validateChatCompletionsRequest({
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Hello " },
              { type: "text", text: "there" },
            ],
          },
        ],
      }),
    );

    expect(request.messages).toEqual([
      { role: "user", content: "Hello there" },
    ]);
  });

  test("rejects empty message arrays", () => {
    expect(() => validateChatCompletionsRequest({ messages: [] })).toThrow(
      "messages must be a non-empty array.",
    );
  });

  test("rejects unsupported tool requests", () => {
    expect(() =>
      validateChatCompletionsRequest({
        messages: [{ role: "user", content: "Hello" }],
        tools: [
          {
            type: "function",
            function: {
              name: "lookup",
              parameters: {},
            },
          },
        ],
      }),
    ).toThrow("tools are not supported");
  });

  test("rejects unsupported non-text content parts", () => {
    expect(() =>
      validateChatCompletionsRequest({
        messages: [
          {
            role: "user",
            content: [
              { type: "image_url", image_url: { url: "https://x/y.png" } },
            ],
          },
        ],
      }),
    ).toThrow('Unsupported message content part type "image_url"');
  });
});
