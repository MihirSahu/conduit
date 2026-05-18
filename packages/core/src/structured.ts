import type { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { SchemaValidationError } from "./errors.js";
import type { GenerateTextRequest, LLMProvider } from "./types.js";

export interface StrictSchema {
  name: string;
  schema: Record<string, unknown>;
  strict: true;
}

export function zodToStrictJsonSchema(
  schema: z.ZodType<unknown>,
  name = "StructuredOutput",
): StrictSchema {
  assertSupportedZodSchema(schema);
  const jsonSchema = zodToJsonSchema(schema, {
    $refStrategy: "none",
  }) as Record<string, unknown>;
  return {
    name,
    schema: sanitizeJsonSchema(jsonSchema),
    strict: true,
  };
}

export function sanitizeJsonSchema(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const seen = new WeakSet<object>();

  function visit(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => visit(item));
    }
    if (!value || typeof value !== "object") {
      return value;
    }
    if (seen.has(value)) {
      throw new Error("Recursive JSON schemas are not supported.");
    }
    seen.add(value);

    const output: Record<string, unknown> = {};
    for (const [key, nested] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (
        key === "format" ||
        key === "$schema" ||
        key === "$defs" ||
        key === "definitions"
      ) {
        continue;
      }
      output[key] = visit(nested);
    }
    if (output.type === "object") {
      if ("additionalProperties" in output && !("properties" in output)) {
        throw new Error(
          "Record schemas are not supported in strict structured outputs. Use an object with explicit keys instead.",
        );
      }
      output.additionalProperties = false;
      const propertyNames = objectKeys(output.properties);
      if (propertyNames.length > 0) {
        const required = stringArray(output.required);
        const missing = propertyNames.filter((key) => !required.includes(key));
        if (missing.length > 0) {
          throw new Error(
            `Optional object properties are not supported in strict structured outputs: ${missing.join(", ")}. Model optional values as nullable required fields or remove .optional().`,
          );
        }
        output.required = propertyNames;
      }
    }
    return output;
  }

  return visit(input) as Record<string, unknown>;
}

function assertSupportedZodSchema(schema: z.ZodType<unknown>): void {
  const stack = new WeakSet<object>();

  function visit(value: unknown): void {
    if (!value || typeof value !== "object") {
      return;
    }
    if (stack.has(value)) {
      throw new Error("Recursive Zod schemas are not supported.");
    }
    stack.add(value);

    try {
      const def = (value as { _def?: Record<string, unknown> })._def;
      if (!def) {
        for (const nested of Object.values(value)) {
          if (isZodSchemaLike(nested)) {
            visit(nested);
          }
        }
        return;
      }
      if (def.typeName === "ZodLazy") {
        throw new Error("Recursive Zod schemas are not supported.");
      }
      if (def.typeName === "ZodRecord" || def.typeName === "ZodMap") {
        throw new Error(
          "Record schemas are not supported in strict structured outputs. Use an object with explicit keys instead.",
        );
      }

      for (const nested of getNestedZodValues(def)) {
        if (isZodSchemaLike(nested) || isPlainObject(nested)) {
          visit(nested);
        }
      }
    } finally {
      stack.delete(value);
    }
  }

  function getNestedZodValues(def: Record<string, unknown>): unknown[] {
    const nestedValues: unknown[] = [];
    const values = Object.values(def);
    if (def.typeName === "ZodObject" && typeof def.shape === "function") {
      values.push(def.shape());
    }
    if (def.typeName === "ZodArray") {
      nestedValues.push(def.type);
    }
    if (
      def.typeName === "ZodOptional" ||
      def.typeName === "ZodNullable" ||
      def.typeName === "ZodDefault" ||
      def.typeName === "ZodCatch" ||
      def.typeName === "ZodPromise"
    ) {
      values.push(def.innerType);
    }
    if (def.typeName === "ZodEffects" || def.typeName === "ZodPipeline") {
      values.push(def.schema, def.in, def.out);
    }
    if (def.typeName === "ZodUnion") {
      values.push(def.options);
    }
    if (def.typeName === "ZodIntersection") {
      values.push(def.left, def.right);
    }
    for (const nested of values) {
      if (typeof nested === "function") {
        continue;
      }
      if (Array.isArray(nested)) {
        for (const item of nested) {
          nestedValues.push(item);
        }
      } else {
        nestedValues.push(nested);
      }
    }
    return nestedValues;
  }

  visit(schema);
}

function isZodSchemaLike(
  value: unknown,
): value is { _def: Record<string, unknown> } {
  return Boolean(value && typeof value === "object" && "_def" in value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function objectKeys(value: unknown): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  return Object.keys(value);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function parseStructuredText<T>(
  text: string,
  schema: z.ZodType<T>,
  provider?: string,
  requestId?: string,
): T {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new SchemaValidationError("Structured output was not valid JSON.", {
      rawText: text,
      validationError: error,
      ...(provider ? { provider } : {}),
      ...(requestId ? { requestId } : {}),
    });
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new SchemaValidationError(
      "Structured output did not match the requested schema.",
      {
        rawText: text,
        validationError: result.error,
        ...(provider ? { provider } : {}),
        ...(requestId ? { requestId } : {}),
      },
    );
  }
  return result.data;
}

export async function generateStructuredWithRepair<T>(
  provider: LLMProvider,
  req: GenerateTextRequest & {
    schema: z.ZodType<T>;
    schemaName?: string | undefined;
    repair?: boolean | undefined;
  },
): Promise<T> {
  const first = await provider.generateText(req);
  try {
    return parseStructuredText(
      first.text,
      req.schema,
      first.provider,
      first.requestId,
    );
  } catch (error) {
    if (req.repair === false) {
      throw error;
    }
    const repair = await provider.generateText({
      ...req,
      messages: [
        ...req.messages,
        { role: "assistant", content: first.text },
        {
          role: "user",
          content: `The previous response failed schema validation. Return only corrected JSON. Error: ${formatValidationError(error)}`,
        },
      ],
    });
    return parseStructuredText(
      repair.text,
      req.schema,
      repair.provider,
      repair.requestId,
    );
  }
}

function formatValidationError(error: unknown): string {
  if (error instanceof SchemaValidationError) {
    return JSON.stringify(
      {
        message: error.message,
        validationError: error.validationError,
        rawText: error.rawText,
      },
      null,
      2,
    );
  }
  return error instanceof Error ? error.message : String(error);
}
