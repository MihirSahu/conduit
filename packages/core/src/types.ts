import type { z } from "zod";

export type MessageRole = "system" | "user" | "assistant" | "tool";

export interface LLMMessage {
  role: MessageRole;
  content: string;
  name?: string | undefined;
  toolCallId?: string | undefined;
  toolCalls?: AssistantToolCall[] | undefined;
}

export interface AssistantToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ToolDefinition {
  type: "function";
  name: string;
  description?: string | undefined;
  parameters: Record<string, unknown>;
  strict?: boolean | undefined;
}

export interface ProviderCapabilities {
  streaming: boolean;
  tools: boolean;
  structured: boolean;
}

export interface GenerateTextRequest {
  messages: LLMMessage[];
  model?: string | undefined;
  temperature?: number | undefined;
  maxOutputTokens?: number | undefined;
  systemAppendix?: string | undefined;
  tools?: ToolDefinition[] | undefined;
  toolChoice?: "auto" | "none" | { type: "function"; name: string } | undefined;
  signal?: AbortSignal | undefined;
  metadata?: Record<string, unknown> | undefined;
}

export interface GenerateTextResult {
  text: string;
  requestId: string;
  provider: string;
  model?: string | undefined;
  raw?: unknown;
}

export type TextChunk =
  | {
      type: "text-delta";
      text: string;
      requestId: string;
      provider: string;
    }
  | {
      type: "reasoning-delta";
      text: string;
      requestId: string;
      provider: string;
    }
  | {
      type: "tool-call-delta";
      id: string;
      name?: string | undefined;
      argumentsDelta?: string | undefined;
      requestId: string;
      provider: string;
    }
  | {
      type: "complete";
      text: string;
      requestId: string;
      provider: string;
      raw?: unknown;
    };

export interface StructuredRequest<T> extends GenerateTextRequest {
  schema: z.ZodType<T>;
  schemaName?: string | undefined;
  repair?: boolean | undefined;
}

export interface ProviderStatus {
  healthy: boolean;
  latencyMs?: number | undefined;
  reason?: string | undefined;
}

export interface LLMProvider {
  readonly name: string;
  readonly capabilities: ProviderCapabilities;
  generateText(req: GenerateTextRequest): Promise<GenerateTextResult>;
  streamText(req: GenerateTextRequest): AsyncIterable<TextChunk>;
  generateStructured<T>(req: StructuredRequest<T>): Promise<T>;
  getStatus(): Promise<ProviderStatus>;
}
