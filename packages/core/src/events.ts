import { appendFile } from "node:fs/promises";
import { redact } from "./redaction.js";

export type ConduitEvent =
  | {
      type: "request.start";
      requestId: string;
      provider: string;
      model?: string | undefined;
      metadata?: Record<string, unknown> | undefined;
    }
  | {
      type: "request.retry";
      requestId: string;
      provider: string;
      attempt: number;
      delayMs: number;
      error: unknown;
    }
  | {
      type: "request.complete";
      requestId: string;
      provider: string;
      latencyMs: number;
    }
  | {
      type: "request.error";
      requestId: string;
      provider: string;
      error: unknown;
    }
  | {
      type: "auth.refresh";
      requestId?: string | undefined;
      provider: string;
    }
  | {
      type: "auth.expired";
      requestId?: string | undefined;
      provider: string;
      reason?: string | undefined;
    };

export interface EventSink {
  emit(event: ConduitEvent): void | Promise<void>;
}

export class NoopSink implements EventSink {
  emit(): void {}
}

export class ConsoleSink implements EventSink {
  emit(event: ConduitEvent): void {
    console.log(JSON.stringify(redact(event)));
  }
}

export class FileSink implements EventSink {
  constructor(private readonly path: string) {}

  async emit(event: ConduitEvent): Promise<void> {
    await appendFile(this.path, `${JSON.stringify(redact(event))}\n`, {
      mode: 0o600,
    });
  }
}

export class PinoSink implements EventSink {
  constructor(private readonly logger: { info(input: unknown): void }) {}

  emit(event: ConduitEvent): void {
    this.logger.info(redact(event));
  }
}

export class EventBus {
  constructor(private readonly sink: EventSink = new NoopSink()) {}

  emit(event: ConduitEvent): void {
    void this.sink.emit(redact(event) as ConduitEvent);
  }
}
