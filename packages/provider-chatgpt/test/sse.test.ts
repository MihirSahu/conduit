import { describe, expect, test } from "bun:test";
import { parseSse } from "../src/sse";

describe("parseSse", () => {
  test("parses event and multiline data blocks", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("event: message\ndata: one\ndata: two\n\n"),
        );
        controller.close();
      },
    });
    const events = [];
    for await (const event of parseSse(stream)) {
      events.push(event);
    }
    expect(events).toEqual([{ event: "message", data: "one\ntwo" }]);
  });

  test("parses CRLF-delimited frames as separate events", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(
          new TextEncoder().encode("data: one\r\n\r\ndata: two\r\n\r\n"),
        );
        controller.close();
      },
    });
    const events = [];
    for await (const event of parseSse(stream)) {
      events.push(event);
    }
    expect(events).toEqual([{ data: "one" }, { data: "two" }]);
  });
});
