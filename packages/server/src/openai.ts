import type {
  GenerateTextRequest,
  LLMMessage,
  LLMProvider,
} from "@conduit-llm/core";

export interface ChatCompletionsRequest {
  model?: string | undefined;
  messages?: OpenAIMessage[] | undefined;
  stream?: boolean | undefined;
  temperature?: number | undefined;
  max_tokens?: number | undefined;
  max_completion_tokens?: number | undefined;
  tools?: OpenAITool[] | undefined;
  tool_choice?:
    | "auto"
    | "none"
    | {
        type: "function";
        function: { name: string };
      }
    | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface OpenAIMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | OpenAIContentPart[] | null;
  name?: string | undefined;
  tool_call_id?: string | undefined;
  tool_calls?: unknown[] | undefined;
}

export interface OpenAIContentPart {
  type: string;
  text?: string | undefined;
}

export interface OpenAITool {
  type: "function";
  function: {
    name: string;
    description?: string | undefined;
    parameters?: Record<string, unknown> | undefined;
    strict?: boolean | undefined;
  };
}

export function toGenerateTextRequest(
  body: ChatCompletionsRequest,
): GenerateTextRequest {
  const model = normalizeModel(body.model);
  return {
    messages: toMessages(body.messages),
    ...(model ? { model } : {}),
    ...(typeof body.temperature === "number"
      ? { temperature: body.temperature }
      : {}),
    ...(getMaxOutputTokens(body)
      ? { maxOutputTokens: getMaxOutputTokens(body) }
      : {}),
    ...(body.metadata ? { metadata: body.metadata } : {}),
  };
}

export function createChatCompletionResponse(options: {
  id: string;
  model: string;
  text: string;
  created?: number | undefined;
}): Record<string, unknown> {
  return {
    id: options.id,
    object: "chat.completion",
    created: options.created ?? unixSeconds(),
    model: options.model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: options.text,
        },
        finish_reason: "stop",
      },
    ],
  };
}

export function createChatCompletionChunk(options: {
  id: string;
  model: string;
  delta: string;
  created?: number | undefined;
}): Record<string, unknown> {
  return {
    id: options.id,
    object: "chat.completion.chunk",
    created: options.created ?? unixSeconds(),
    model: options.model,
    choices: [
      {
        index: 0,
        delta: {
          content: options.delta,
        },
        finish_reason: null,
      },
    ],
  };
}

export function createFinalChatCompletionChunk(options: {
  id: string;
  model: string;
  created?: number | undefined;
}): Record<string, unknown> {
  return {
    id: options.id,
    object: "chat.completion.chunk",
    created: options.created ?? unixSeconds(),
    model: options.model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: "stop",
      },
    ],
  };
}

export function createModelsResponse(
  provider: LLMProvider,
): Record<string, unknown> {
  return {
    object: "list",
    data: [
      {
        id: "conduit-default",
        object: "model",
        created: 0,
        owned_by: provider.name,
      },
    ],
  };
}

export function formatSse(data: unknown): string {
  return `data: ${JSON.stringify(data)}\n\n`;
}

export function validateChatCompletionsRequest(
  body: unknown,
): ChatCompletionsRequest {
  if (!body || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }
  const request = body as ChatCompletionsRequest;
  if (!Array.isArray(request.messages) || request.messages.length === 0) {
    throw new Error("messages must be a non-empty array.");
  }
  if (request.tools?.length) {
    throw new Error("tools are not supported by this Conduit server yet.");
  }
  if (request.tool_choice && request.tool_choice !== "none") {
    throw new Error("tool_choice is not supported by this Conduit server yet.");
  }
  for (const message of request.messages) {
    if (!message || typeof message !== "object") {
      throw new Error("Each message must be an object.");
    }
    if (!["system", "user", "assistant", "tool"].includes(message.role)) {
      throw new Error("Each message must include a valid role.");
    }
    if (message.role === "tool" || message.tool_calls?.length) {
      throw new Error(
        "Tool messages are not supported by this Conduit server yet.",
      );
    }
    validateContent(message.content);
  }
  return request;
}

function toMessages(messages: OpenAIMessage[] | undefined): LLMMessage[] {
  return (messages ?? []).map((message) => ({
    role: message.role,
    content: toTextContent(message.content),
    ...(message.name ? { name: message.name } : {}),
    ...(message.tool_call_id ? { toolCallId: message.tool_call_id } : {}),
  }));
}

function toTextContent(content: OpenAIMessage["content"]): string {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => (part.type === "text" ? (part.text ?? "") : ""))
      .join("");
  }
  return "";
}

function validateContent(content: OpenAIMessage["content"]): void {
  if (content === null || typeof content === "string") {
    return;
  }
  if (!Array.isArray(content)) {
    throw new Error(
      "message content must be a string, null, or content array.",
    );
  }
  for (const part of content) {
    if (!part || typeof part !== "object") {
      throw new Error("message content parts must be objects.");
    }
    if (part.type !== "text") {
      throw new Error(
        `Unsupported message content part type "${part.type}". Only text content is supported.`,
      );
    }
    if (part.text !== undefined && typeof part.text !== "string") {
      throw new Error("text content parts must include string text.");
    }
  }
}

function getMaxOutputTokens(body: ChatCompletionsRequest): number | undefined {
  return body.max_completion_tokens ?? body.max_tokens;
}

function normalizeModel(model: string | undefined): string | undefined {
  return model === "conduit-default" ? undefined : model;
}

function unixSeconds(): number {
  return Math.floor(Date.now() / 1000);
}
