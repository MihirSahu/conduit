export interface ServerSentEvent {
  event?: string | undefined;
  data: string;
}

export async function* parseSse(
  body: ReadableStream<Uint8Array>,
): AsyncIterable<ServerSentEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let boundary = findEventBoundary(buffer);
      while (boundary) {
        const block = buffer.slice(0, boundary.index);
        buffer = buffer.slice(boundary.end);
        const event = parseBlock(block);
        if (event) {
          yield event;
        }
        boundary = findEventBoundary(buffer);
      }
    }
    const trailing = buffer.trim();
    if (trailing) {
      const event = parseBlock(trailing);
      if (event) {
        yield event;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function findEventBoundary(
  buffer: string,
): { index: number; end: number } | undefined {
  const match = /\r?\n\r?\n/.exec(buffer);
  return match
    ? { index: match.index, end: match.index + match[0].length }
    : undefined;
}

function parseBlock(block: string): ServerSentEvent | undefined {
  let event: string | undefined;
  const data: string[] = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim();
    } else if (line.startsWith("data:")) {
      data.push(line.slice("data:".length).trimStart());
    }
  }
  if (data.length === 0) {
    return undefined;
  }
  return event ? { event, data: data.join("\n") } : { data: data.join("\n") };
}
