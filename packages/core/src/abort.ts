import { TimeoutError } from "./errors.js";

export interface TimeoutSignal {
  signal: AbortSignal;
  dispose(): void;
}

export function withTimeout(
  parent: AbortSignal | undefined,
  timeoutMs: number,
): TimeoutSignal {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort(new TimeoutError(timeoutMs));
  }, timeoutMs);

  const abortFromParent = () => {
    controller.abort(parent?.reason);
  };

  if (parent) {
    if (parent.aborted) {
      abortFromParent();
    } else {
      parent.addEventListener("abort", abortFromParent, { once: true });
    }
  }

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      if (parent) {
        parent.removeEventListener("abort", abortFromParent);
      }
      if (timedOut && !controller.signal.aborted) {
        controller.abort(new TimeoutError(timeoutMs));
      }
    },
  };
}
