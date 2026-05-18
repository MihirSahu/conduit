import { describe, expect, test } from "bun:test";
import {
  ProviderUnavailableError,
  RateLimitError,
  type TextChunk,
} from "@conduit/core";
import { z } from "zod";
import { ChatGPTProvider } from "../src/provider";

class TestProvider extends ChatGPTProvider {
  constructor(private readonly chunks: TextChunk[]) {
    super({ session: undefined as never, systemPrompt: "test" });
  }

  override async *streamText(): AsyncIterable<TextChunk> {
    for (const chunk of this.chunks) {
      yield chunk;
    }
  }
}

describe("ChatGPTProvider", () => {
  test("generateText preserves the stream request ID", async () => {
    const provider = new TestProvider([
      {
        type: "text-delta",
        text: "hello",
        requestId: "request-1",
        provider: "chatgpt",
      },
      {
        type: "complete",
        text: "hello",
        requestId: "request-1",
        provider: "chatgpt",
      },
    ]);

    const result = await provider.generateText({
      messages: [{ role: "user", content: "hello" }],
    });

    expect(result.requestId).toBe("request-1");
    expect(result.text).toBe("hello");
  });

  test("generateStructured sends schema as Responses text.format", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async (_url: unknown, init: RequestInit | undefined) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return sseResponse([
          { type: "response.output_text.delta", delta: '{"title":"Ship"}' },
          "[DONE]",
        ]);
      }) as unknown as typeof fetch,
    });

    const result = await provider.generateStructured({
      schema: z.object({ title: z.string() }),
      schemaName: "Task",
      messages: [{ role: "user", content: "Extract a task" }],
      metadata: { userVisible: true },
    });

    expect(result).toEqual({ title: "Ship" });
    expect(body?.text).toEqual({
      format: {
        type: "json_schema",
        name: "Task",
        schema: expect.any(Object),
        strict: true,
      },
    });
    expect(body?.metadata).toEqual({ userVisible: true });
  });

  test("streamText does not treat function argument deltas as text", async () => {
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async () =>
        sseResponse([
          {
            type: "response.function_call_arguments.delta",
            item_id: "fc-item-1",
            call_id: "call-1",
            delta: '{"path":"README.md"}',
          },
          { type: "response.output_text.delta", delta: "done" },
          "[DONE]",
        ])) as unknown as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of provider.streamText({
      messages: [{ role: "user", content: "call a tool" }],
    })) {
      chunks.push(chunk);
    }

    expect(
      chunks
        .filter((chunk) => chunk.type === "text-delta")
        .map((chunk) => chunk.text)
        .join(""),
    ).toBe("done");
    expect(chunks).toContainEqual({
      type: "tool-call-delta",
      id: "call-1",
      argumentsDelta: '{"path":"README.md"}',
      requestId: expect.any(String),
      provider: "chatgpt",
    });
  });

  test("streamText ignores output item ids and final arguments as deltas", async () => {
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async () =>
        sseResponse([
          {
            type: "response.output_item.added",
            item: {
              type: "function_call",
              id: "fc-item-1",
              call_id: "call-1",
              name: "read_file",
            },
          },
          {
            type: "response.function_call_arguments.delta",
            item_id: "fc-item-1",
            call_id: "call-1",
            delta: '{"path":"README.md"}',
          },
          {
            type: "response.output_item.done",
            item: {
              type: "function_call",
              id: "fc-item-1",
              call_id: "call-1",
              name: "read_file",
              arguments: '{"path":"README.md"}',
            },
          },
          "[DONE]",
        ])) as unknown as typeof fetch,
    });

    const chunks = [];
    for await (const chunk of provider.streamText({
      messages: [{ role: "user", content: "call a tool" }],
    })) {
      chunks.push(chunk);
    }

    const toolChunks = chunks.filter(
      (chunk) => chunk.type === "tool-call-delta",
    );
    expect(toolChunks).toEqual([
      {
        type: "tool-call-delta",
        id: "call-1",
        name: "read_file",
        requestId: expect.any(String),
        provider: "chatgpt",
      },
      {
        type: "tool-call-delta",
        id: "call-1",
        argumentsDelta: '{"path":"README.md"}',
        requestId: expect.any(String),
        provider: "chatgpt",
      },
      {
        type: "tool-call-delta",
        id: "call-1",
        name: "read_file",
        requestId: expect.any(String),
        provider: "chatgpt",
      },
    ]);
  });

  test("streamText throws on failed stream events", async () => {
    const provider = new ChatGPTProvider({
      name: "named-chatgpt",
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async () =>
        sseResponse([
          { type: "response.output_text.delta", delta: "partial" },
          {
            type: "response.failed",
            error: { message: "backend failed" },
          },
        ])) as unknown as typeof fetch,
    });

    let thrown: unknown;
    try {
      await Array.fromAsync(
        provider.streamText({
          messages: [{ role: "user", content: "hello" }],
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ProviderUnavailableError);
    expect((thrown as ProviderUnavailableError).message).toBe("backend failed");
    expect((thrown as ProviderUnavailableError).provider).toBe("named-chatgpt");
  });

  test("tool result messages preserve their tool call ID", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async (_url: unknown, init: RequestInit | undefined) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return sseResponse(["[DONE]"]);
      }) as unknown as typeof fetch,
    });

    await provider.generateText({
      messages: [
        { role: "user", content: "Read the file" },
        {
          role: "tool",
          toolCallId: "call-123",
          content: '{"contents":"hello"}',
        },
      ],
    });

    expect(body?.input).toContainEqual({
      type: "function_call_output",
      call_id: "call-123",
      output: '{"contents":"hello"}',
    });
  });

  test("assistant history uses output_text content", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async (_url: unknown, init: RequestInit | undefined) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return sseResponse(["[DONE]"]);
      }) as unknown as typeof fetch,
    });

    await provider.generateText({
      messages: [
        { role: "user", content: "Hello" },
        { role: "assistant", content: "Hi there" },
      ],
    });

    expect(body?.input).toContainEqual({
      role: "assistant",
      content: [{ type: "output_text", text: "Hi there" }],
    });
  });

  test("assistant tool calls are replayed before tool outputs", async () => {
    let body: Record<string, unknown> | undefined;
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async (_url: unknown, init: RequestInit | undefined) => {
        body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return sseResponse(["[DONE]"]);
      }) as unknown as typeof fetch,
    });

    await provider.generateText({
      messages: [
        {
          role: "assistant",
          content: "",
          toolCalls: [
            {
              id: "call-123",
              name: "read_file",
              arguments: '{"path":"README.md"}',
            },
          ],
        },
        {
          role: "tool",
          toolCallId: "call-123",
          content: '{"contents":"hello"}',
        },
      ],
    });

    expect(body?.input).toEqual([
      {
        role: "assistant",
        content: [{ type: "output_text", text: "" }],
      },
      {
        type: "function_call",
        call_id: "call-123",
        name: "read_file",
        arguments: '{"path":"README.md"}',
      },
      {
        type: "function_call_output",
        call_id: "call-123",
        output: '{"contents":"hello"}',
      },
    ]);
  });

  test("getStatus checks backend reachability", async () => {
    let calls = 0;
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async (_url: unknown, init: RequestInit | undefined) => {
        calls += 1;
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(body.max_output_tokens).toBe(1);
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });

    const status = await provider.getStatus();

    expect(status.healthy).toBe(true);
    expect(calls).toBe(1);
  });

  test("getStatus reports backend failures", async () => {
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async () =>
        new Response("nope", { status: 503 })) as unknown as typeof fetch,
    });

    const status = await provider.getStatus();

    expect(status.healthy).toBe(false);
    expect(status.reason).toContain("HTTP 503");
  });

  test("429 responses populate rate limit windows from headers", async () => {
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async () =>
        new Response("limited", {
          status: 429,
          headers: {
            "retry-after": "2",
            "x-ratelimit-remaining-5h": "0",
            "x-ratelimit-reset-5h": "2000000000",
            "x-ratelimit-remaining-weekly": "12",
            "x-ratelimit-reset-weekly": "2000003600",
          },
        })) as unknown as typeof fetch,
    });

    let thrown: unknown;
    try {
      await Array.fromAsync(
        provider.streamText({
          messages: [{ role: "user", content: "hello" }],
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RateLimitError);
    expect((thrown as RateLimitError).retryAfterMs).toBe(2000);
    expect((thrown as RateLimitError).fiveHour?.remaining).toBe(0);
    expect((thrown as RateLimitError).fiveHour?.resetAt?.toISOString()).toBe(
      "2033-05-18T03:33:20.000Z",
    );
    expect((thrown as RateLimitError).weekly?.remaining).toBe(12);
  });

  test("429 responses parse HTTP-date Retry-After headers", async () => {
    const retryAt = new Date(Date.now() + 60_000).toUTCString();
    const provider = new ChatGPTProvider({
      session: fakeSession(),
      systemPrompt: "test",
      fetch: (async () =>
        new Response("limited", {
          status: 429,
          headers: { "retry-after": retryAt },
        })) as unknown as typeof fetch,
    });

    let thrown: unknown;
    try {
      await Array.fromAsync(
        provider.streamText({
          messages: [{ role: "user", content: "hello" }],
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(RateLimitError);
    expect((thrown as RateLimitError).retryAfterMs).toBeGreaterThan(0);
    expect((thrown as RateLimitError).retryAfterMs).toBeLessThanOrEqual(60_000);
  });
});

function fakeSession() {
  const tokens = {
    accessToken: "access",
    refreshToken: "refresh",
    expiresAt: Date.now() + 60_000,
    accountId: "account",
  };
  return {
    async getTokens() {
      return tokens;
    },
    async forceRefresh() {
      return tokens;
    },
  } as never;
}

function sseResponse(
  events: Array<Record<string, unknown> | string>,
): Response {
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          const data =
            typeof event === "string" ? event : JSON.stringify(event);
          controller.enqueue(new TextEncoder().encode(`data: ${data}\n\n`));
        }
        controller.close();
      },
    }),
    {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    },
  );
}
