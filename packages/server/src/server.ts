import {
  AuthExpiredError,
  ConduitError,
  RateLimitError,
} from "@conduit-llm/core";
import type { LLMProvider } from "@conduit-llm/core";
import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";
import {
  createChatCompletionChunk,
  createChatCompletionResponse,
  createFinalChatCompletionChunk,
  createModelsResponse,
  formatSse,
  toGenerateTextRequest,
  validateChatCompletionsRequest,
} from "./openai.js";

export interface CreateServerOptions {
  provider: LLMProvider;
  apiKey?: string | undefined;
  allowedOrigins?: string[] | undefined;
  defaultModel?: string | undefined;
  logger?: boolean | undefined;
}

export function createConduitServer(
  options: CreateServerOptions,
): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? false });
  const allowedOrigins = new Set(options.allowedOrigins ?? []);

  app.addHook("onRequest", (request, reply, done) => {
    applyCors(request, reply, allowedOrigins);
    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }
    if (isPublicRoute(request)) {
      done();
      return;
    }
    if (!options.apiKey) {
      reply.code(500).send({
        error: {
          message: "CONDUIT_SERVER_API_KEY is required.",
          type: "server_configuration_error",
        },
      });
      return;
    }
    if (!hasValidBearerToken(request, options.apiKey)) {
      reply.code(401).send({
        error: {
          message: "Missing or invalid bearer token.",
          type: "authentication_error",
        },
      });
      return;
    }
    done();
  });

  app.get("/health", async () => ({ ok: true }));

  app.get("/v1/models", async () => createModelsResponse(options.provider));

  app.post("/v1/chat/completions", async (request, reply) => {
    try {
      const body = validateChatCompletionsRequest(request.body);
      const providerRequest = toGenerateTextRequest(body);
      const model = getResponseModel(body.model, options.defaultModel);
      if (body.stream) {
        await streamChatCompletion(
          options.provider,
          providerRequest,
          model,
          reply,
        );
        return reply;
      }
      const result = await options.provider.generateText(providerRequest);
      return createChatCompletionResponse({
        id: result.requestId,
        model: result.model ?? model,
        text: result.text,
      });
    } catch (error) {
      return sendError(reply, error);
    }
  });

  return app;
}

function isPublicRoute(request: FastifyRequest): boolean {
  return request.method === "GET" && request.url === "/health";
}

function hasValidBearerToken(request: FastifyRequest, apiKey: string): boolean {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) {
    return false;
  }
  return authorization.slice("Bearer ".length) === apiKey;
}

function applyCors(
  request: FastifyRequest,
  reply: FastifyReply,
  allowedOrigins: Set<string>,
): void {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }
  if (allowedOrigins.has("*") || allowedOrigins.has(origin)) {
    reply.header("access-control-allow-origin", origin);
    reply.header("vary", "Origin");
    reply.header("access-control-allow-methods", "GET,POST,OPTIONS");
    reply.header("access-control-allow-headers", "authorization,content-type");
  }
}

function getResponseModel(
  requestedModel: string | undefined,
  defaultModel: string | undefined,
): string {
  if (!requestedModel || requestedModel === "conduit-default") {
    return defaultModel ?? "conduit-default";
  }
  return requestedModel;
}

async function streamChatCompletion(
  provider: LLMProvider,
  request: Parameters<LLMProvider["streamText"]>[0],
  model: string,
  reply: FastifyReply,
): Promise<void> {
  const stream = provider.streamText(request)[Symbol.asyncIterator]();
  const first = await stream.next();

  reply.raw.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });

  try {
    let id: string = crypto.randomUUID();
    let next = first;
    while (!next.done) {
      const chunk = next.value;
      id = chunk.requestId;
      if (chunk.type === "text-delta") {
        reply.raw.write(
          formatSse(
            createChatCompletionChunk({ id, model, delta: chunk.text }),
          ),
        );
      }
      if (chunk.type === "complete") {
        reply.raw.write(
          formatSse(createFinalChatCompletionChunk({ id, model })),
        );
      }
      next = await stream.next();
    }
  } catch (error) {
    reply.raw.write(formatSse(toErrorPayload(error)));
  } finally {
    reply.raw.write("data: [DONE]\n\n");
    reply.raw.end();
  }
}

function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  const { status, payload } = toHttpError(error);
  if (error instanceof RateLimitError && error.retryAfterMs) {
    reply.header("retry-after", Math.ceil(error.retryAfterMs / 1000));
  }
  return reply.code(status).send(payload);
}

function toHttpError(error: unknown): {
  status: number;
  payload: { error: { message: string; type: string } };
} {
  if (error instanceof RateLimitError) {
    return {
      status: 429,
      payload: { error: { message: error.message, type: "rate_limit_error" } },
    };
  }
  if (error instanceof AuthExpiredError) {
    return {
      status: 401,
      payload: {
        error: { message: error.message, type: "authentication_error" },
      },
    };
  }
  if (error instanceof ConduitError) {
    return {
      status: 502,
      payload: { error: { message: error.message, type: "provider_error" } },
    };
  }
  return {
    status: 400,
    payload: {
      error: {
        message: error instanceof Error ? error.message : String(error),
        type: "invalid_request_error",
      },
    },
  };
}

function toErrorPayload(error: unknown): {
  error: { message: string; type: string };
} {
  return toHttpError(error).payload;
}
