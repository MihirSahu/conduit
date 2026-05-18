import {
  AuthExpiredError,
  ProviderUnavailableError,
  RateLimitError,
  generateStructuredWithRepair,
  zodToStrictJsonSchema,
} from "@conduit/core";
import type {
  GenerateTextRequest,
  GenerateTextResult,
  LLMProvider,
  ProviderCapabilities,
  ProviderStatus,
  StructuredRequest,
  TextChunk,
} from "@conduit/core";
import {
  CODEX_RESPONSES_URL,
  DEFAULT_CODEX_MODEL,
  OPENAI_BETA_HEADER,
  ORIGINATOR,
  USER_AGENT,
} from "./codex/constants.js";
import type { ChatGPTSession } from "./session.js";
import { parseSse } from "./sse.js";
import { getSystemPrompt } from "./system-prompt.js";

const RESPONSE_FORMAT_METADATA_KEY = "__conduitResponseFormat";

export interface ChatGPTProviderOptions {
  session: ChatGPTSession;
  fetch?: typeof fetch;
  model?: string;
  systemPrompt?: string;
  endpoint?: string;
  name?: string;
}

export class ChatGPTProvider implements LLMProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    tools: true,
    structured: true,
  };

  private readonly fetchImpl: typeof fetch;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(private readonly options: ChatGPTProviderOptions) {
    this.name = options.name ?? "chatgpt";
    this.fetchImpl = options.fetch ?? fetch;
    this.model = options.model ?? DEFAULT_CODEX_MODEL;
    this.endpoint = options.endpoint ?? CODEX_RESPONSES_URL;
  }

  async generateText(req: GenerateTextRequest): Promise<GenerateTextResult> {
    let text = "";
    let raw: unknown;
    let requestId: string = crypto.randomUUID();
    for await (const chunk of this.streamText(req)) {
      requestId = chunk.requestId;
      if (chunk.type === "text-delta") {
        text += chunk.text;
      } else if (chunk.type === "complete") {
        raw = chunk.raw;
        text = chunk.text || text;
      }
    }
    return {
      text,
      requestId,
      provider: this.name,
      model: req.model ?? this.model,
      raw,
    };
  }

  async *streamText(req: GenerateTextRequest): AsyncIterable<TextChunk> {
    const requestId = crypto.randomUUID();
    const response = await this.sendWithAuthRetry(req, true);
    if (!response.body) {
      throw new ProviderUnavailableError(
        "Codex response did not include a stream body.",
        { provider: this.name },
      );
    }
    let text = "";
    let lastRaw: unknown;
    for await (const event of parseSse(response.body)) {
      if (event.data === "[DONE]") {
        break;
      }
      const raw = safeJson(event.data);
      lastRaw = raw;
      const streamError = extractStreamError(raw, this.name);
      if (streamError) {
        throw streamError;
      }
      const delta = extractTextDelta(raw);
      if (delta) {
        text += delta;
        yield {
          type: "text-delta",
          text: delta,
          requestId,
          provider: this.name,
        };
      }
      const reasoning = extractReasoningDelta(raw);
      if (reasoning) {
        yield {
          type: "reasoning-delta",
          text: reasoning,
          requestId,
          provider: this.name,
        };
      }
      const tool = extractToolDelta(raw);
      if (tool) {
        yield { ...tool, requestId, provider: this.name };
      }
    }
    yield {
      type: "complete",
      text,
      requestId,
      provider: this.name,
      raw: lastRaw,
    };
  }

  async generateStructured<T>(req: StructuredRequest<T>): Promise<T> {
    const strict = zodToStrictJsonSchema(req.schema, req.schemaName);
    return generateStructuredWithRepair(this, {
      ...req,
      metadata: {
        ...req.metadata,
        [RESPONSE_FORMAT_METADATA_KEY]: strict,
      },
    });
  }

  async getStatus(): Promise<ProviderStatus> {
    const start = Date.now();
    try {
      const response = await this.sendWithAuthRetry(
        {
          messages: [{ role: "user", content: "ping" }],
          maxOutputTokens: 1,
        },
        false,
      );
      await response.body?.cancel();
      return { healthy: true, latencyMs: Date.now() - start };
    } catch (error) {
      return {
        healthy: false,
        latencyMs: Date.now() - start,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private async sendWithAuthRetry(
    req: GenerateTextRequest,
    stream: boolean,
  ): Promise<Response> {
    const first = await this.send(req, stream);
    if (first.status !== 401) {
      return handleResponse(first, this.name);
    }
    await this.options.session.forceRefresh();
    const second = await this.send(req, stream);
    if (second.status === 401) {
      throw new AuthExpiredError(
        "Codex backend rejected refreshed credentials.",
        { provider: this.name },
      );
    }
    return handleResponse(second, this.name);
  }

  private async send(
    req: GenerateTextRequest,
    stream: boolean,
  ): Promise<Response> {
    const tokens = await this.options.session.getTokens();
    const systemPrompt = this.options.systemPrompt ?? (await getSystemPrompt());
    const instructions = req.systemAppendix
      ? `${systemPrompt}\n\n${req.systemAppendix}`
      : systemPrompt;
    const { responseFormat, metadata } = splitConduitMetadata(req.metadata);
    const init: RequestInit = {
      method: "POST",
      headers: {
        authorization: `Bearer ${tokens.accessToken}`,
        "chatgpt-account-id": tokens.accountId ?? "",
        "content-type": "application/json",
        accept: stream ? "text/event-stream" : "application/json",
        "openai-beta": OPENAI_BETA_HEADER,
        originator: ORIGINATOR,
        "user-agent": USER_AGENT,
        session_id: crypto.randomUUID(),
      },
      body: JSON.stringify({
        model: req.model ?? this.model,
        instructions,
        input: toResponsesInput(req),
        include: ["reasoning.encrypted_content"],
        store: false,
        stream,
        ...(responseFormat
          ? { text: { format: toResponsesTextFormat(responseFormat) } }
          : {}),
        tools: req.tools,
        tool_choice: req.toolChoice,
        temperature: req.temperature,
        max_output_tokens: req.maxOutputTokens,
        metadata,
        prompt_cache_key: "conduit-session",
      }),
      ...(req.signal ? { signal: req.signal } : {}),
    };
    return this.fetchImpl(this.endpoint, init);
  }
}

interface StrictResponseFormat {
  name: string;
  schema: Record<string, unknown>;
  strict: true;
}

function splitConduitMetadata(metadata: Record<string, unknown> | undefined): {
  metadata: Record<string, unknown> | undefined;
  responseFormat: StrictResponseFormat | undefined;
} {
  if (!metadata) {
    return { metadata: undefined, responseFormat: undefined };
  }
  const { [RESPONSE_FORMAT_METADATA_KEY]: responseFormat, ...rest } = metadata;
  return {
    metadata: Object.keys(rest).length > 0 ? rest : undefined,
    responseFormat: isStrictResponseFormat(responseFormat)
      ? responseFormat
      : undefined,
  };
}

function isStrictResponseFormat(value: unknown): value is StrictResponseFormat {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    typeof (value as StrictResponseFormat).name === "string" &&
    typeof (value as StrictResponseFormat).schema === "object"
  );
}

function toResponsesTextFormat(
  format: StrictResponseFormat,
): Record<string, unknown> {
  return {
    type: "json_schema",
    name: format.name,
    schema: format.schema,
    strict: format.strict,
  };
}

function toResponsesInput(
  req: GenerateTextRequest,
): Array<Record<string, unknown>> {
  return req.messages.flatMap<Record<string, unknown>>((message) => {
    if (message.role === "tool") {
      if (!message.toolCallId) {
        throw new ProviderUnavailableError(
          "Tool result messages require toolCallId so the backend can correlate function output.",
          { retryable: false },
        );
      }
      return {
        type: "function_call_output",
        call_id: message.toolCallId,
        output: message.content,
      };
    }

    const contentType =
      message.role === "assistant" ? "output_text" : "input_text";
    const messageItem = {
      role: message.role,
      content: [{ type: contentType, text: message.content }],
    };
    if (message.role === "assistant" && message.toolCalls?.length) {
      return [
        messageItem,
        ...message.toolCalls.map((toolCall) => ({
          type: "function_call",
          call_id: toolCall.id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        })),
      ];
    }
    return {
      role: message.role,
      content: [{ type: contentType, text: message.content }],
    };
  });
}

function handleResponse(response: Response, provider: string): Response {
  if (response.ok) {
    return response;
  }
  if (response.status === 429) {
    const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
    throw new RateLimitError("Codex backend rate limit exceeded.", {
      provider,
      ...(retryAfterMs ? { retryAfterMs } : {}),
      ...parseRateLimitWindows(response.headers),
    });
  }
  if (response.status === 401) {
    throw new AuthExpiredError("Codex backend rejected credentials.", {
      provider,
    });
  }
  throw new ProviderUnavailableError(
    `Codex backend failed with HTTP ${response.status}.`,
    {
      provider,
      retryable: response.status >= 500,
    },
  );
}

function parseRateLimitWindows(
  headers: Headers,
): Pick<RateLimitError, "fiveHour" | "weekly"> {
  return {
    fiveHour: parseRateLimitWindow(
      headers,
      [
        "x-ratelimit-remaining-5h",
        "x-ratelimit-remaining-5-hour",
        "x-ratelimit-remaining-five-hour",
      ],
      [
        "x-ratelimit-reset-5h",
        "x-ratelimit-reset-5-hour",
        "x-ratelimit-reset-five-hour",
      ],
    ),
    weekly: parseRateLimitWindow(
      headers,
      [
        "x-ratelimit-remaining-weekly",
        "x-ratelimit-remaining-week",
        "x-ratelimit-remaining-7d",
      ],
      [
        "x-ratelimit-reset-weekly",
        "x-ratelimit-reset-week",
        "x-ratelimit-reset-7d",
      ],
    ),
  };
}

function parseRateLimitWindow(
  headers: Headers,
  remainingHeaders: string[],
  resetHeaders: string[],
): { remaining?: number | undefined; resetAt?: Date | undefined } | undefined {
  const remaining = firstNumberHeader(headers, remainingHeaders);
  const resetAt = firstDateHeader(headers, resetHeaders);
  if (remaining === undefined && !resetAt) {
    return undefined;
  }
  return { remaining, resetAt };
}

function firstNumberHeader(
  headers: Headers,
  names: string[],
): number | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (value === null) {
      continue;
    }
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

function firstDateHeader(headers: Headers, names: string[]): Date | undefined {
  for (const name of names) {
    const value = headers.get(name);
    if (!value) {
      continue;
    }
    const numeric = Number(value);
    const timestamp = Number.isFinite(numeric)
      ? numeric > 10_000_000_000
        ? numeric
        : numeric * 1000
      : Date.parse(value);
    if (Number.isFinite(timestamp)) {
      return new Date(timestamp);
    }
  }
  return undefined;
}

function parseRetryAfter(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }
  const seconds = Number(value);
  if (Number.isFinite(seconds)) {
    return seconds * 1000;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    return undefined;
  }
  return Math.max(0, timestamp - Date.now());
}

function safeJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function extractTextDelta(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  if (
    input.type === "response.output_text.delta" &&
    typeof input.delta === "string"
  ) {
    return input.delta;
  }
  return undefined;
}

function extractReasoningDelta(raw: unknown): string | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  return typeof input.reasoning === "string" ? input.reasoning : undefined;
}

function extractStreamError(
  raw: unknown,
  provider: string,
): ProviderUnavailableError | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  const type = stringValue(input.type);
  if (type !== "response.failed" && type !== "error") {
    return undefined;
  }
  const error =
    typeof input.error === "object" && input.error
      ? (input.error as Record<string, unknown>)
      : input;
  const message =
    stringValue(error.message) ??
    stringValue(error.code) ??
    "Codex stream failed.";
  return new ProviderUnavailableError(message, {
    provider,
    retryable: false,
    cause: raw,
  });
}

function extractToolDelta(
  raw: unknown,
): Extract<TextChunk, { type: "tool-call-delta" }> | undefined {
  if (!raw || typeof raw !== "object") {
    return undefined;
  }
  const input = raw as Record<string, unknown>;
  if (
    input.type !== "response.function_call_arguments.delta" &&
    input.type !== "response.output_item.added" &&
    input.type !== "response.output_item.done"
  ) {
    return undefined;
  }
  const item =
    typeof input.item === "object" && input.item
      ? (input.item as Record<string, unknown>)
      : undefined;
  if (
    item &&
    item.type !== "function_call" &&
    input.type !== "response.function_call_arguments.delta"
  ) {
    return undefined;
  }
  const callId = stringValue(input.call_id) ?? stringValue(item?.call_id);
  if (!callId) {
    return undefined;
  }
  const chunk: Extract<TextChunk, { type: "tool-call-delta" }> = {
    type: "tool-call-delta",
    id: callId,
    requestId: "",
    provider: "",
  };
  const name = stringValue(input.name) ?? stringValue(item?.name);
  if (name) {
    chunk.name = name;
  }
  const argumentsDelta =
    input.type === "response.function_call_arguments.delta"
      ? (stringValue(input.delta) ?? stringValue(input.arguments_delta))
      : undefined;
  if (argumentsDelta) {
    chunk.argumentsDelta = argumentsDelta;
  }
  return chunk;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
