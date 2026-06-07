import { describe, expect, test } from "bun:test";
import type {
  GenerateTextRequest,
  GenerateTextResult,
  LLMProvider,
  ProviderCapabilities,
  ProviderStatus,
  StructuredRequest,
  TextChunk,
} from "@conduit-llm/core";
import { createConduitServer } from "../src/server";

class MockProvider implements LLMProvider {
  readonly name = "mock";
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    structured: false,
    tools: true,
  };

  lastRequest: GenerateTextRequest | undefined;

  async generateText(req: GenerateTextRequest): Promise<GenerateTextResult> {
    this.lastRequest = req;
    return {
      text: "Hello from Conduit",
      requestId: "req_mock",
      provider: this.name,
      model: req.model ?? "mock-model",
    };
  }

  async *streamText(req: GenerateTextRequest): AsyncIterable<TextChunk> {
    this.lastRequest = req;
    yield {
      type: "text-delta",
      text: "Hel",
      requestId: "req_stream",
      provider: this.name,
    };
    yield {
      type: "text-delta",
      text: "lo",
      requestId: "req_stream",
      provider: this.name,
    };
    yield {
      type: "complete",
      text: "Hello",
      requestId: "req_stream",
      provider: this.name,
    };
  }

  async generateStructured<T>(_req: StructuredRequest<T>): Promise<T> {
    throw new Error("Not implemented.");
  }

  async getStatus(): Promise<ProviderStatus> {
    return { healthy: true };
  }
}

class PreStreamErrorProvider extends MockProvider {
  override streamText(_req: GenerateTextRequest): AsyncIterable<TextChunk> {
    return {
      [Symbol.asyncIterator]() {
        return {
          async next(): Promise<IteratorResult<TextChunk>> {
            throw new Error("stream failed before first chunk");
          },
        };
      },
    };
  }
}

class MidStreamErrorProvider extends MockProvider {
  override async *streamText(
    req: GenerateTextRequest,
  ): AsyncIterable<TextChunk> {
    this.lastRequest = req;
    yield {
      type: "text-delta",
      text: "Hel",
      requestId: "req_stream",
      provider: this.name,
    };
    throw new Error("stream failed after first chunk");
  }
}

describe("Conduit server", () => {
  test("allows health checks without auth", async () => {
    const server = createConduitServer({
      provider: new MockProvider(),
      apiKey: "secret",
    });

    const response = await server.inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toEqual({ ok: true });
  });

  test("requires bearer auth for OpenAI-compatible routes", async () => {
    const server = createConduitServer({
      provider: new MockProvider(),
      apiKey: "secret",
    });

    const response = await server.inject({ method: "GET", url: "/v1/models" });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.payload).error.type).toBe(
      "authentication_error",
    );
  });

  test("returns chat completion responses", async () => {
    const provider = new MockProvider();
    const server = createConduitServer({ provider, apiKey: "secret" });

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret" },
      payload: {
        model: "mock-model",
        messages: [{ role: "user", content: "Say hello" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.payload)).toMatchObject({
      id: "req_mock",
      object: "chat.completion",
      model: "mock-model",
      choices: [
        {
          message: {
            role: "assistant",
            content: "Hello from Conduit",
          },
        },
      ],
    });
    expect(provider.lastRequest?.messages).toEqual([
      { role: "user", content: "Say hello" },
    ]);
  });

  test("streams chat completion chunks as SSE", async () => {
    const server = createConduitServer({
      provider: new MockProvider(),
      apiKey: "secret",
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret" },
      payload: {
        stream: true,
        model: "mock-model",
        messages: [{ role: "user", content: "Say hello" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.payload).toContain('"object":"chat.completion.chunk"');
    expect(response.payload).toContain('"content":"Hel"');
    expect(response.payload).toContain("data: [DONE]");
  });

  test("returns JSON errors when streams fail before headers are sent", async () => {
    const server = createConduitServer({
      provider: new PreStreamErrorProvider(),
      apiKey: "secret",
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret" },
      payload: {
        stream: true,
        messages: [{ role: "user", content: "Say hello" }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.headers["content-type"]).toContain("application/json");
    expect(JSON.parse(response.payload).error.message).toBe(
      "stream failed before first chunk",
    );
  });

  test("returns SSE errors when streams fail after headers are sent", async () => {
    const server = createConduitServer({
      provider: new MidStreamErrorProvider(),
      apiKey: "secret",
    });

    const response = await server.inject({
      method: "POST",
      url: "/v1/chat/completions",
      headers: { authorization: "Bearer secret" },
      payload: {
        stream: true,
        messages: [{ role: "user", content: "Say hello" }],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.payload).toContain('"content":"Hel"');
    expect(response.payload).toContain(
      '"message":"stream failed after first chunk"',
    );
    expect(response.payload).toContain("data: [DONE]");
  });
});
