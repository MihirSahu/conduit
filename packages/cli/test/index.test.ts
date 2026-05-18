import { describe, expect, test } from "bun:test";
import { parseAskArgs } from "../src/index";

describe("CLI ask arguments", () => {
  test("parses --model and removes it from the prompt", () => {
    expect(parseAskArgs(["--model", "gpt-5.4-mini", "Say", "hello"])).toEqual({
      stream: false,
      model: "gpt-5.4-mini",
      prompt: "Say hello",
    });
  });

  test("uses CONDUIT_MODEL when no --model is supplied", () => {
    expect(
      parseAskArgs(["Say", "hello"], { CONDUIT_MODEL: "gpt-5.4-mini" }),
    ).toEqual({
      stream: false,
      model: "gpt-5.4-mini",
      prompt: "Say hello",
    });
  });

  test("--model overrides CONDUIT_MODEL", () => {
    expect(
      parseAskArgs(["--model", "gpt-5.5", "Say", "hello"], {
        CONDUIT_MODEL: "gpt-5.4-mini",
      }),
    ).toEqual({
      stream: false,
      model: "gpt-5.5",
      prompt: "Say hello",
    });
  });

  test("parses --stream independently of model selection", () => {
    expect(parseAskArgs(["--stream", "Say", "hello"], {})).toEqual({
      stream: true,
      prompt: "Say hello",
    });
  });
});
